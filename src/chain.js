// The chain: the recorded timeline of every stateObject.

import { FRAME_PURGED, FRAME_PENDING, FRAME_DEAD, FRAME_IGNORED, pending } from './constants.js'
import {
  records, objectCount, idOfStateObject, idByAddress, persistEnabled, firstIndex, nextIndex, headIndex,
  frameFlags, frameObjectId, frameTimestamp, slotOf, tipValue, baseValue, headValueOf,
  purgeChainAhead, setChainAutoPurge, setTrailLimit, setAutoLimit, trailLimitFrames, trailWindowMs,
  addHook, removeHook, requestFlush, settleNow, resetLog, loadFrame, finishRebuild, suspendHooks, resumeHooks,
  resolveLive, lastFrameAtOrBefore, valueOfFrame, bufferedEntries, parseDuration, settings
} from './core.js'
import { reportError } from './environment.js'
import { resolvePosition, requireHistory } from './positions.js'
import { materializeFrame } from './frames.js'
import {
  flush, restoreLatest, restoreRange, clearStorage, storageCount, setWriteEvicted,
  setStorageSliceSize, addStorageSliceListener
} from './storage.js'

const idOf = (stateObject) => {
  const id = idOfStateObject.get(stateObject)
  if (id === undefined) throw new TypeError('Expected a stateObject')
  return id
}

const idSet = (stateObjects) => stateObjects.length === 0 ? null : new Set(stateObjects.map(idOf))

const framesBetween = (from, to, ids) => {
  const frames = []
  const start = Math.max(from, firstIndex)
  const end = Math.min(to, nextIndex - 1)
  for (let index = start; index <= end; index++) {
    const slot = slotOf(index)
    if ((frameFlags[slot] & FRAME_PURGED) !== 0) continue
    if (ids !== null && !ids.has(frameObjectId[slot])) continue
    frames.push(materializeFrame(index))
  }
  return frames
}

const positionOrThrow = (position) => {
  const index = resolvePosition(position)
  if (Number.isNaN(index)) throw new RangeError(`No frame matches ${String(position)}`)
  return index
}

// ---------------------------------------------------------------------------
// Chain subscribers: every recorded frame, delivered with each flush
// ---------------------------------------------------------------------------

const chainSubscribers = []
const chainRefs = []
let pendingFrames = []
let chainRefCounter = 0

const onChainFrame = (index) => {
  pendingFrames.push(materializeFrame(index))
  requestFlush()
}

const deliverChainFrames = () => {
  if (pendingFrames.length === 0) return
  const frames = pendingFrames
  pendingFrames = []
  for (let i = 0; i < chainSubscribers.length; i++) {
    try {
      chainSubscribers[i](frames)
    } catch (error) {
      reportError('A chain subscriber threw', error)
    }
  }
}

const sub = (callback, ref) => {
  if (typeof callback !== 'function') throw new TypeError('chain.sub() expects a callback')
  const name = ref ?? `chain-sub-${chainRefCounter++}`
  if (chainRefs.includes(name)) throw new Error(`Chain subscription reference "${name}" already exists`)
  chainSubscribers.push(callback)
  chainRefs.push(name)
  if (chainSubscribers.length === 1) {
    addHook('recorded', onChainFrame)
    addHook('afterFlush', deliverChainFrames)
  }
  return name
}

const unsub = (...refs) => {
  let removed = 0
  for (const ref of refs) {
    const at = chainRefs.indexOf(ref)
    if (at === -1) continue
    chainRefs.splice(at, 1)
    chainSubscribers.splice(at, 1)
    removed++
  }
  if (chainSubscribers.length === 0) {
    removeHook('recorded', onChainFrame)
    removeHook('afterFlush', deliverChainFrames)
    pendingFrames = []
  }
  return removed
}

// ---------------------------------------------------------------------------
// Tail slices of frames leaving memory
// ---------------------------------------------------------------------------

let tailSize = 1
const tailListeners = []
let tailFrames = []

const onTailFrame = (index, slot) => {
  if ((frameFlags[slot] & FRAME_PURGED) !== 0) return
  tailFrames.push(materializeFrame(index))
  if (tailFrames.length < tailSize) return
  const slice = tailFrames
  tailFrames = []
  for (const listener of tailListeners) {
    try {
      listener(slice)
    } catch (error) {
      reportError('A requestTailSlice callback threw', error)
    }
  }
}

