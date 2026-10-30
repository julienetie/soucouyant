// Write-behind persistence through a pluggable adapter. The core only queues
// frames; adapters (separate imports) do the I/O.
//
// Adapter interface (all async):
//   open(options) -> { firstIndex, lastIndex }   lastIndex is -1 when empty
//   writeFrames(batch)                            upsert by frame index
//   readLatest(count) -> frames
//   readRange(from, to) -> frames
//   deleteBefore(index), deleteBeforeTime(timestamp)
//   clear(), close()
// A read frame is { index, timestamp, identity, state, finiteIndex, alias, flags }.

import { FRAME_PENDING, FRAME_PURGED, FRAME_ALIASED, FRAME_BASE, pending } from './constants.js'
import {
  settings, records, onConfigure, addHook, removeHook, frameTimestamp, frameObjectId, frameFiniteIndex,
  frameFlags, frameValue, aliasesByFrame, firstIndex, nextIndex, idByAddress, resetLog, loadFrame,
  finishRebuild, suspendHooks, resumeHooks, prependFrames, allowRestoredFrames, trailLimitFrames,
  parseDuration, rebaseLog
} from './core.js'
import { isBrowser, isNode, unrefTimer, reportError } from './environment.js'

const FLUSH_DELAY = 1000
const FLUSH_COUNT = 512

let adapter = null
let opening = null
let writing = Promise.resolve()
let flushTimer = null
let mode = 'disabled'
let writeEvicted = false
let storedFirst = Infinity
let storedLast = -1

// The queue keeps copies, because a frame may leave memory before it is written
const createQueue = () => ({
  indices: [],
  timestamps: [],
  objectIds: [],
  finiteIndexes: [],
  flags: [],
  aliases: [],
  values: [],
  objects: []
})

let queue = createQueue()

const enqueue = (index, slot) => {
  const flags = frameFlags[slot]
  // Declaration frames come from code on every run; storing them would make
  // each new session's initial states shadow the restored history
  if ((flags & FRAME_BASE) !== 0) return
  const id = frameObjectId[slot]
  const record = records[id]
  if (!record.addressSent) {
    record.addressSent = true
    queue.objects.push([id, record.address])
  }
  queue.indices.push(index)
  queue.timestamps.push(frameTimestamp[slot])
  queue.objectIds.push(id)
  queue.finiteIndexes.push(frameFiniteIndex[slot])
  queue.flags.push(flags)
  queue.aliases.push((flags & FRAME_ALIASED) !== 0 ? aliasesByFrame.get(index) ?? null : null)
  queue.values.push((flags & (FRAME_PENDING | FRAME_PURGED)) !== 0 ? null : frameValue[slot])
  if (queue.indices.length >= FLUSH_COUNT) flush()
  else if (flushTimer === null) flushTimer = unrefTimer(setTimeout(flush, FLUSH_DELAY))
}

const onRecorded = (index, slot) => enqueue(index, slot)
const onUpdated = (index, slot) => {
  if (mode === 'all' || index <= storedLast) enqueue(index, slot)
}
const onEvicting = (index, slot) => enqueue(index, slot)

const installHooks = () => {
  removeHook('recorded', onRecorded)
  removeHook('updated', onUpdated)
  removeHook('evicting', onEvicting)
  if (adapter === null) return
  if (mode === 'all') addHook('recorded', onRecorded)
  if (mode !== 'disabled' || writeEvicted) addHook('updated', onUpdated)
  if (mode === 'excess' || writeEvicted) addHook('evicting', onEvicting)
}

const toBatch = (taken) => ({
  indices: Float64Array.from(taken.indices, (index) => index),
  timestamps: Float64Array.from(taken.timestamps),
  objectIds: Uint32Array.from(taken.objectIds),
  finiteIndexes: Int32Array.from(taken.finiteIndexes),
  flags: Uint8Array.from(taken.flags),
  aliases: taken.aliases,
  values: taken.values,
  objects: taken.objects
})

const trimStorage = async () => {
  const limit = settings.offlineStorage.excessLimit
  if (limit === Infinity || limit === undefined || limit === '' || limit === null) return
  if (typeof limit === 'number') {
    if (storedLast - storedFirst + 1 <= limit) return
    const cutoff = storedLast - limit + 1
    await handTailSlices(storedFirst, cutoff - 1)
    await adapter.deleteBefore(cutoff)
    storedFirst = cutoff
    return
  }
  const window = parseDuration(limit)
  if (Number.isNaN(window)) return
  await adapter.deleteBeforeTime(Date.now() - window)
}

const writeBatch = async (taken) => {
  await opening
  if (adapter === null) return
  await adapter.writeFrames(toBatch(taken))
  for (const index of taken.indices) {
    if (index < storedFirst) storedFirst = index
    if (index > storedLast) storedLast = index
  }
  await trimStorage()
}

export const flush = () => {
  if (flushTimer !== null) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  if (queue.indices.length !== 0 && adapter !== null) {
    const taken = queue
    queue = createQueue()
    writing = writing.then(() => writeBatch(taken)).catch((error) => {
      reportError('Writing frames to storage failed', error)
    })
  }
  return writing
}

// ---------------------------------------------------------------------------
// Tail slices of frames leaving storage
// ---------------------------------------------------------------------------

let storageSliceSize = 1
const storageSliceListeners = []