const tailSliceSize = (size) => {
  if (size === undefined) return tailSize
  if (!Number.isInteger(size) || size < 1) throw new RangeError('tailSliceSize() takes a whole number of frames')
  tailSize = size
  return size
}

const requestTailSlice = (callback) => {
  if (typeof callback !== 'function') throw new TypeError('requestTailSlice() expects a callback')
  tailListeners.push(callback)
  if (tailListeners.length === 1) addHook('evicting', onTailFrame)
}

// ---------------------------------------------------------------------------
// Validation and replacement
// ---------------------------------------------------------------------------

const validate = (candidate) => {
  if (!Array.isArray(candidate)) throw new TypeError('A chain is an array of frames')
  let previousIndex = -Infinity
  let previousTimestamp = -Infinity
  for (let i = 0; i < candidate.length; i++) {
    const frame = candidate[i]
    const where = `Frame ${i}`
    if (frame === null || typeof frame !== 'object') throw new TypeError(`${where} is not a frame object`)
    if (!Number.isInteger(frame.index) || frame.index < 0) throw new TypeError(`${where} has an invalid index`)
    if (frame.index <= previousIndex) throw new RangeError(`${where} (index ${frame.index}) does not come after index ${previousIndex}`)
    if (typeof frame.timestamp !== 'number' || Number.isNaN(frame.timestamp)) throw new TypeError(`${where} (index ${frame.index}) has an invalid timestamp`)
    if (frame.timestamp < previousTimestamp) throw new RangeError(`${where} (index ${frame.index}) has a timestamp earlier than the frame before it`)
    const id = idByAddress.get(frame.identity)
    if (id === undefined) throw new TypeError(`${where} (index ${frame.index}) names ${String(frame.identity)}, which is not declared`)
    const state = frame.pending === true ? pending : frame.state
    if (state !== pending) {
      if (state === undefined || (Number.isNaN(state) && !settings.allowNaN)) throw new TypeError(`${where} (index ${frame.index}) has an undefined or NaN state`)
      const record = records[id]
      if (record.finiteIndexByValue !== null) {
        if (!record.finiteIndexByValue.has(state)) throw new TypeError(`${where} (index ${frame.index}) has a state outside the finite states of ${record.address}`)
      } else {
        structuredClone(state)
      }
    }
    previousIndex = frame.index
    previousTimestamp = frame.timestamp
  }
}

const replace = (candidate) => {
  requireHistory()
  validate(candidate)
  const previousHead = headIndex
  const wasPresent = nextIndex - 1 === headIndex
  suspendHooks()
  resetLog(candidate.length === 0 ? nextIndex : candidate[0].index)
  for (const frame of candidate) {
    const id = idByAddress.get(frame.identity)
    const state = frame.pending === true ? pending : frame.state
    const finiteIndex = records[id].finiteIndexByValue === null || state === pending ? -1 : records[id].finiteIndexByValue.get(state)
    let flags = 0
    if (state === pending) flags |= FRAME_PENDING
    if (frame.ignored === true) flags |= FRAME_IGNORED
    loadFrame(frame.index, id, state, finiteIndex, flags, frame.timestamp, frame.alias ?? null)
  }
  for (let id = 0; id < objectCount; id++) {
    tipValue[id] = valueOfFrame(id, resolveLive(lastFrameAtOrBefore(id, nextIndex - 1)))
  }
  resumeHooks()
  finishRebuild(wasPresent ? nextIndex - 1 : previousHead)
}