export const setStorageSliceSize = (size) => {
  if (!Number.isInteger(size) || size < 1) throw new RangeError('IDBTailSliceSize() takes a whole number of frames')
  storageSliceSize = size
}

export const addStorageSliceListener = (callback, identities) => {
  storageSliceListeners.push({ callback, identities })
}

const handTailSlices = async (from, to) => {
  if (storageSliceListeners.length === 0 || to < from) return
  const frames = (await adapter.readRange(from, to)).map(toMemoryFrame)
  for (const listener of storageSliceListeners) {
    const selected = listener.identities === null ? frames : frames.filter((frame) => listener.identities.has(frame.identity))
    for (let start = 0; start < selected.length; start += storageSliceSize) {
      try {
        listener.callback(selected.slice(start, start + storageSliceSize))
      } catch (error) {
        reportError('An IDBRequestTailSlice callback threw', error)
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Connecting and restoring
// ---------------------------------------------------------------------------

const toMemoryFrame = (frame) => ({
  index: frame.index,
  timestamp: frame.timestamp,
  identity: frame.identity,
  state: (frame.flags & FRAME_PENDING) !== 0 ? pending : frame.state,
  finiteIndex: frame.finiteIndex,
  alias: frame.alias ?? null,
  flags: frame.flags,
  pending: (frame.flags & FRAME_PENDING) !== 0
})

const connect = (next) => {
  if (adapter === next) return
  const previous = adapter
  adapter = next
  if (previous !== null) {
    const closing = previous
    writing = writing.then(() => closing.close()).catch((error) => reportError('Closing storage failed', error))
  }
  if (next === null) {
    opening = null
    return
  }
  opening = Promise.resolve(next.open({ databaseName: settings.databaseName, objectStoreName: settings.objectStoreName }))
    .then((info) => {
      storedFirst = info !== undefined && info.firstIndex >= 0 ? info.firstIndex : Infinity
      storedLast = info !== undefined ? info.lastIndex : -1
      // Continue numbering after what is already stored, so sessions never
      // overwrite each other's frames
      const offset = storedLast + 1 - firstIndex
      if (offset > 0) {
        rebaseLog(offset)
        for (let i = 0; i < queue.indices.length; i++) queue.indices[i] += offset
      }
    })
    .catch((error) => {
      reportError('Opening storage failed', error)
      adapter = null
    })
}

const applySettings = () => {
  const storage = settings.offlineStorage
  mode = storage.mode
  if (mode !== 'disabled' && mode !== 'all' && mode !== 'excess') {
    throw new TypeError('offlineStorage.mode must be \'disabled\', \'all\' or \'excess\'')
  }
  const wanted = mode === 'disabled' && !writeEvicted ? null : storage.adapter ?? null
  if (mode !== 'disabled' && (storage.adapter === undefined || storage.adapter === null)) {
    throw new TypeError('offlineStorage needs an adapter, for example sqliteStorage() or indexedDbStorage()')
  }
  connect(wanted)
  installHooks()
}

onConfigure(applySettings)

export const setWriteEvicted = (enabled) => {
  writeEvicted = enabled
  if (enabled && adapter === null && settings.offlineStorage.adapter) connect(settings.offlineStorage.adapter)
  installHooks()
}

const requireAdapter = () => {
  if (adapter === null) throw new Error('No storage adapter is connected; set offlineStorage in o.config()')
}

const resolveIdentity = (identity) => {
  const id = idByAddress.get(identity)
  return id === undefined ? -1 : id
}

export const restoreLatest = async () => {
  requireAdapter()
  await opening
  await flush()
  const frames = (await adapter.readLatest(trailLimitFrames === Infinity ? 100000 : trailLimitFrames)).map(toMemoryFrame)
  if (frames.length === 0) return 0
  suspendHooks()
  resetLog(frames[0].index)
  let loaded = 0
  for (const frame of frames) {
    const id = resolveIdentity(frame.identity)
    if (id < 0) continue
    loadFrame(frame.index, id, frame.state, frame.finiteIndex, frame.flags, frame.timestamp, frame.alias)
    loaded++
  }
  resumeHooks()
  finishRebuild(nextIndex - 1)
  return loaded
}

export const restoreRange = async (from, to) => {
  requireAdapter()
  if (!Number.isInteger(from) || !Number.isInteger(to) || to < from) throw new RangeError('restore(from, to) takes two frame indices, from <= to')
  await opening
  await flush()
  // Frames from `from` up to the oldest frame in memory are loaded, so the
  // history stays contiguous
  const end = firstIndex - 1
  if (from > end) return 0
  const frames = (await adapter.readRange(from, end)).map(toMemoryFrame)
  if (frames.length === 0) return 0
  const boundary = firstIndex
  const loaded = prependFrames(frames, resolveIdentity)
  allowRestoredFrames(boundary - frames[0].index, boundary)
  return loaded
}

export const clearStorage = async () => {
  requireAdapter()
  await opening
  queue = createQueue()
  await writing
  await adapter.clear()
  storedFirst = Infinity
  storedLast = -1
}

export const storageCount = () => storedLast < 0 || storedFirst === Infinity ? 0 : storedLast - storedFirst + 1
export const storageConnected = () => adapter !== null

// Write whatever is queued when the page hides or the process is about to exit
if (isBrowser) {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush()
  })
} else if (isNode) {
  process.on('beforeExit', () => {
    if (queue.indices.length !== 0) flush()
  })
}