const clear = (options) => {
  if (persistEnabled) {
    suspendHooks()
    for (let id = 0; id < objectCount; id++) baseValue[id] = tipValue[id]
    resetLog(nextIndex)
    resumeHooks()
    finishRebuild(nextIndex - 1)
  }
  if (options !== undefined && options !== null && options.storage === true) return clearStorage()
  return undefined
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

const chainStateAt = (position, ...stateObjects) => {
  const ids = stateObjects.length === 0 ? null : stateObjects.map(idOf)
  const result = {}
  const read = (id) => {
    if (!persistEnabled) return position === 'present' ? tipValue[id] : headValueOf(id)
    const index = positionOrThrow(position)
    return valueOfFrame(id, resolveLive(lastFrameAtOrBefore(id, index)))
  }
  if (ids === null) {
    for (let id = 0; id < objectCount; id++) result[records[id].address] = read(id)
  } else {
    for (const id of ids) result[records[id].address] = read(id)
  }
  return result
}

const slice = (from, to, ...stateObjects) => {
  requireHistory()
  return framesBetween(positionOrThrow(from), positionOrThrow(to), idSet(stateObjects))
}

const find = (position) => {
  if (!persistEnabled) return undefined
  const index = resolvePosition(position)
  if (Number.isNaN(index) || index < firstIndex || index >= nextIndex) return undefined
  if ((frameFlags[slotOf(index)] & FRAME_PURGED) !== 0) return undefined
  return materializeFrame(index)
}

const chainMeta = () => {
  let live = 0
  for (let index = firstIndex; index < nextIndex; index++) {
    if ((frameFlags[slotOf(index)] & FRAME_DEAD) === 0) live++
  }
  const empty = nextIndex === firstIndex
  return {
    length: live,
    firstIndex,
    lastIndex: nextIndex - 1,
    firstTimestamp: empty ? null : frameTimestamp[slotOf(firstIndex)],
    lastTimestamp: empty ? null : frameTimestamp[slotOf(nextIndex - 1)],
    framesInMemory: nextIndex - firstIndex,
    framesInStorage: storageCount(),
    bufferLength: bufferedEntries().length,
    trailLimit: trailLimit()
  }
}

// ---------------------------------------------------------------------------
// Limits and purging
// ---------------------------------------------------------------------------

const trailLimit = (limit) => {
  if (limit === undefined) return trailWindowMs !== 0 ? `${trailWindowMs}ms` : trailLimitFrames
  if (limit === Infinity) {
    setTrailLimit(Infinity, 0)
  } else if (typeof limit === 'number') {
    if (!Number.isInteger(limit) || limit < 1) throw new RangeError('trailLimit() takes a whole number of frames or a duration such as \'30s\'')
    setTrailLimit(limit, 0)
  } else {
    const window = parseDuration(limit)
    if (Number.isNaN(window) || window <= 0) throw new RangeError('trailLimit() takes a whole number of frames or a duration such as \'30s\'')
    setTrailLimit(Infinity, window)
  }
  return limit
}

const autoLimitTail = (mode) => {
  if (mode === undefined) {
    setAutoLimit(true)
  } else if (mode === 'idb') {
    setWriteEvicted(true)
    setAutoLimit(true)
  } else if (mode === 'stop') {
    setAutoLimit(false)
  } else {
    throw new TypeError('autoLimitTail() takes no argument, \'idb\' or \'stop\'')
  }
}

const purge = (mode) => {
  if (mode === 'auto') return setChainAutoPurge(true)
  if (mode === 'auto-stop') return setChainAutoPurge(false)
  if (mode !== undefined) throw new TypeError('purge() takes no argument, \'auto\' or \'auto-stop\'')
  if (!persistEnabled) return 0
  const removed = purgeChainAhead()
  settleNow()
  return removed
}

export const chain = {
  purge,
  trailLimit,
  autoLimitTail,
  tailSliceSize,
  requestTailSlice,
  IDBTailSliceSize: (size) => setStorageSliceSize(size),
  IDBRequestTailSlice: (callback, ...stateObjects) => {
    if (typeof callback !== 'function') throw new TypeError('IDBRequestTailSlice() expects a callback')
    addStorageSliceListener(callback, stateObjects.length === 0 ? null : new Set(stateObjects.map((stateObject) => records[idOf(stateObject)].address)))
  },
  expose: () => {
    if (!persistEnabled) return []
    return framesBetween(firstIndex, nextIndex - 1, null)
  },
  validate,
  replace,
  find,
  slice,
  stateAt: chainStateAt,
  clear,
  meta: chainMeta,
  sub,
  unsub,
  restore: (from, to) => from === undefined ? restoreLatest() : restoreRange(from, to),
  flush: () => flush(),
  get buffer () {
    return bufferedEntries()
  }
}
