// The engine. Everything on the hot path (get, publish, notify, head
// movement) lives in this one module so it can read its columns as module
// bindings and call its own variants directly.
//
// Data layout
// - Registry: one row per stateObject, hot fields in typed columns indexed by
//   the stateObject's integer id, cold fields in one shape-stable record.
// - Frame log: a struct-of-arrays ring buffer, one row per recorded frame.
//   Logical frame indices only ever grow; the physical slot is index & mask.
//   Each stateObject's own history is a linked list threaded through the log.

import {
  GET, pending, republish,
  FINITE, LOCKED, DIRTY, TRANSITIONS, WANTS_PROPS, AUTO_PURGE, OWN_TRAIL_LIMIT, MOVED, HAS_SUBSCRIBERS,
  FRAME_PENDING, FRAME_IGNORED, FRAME_PURGED, FRAME_ALIASED, FRAME_BASE, FRAME_DEAD,
  FORWARD, REVERSE, directionNames,
  BUFFERED_VALUE, BUFFERED_CALLBACK, CHAIN_KEY, SNAPSHOT_SPACING, INT32_LIMIT
} from './constants.js'
import { clock, startTime, queueTask, queueFrame, defaultExecution, unrefTimer, reportError, warn } from './environment.js'

const noop = () => {}
const identity = (value) => value

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export const settings = {
  allowNaN: false,
  namespaceDepth: 4,
  persist: false,
  databaseName: 'soucouyant',
  objectStoreName: 'transient-state',
  execution: defaultExecution,
  mergeFidelity: '200ms',
  offlineStorage: { mode: 'disabled', excessLimit: Infinity, adapter: null },
  observe: false,
  development: false,
  clone: false,
  asyncCallbacks: 'lock',
  asyncLockTimeout: 10000,
  seekTime: 'session'
}

const SYNC = 0
const MICROTASK = 1
const ANIMATION_FRAME = 2

const MERGE_OFF = 0
const MERGE_BY_TIME = 1
const MERGE_BY_FRAMES = 2

// Hot-path copies of settings, so the hot path reads module bindings
let allowNaN = false
export let persistEnabled = false
let executionMode = defaultExecution === 'sync' ? SYNC : defaultExecution === 'async-queue' ? MICROTASK : ANIMATION_FRAME
let mergeMode = MERGE_BY_TIME
let mergeWindow = 200
let syncOnly = false
let asyncLockTimeout = 10000
let chainAutoPurge = false

export const parseDuration = (value) => {
  if (typeof value !== 'string') return NaN
  const match = /^\s*(\d+(?:\.\d+)?)\s*(ms|s|m|h)\s*$/.exec(value)
  if (match === null) return NaN
  const amount = Number(match[1])
  if (match[2] === 'ms') return amount
  if (match[2] === 's') return amount * 1000
  if (match[2] === 'm') return amount * 60000
  return amount * 3600000
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export let objectCount = 0
let objectCapacity = 0

// Logical frame index shown at the head, or -1 for the base value
export let headFrame = new Float64Array(0)
// Logical index of the newest frame in the object's chain, or -1
export let tipFrame = new Float64Array(0)
// Logical index of the oldest frame in memory for the object, or -1
export let firstFrame = new Float64Array(0)
export let objectFlags = new Uint16Array(0)
let headTimestamp = new Float64Array(0)
let objectDirection = new Uint8Array(0)
let objectFrameCount = new Uint32Array(0)
let dirtyStack = new Int32Array(0)
let spareStack = new Int32Array(0)
let dirtyLength = 0
let movedStack = new Int32Array(0)
let movedLength = 0
let candidateFrames = new Float64Array(0)

// State at the head, one { value } cell per stateObject. Each stateObject
// function captures its own cell, so a get is a single field load instead of
// an array element load and bounds check.
export const headCells = []
const createCell = (value) => ({ value })
export const headValueOf = (id) => headCells[id].value
// Newest recorded state: what publish callbacks receive
export const tipValue = []
// State before the oldest frame still in memory
export const baseValue = []
export const initialValue = []
// What subscribers last received, for props.rev
export const lastNotifiedValue = []
export const records = []
export const stateObjects = []
export const idOfStateObject = new WeakMap()
export const idByAddress = new Map()

const createObjectRecord = (id, address, declaredAt) => ({
  id,
  address,
  // Created on first sub(): most stateObjects are never subscribed to
  subscriptions: null,
  liveSlots: 0,
  deadSlots: 0,
  propsSubscriberCount: 0,
  finiteStates: null,
  finiteIndexByValue: null,
  keyframes: null,
  transitionTable: null,
  trajectory: null,
  trailLimit: 0,
  trailWindow: 0,
  startTime: declaredAt,
  lockToken: null,
  namespace: null,
  scopePaths: null,
  addressSent: false,
  previousPublishTime: -Infinity,
  lastPublishTime: -Infinity
})

const createSubscriptionTable = () => ({
  subscribers: [],
  invertedSubscribers: [],
  subscriberRefs: [],
  invertedRefs: [],
  wantsProps: [],
  refSlots: new Map()
})

const grownFloat64 = (array, capacity, fill) => {
  const next = new Float64Array(capacity)
  next.set(array)
  if (fill !== 0) next.fill(fill, array.length)
  return next
}

const growTyped = (array, capacity) => {
  const next = new array.constructor(capacity)
  next.set(array)
  return next
}

const growObjects = () => {
  const capacity = objectCapacity === 0 ? 64 : objectCapacity * 2
  headFrame = grownFloat64(headFrame, capacity, -1)
  tipFrame = grownFloat64(tipFrame, capacity, -1)
  firstFrame = grownFloat64(firstFrame, capacity, -1)
  candidateFrames = grownFloat64(candidateFrames, capacity, -1)
  headTimestamp = grownFloat64(headTimestamp, capacity, 0)
  objectFlags = growTyped(objectFlags, capacity)
  objectDirection = growTyped(objectDirection, capacity)
  objectFrameCount = growTyped(objectFrameCount, capacity)
  dirtyStack = growTyped(dirtyStack, capacity)
  spareStack = growTyped(spareStack, capacity)
  movedStack = growTyped(movedStack, capacity)
  objectCapacity = capacity
}

// Adds a stateObject row. `finite` is null or the prepared finite description.
export const registerObject = (address, initial, finite) => {
  if (objectCount === objectCapacity) growObjects()
  const id = objectCount++
  const declaredAt = taskClock()
  const record = createObjectRecord(id, address, declaredAt)
  records.push(record)
  idByAddress.set(address, id)
  headCells.push(createCell(initial))
  tipValue.push(initial)
  baseValue.push(initial)
  initialValue.push(initial)
  lastNotifiedValue.push(initial)
  headTimestamp[id] = declaredAt
  if (finite !== null) {
    record.finiteStates = finite.states
    record.finiteIndexByValue = finite.indexByValue
    record.keyframes = finite.keyframes
    record.transitionTable = finite.transitionTable
    objectFlags[id] = finite.transitionTable === null ? FINITE : FINITE | TRANSITIONS
  }
  if (persistEnabled) {
    const finiteIndex = finite === null || initial === pending ? -1 : finite.indexByValue.get(initial)
    const flags = initial === pending ? FRAME_PENDING | FRAME_BASE : FRAME_BASE
    stampFrameTime()
    const index = appendFrame(id, initial, finiteIndex, flags)
    if (isHeadPresent) {
      headIndex = index
      headFrame[id] = index
    }
    if (autoLimit) enforceTrail()
  }
  return id
}

// ---------------------------------------------------------------------------
// Frame log
// ---------------------------------------------------------------------------

export let frameCapacity = 0
let frameMask = -1
export let frameObjectId = new Uint32Array(0)
export let frameTimestamp = new Float64Array(0)
export let framePrevious = new Float64Array(0)
export let frameNext = new Float64Array(0)
export let frameFlags = new Uint8Array(0)
export let frameFiniteIndex = new Int32Array(0)
export let frameValue = []

// Oldest logical index still in memory
export let firstIndex = 0
// Next logical index to assign
export let nextIndex = 0
// Last frame included in the head's view
export let headIndex = -1
export let isHeadPresent = true
// Times live in a Float64Array: a double stored in a module variable, or
// returned from a call that is not inlined, is boxed on the heap
const times = new Float64Array(3)
const FRAME_TIME = 0
const LAST_TIME = 1
const CACHED_TIME = 2

export let trailLimitFrames = 10000
export let trailWindowMs = 0
export let autoLimit = true
let restoredAllowance = 0
let restoredBoundary = 0

export const slotOf = (index) => index < INT32_LIMIT ? index & frameMask : index % frameCapacity

// The clock is read once per task, and again every 1024 reads so a long
// synchronous task cannot drift. performance.now() allocates on every call,
// so reading it per publish would put the garbage collector on the hot path.
let clockFresh = false
let clockReads = 0

const markClockStale = () => { clockFresh = false }

const refreshClock = () => {
  times[CACHED_TIME] = clock()
  clockReads = 0
  if (!clockFresh) {
    clockFresh = true
    queueTask(markClockStale)
  }
}

export const taskClock = () => {
  if (!clockFresh || ++clockReads === 1024) refreshClock()
  return times[CACHED_TIME]
}

// Sets times[FRAME_TIME] to a timestamp that never goes backwards
const stampFrameTime = () => {
  if (!clockFresh || ++clockReads === 1024) refreshClock()
  const now = times[CACHED_TIME]
  times[FRAME_TIME] = now < times[LAST_TIME] ? times[LAST_TIME] : now
  times[LAST_TIME] = times[FRAME_TIME]
}

const packedNulls = (length) => {
  const array = []
  for (let i = 0; i < length; i++) array.push(null)
  return array
}

const growFrames = () => {
  const capacity = frameCapacity === 0 ? 1024 : frameCapacity * 2
  const mask = capacity - 1
  const objectIds = new Uint32Array(capacity)
  const timestamps = new Float64Array(capacity)
  const previous = new Float64Array(capacity)
  const next = new Float64Array(capacity)
  const flags = new Uint8Array(capacity)
  const finiteIndexes = new Int32Array(capacity)
  const values = packedNulls(capacity)
  for (let index = firstIndex; index < nextIndex; index++) {
    const from = slotOf(index)
    const to = index < INT32_LIMIT ? index & mask : index % capacity
    objectIds[to] = frameObjectId[from]
    timestamps[to] = frameTimestamp[from]
    previous[to] = framePrevious[from]
    next[to] = frameNext[from]
    flags[to] = frameFlags[from]
    finiteIndexes[to] = frameFiniteIndex[from]
    values[to] = frameValue[from]
  }
  frameObjectId = objectIds
  frameTimestamp = timestamps
  framePrevious = previous
  frameNext = next
  frameFlags = flags
  frameFiniteIndex = finiteIndexes
  frameValue = values
  frameCapacity = capacity
  frameMask = mask
}

// Uses times[FRAME_TIME] as the frame's timestamp
const appendFrame = (id, value, finiteIndex, flags) => {
  if (nextIndex - firstIndex >= frameCapacity) growFrames()
  const index = nextIndex
  const slot = slotOf(index)
  nextIndex = index + 1
  const previous = tipFrame[id]
  frameObjectId[slot] = id
  frameTimestamp[slot] = times[FRAME_TIME]
  framePrevious[slot] = previous
  frameNext[slot] = -1
  frameFiniteIndex[slot] = finiteIndex
  frameValue[slot] = value
  if (previous < 0) firstFrame[id] = index
  else frameNext[slotOf(previous)] = index
  tipFrame[id] = index
  objectFrameCount[id]++
  if (aliasSlot !== null) {
    attachAlias(aliasSlot, index)
    flags |= FRAME_ALIASED
  }
  frameFlags[slot] = flags
  if (frameRecordedHook !== null) frameRecordedHook(index, slot)
  if (++framesSinceSnapshot === SNAPSHOT_SPACING) takeSnapshot(index)
  return index
}

// Last live (not ignored, not purged) frame at or before `frame` in the
// object's own chain, or -1 when only the base value remains
export const resolveLive = (frame) => {
  while (frame >= firstIndex && (frameFlags[slotOf(frame)] & FRAME_DEAD) !== 0) frame = framePrevious[slotOf(frame)]
  return frame >= firstIndex ? frame : -1
}

const previousLive = (slot) => resolveLive(framePrevious[slot])

// Last frame in the object's chain at or before `limit`, dead or alive
export const lastFrameAtOrBefore = (id, limit) => {
  let frame = tipFrame[id]
  while (frame > limit) frame = framePrevious[slotOf(frame)]
  return frame >= firstIndex ? frame : -1
}

export const valueOfFrame = (id, frame) => frame < 0 ? baseValue[id] : frameValue[slotOf(frame)]

const enforceTrail = () => {
  let excess = nextIndex - firstIndex - trailLimitFrames - restoredAllowance
  while (excess-- > 0) evictOldest()
  if (trailWindowMs !== 0) {
    const cutoff = times[LAST_TIME] - trailWindowMs
    for (;;) {
      if (nextIndex - firstIndex <= 1 || frameTimestamp[slotOf(firstIndex)] >= cutoff) return
      evictOldest()
    }
  }
}

export const evictOldest = () => {
  const index = firstIndex
  const slot = slotOf(index)
  const flags = frameFlags[slot]
  const id = frameObjectId[slot]
  if (frameEvictingHook !== null) frameEvictingHook(index, slot)
  if ((flags & FRAME_PURGED) === 0) {
    if ((flags & FRAME_IGNORED) === 0) baseValue[id] = frameValue[slot]
    const next = frameNext[slot]
    if (next >= 0) {
      framePrevious[slotOf(next)] = -1
      firstFrame[id] = next
    } else {
      firstFrame[id] = -1
      tipFrame[id] = -1
    }
    if (headFrame[id] === index) headFrame[id] = -1
    objectFrameCount[id]--
  }
  if ((flags & FRAME_ALIASED) !== 0) removeAliasOf(index)
  frameValue[slot] = null
  firstIndex = index + 1
  // A head parked behind the evicted frame is pulled forward with it
  if (headIndex < index) {
    headIndex = index
    if ((flags & FRAME_DEAD) === 0) {
      headCells[id].value = baseValue[id]
      markMoved(id)
      releaseMoved(FORWARD)
    }
  }
}

// Removes the oldest frames of one stateObject beyond its own trail limit
const enforceObjectTrail = (id) => {
  const record = records[id]
  const limit = record.trailLimit
  const window = record.trailWindow
  while (true) {
    const frame = firstFrame[id]
    if (frame < 0 || frame === tipFrame[id]) return
    const slot = slotOf(frame)
    const overCount = limit !== 0 && objectFrameCount[id] > limit
    const overTime = window !== 0 && frameTimestamp[slot] < times[LAST_TIME] - window
    if (!overCount && !overTime) return
    const flags = frameFlags[slot]
    if ((flags & FRAME_IGNORED) === 0) baseValue[id] = frameValue[slot]
    const next = frameNext[slot]
    framePrevious[slotOf(next)] = -1
    firstFrame[id] = next
    if (headFrame[id] === frame) headFrame[id] = -1
    killFrame(frame, slot, flags)
  }
}

export const setTrailLimit = (frames, windowMs) => {
  trailLimitFrames = frames
  trailWindowMs = windowMs
  if (persistEnabled && autoLimit) enforceTrail()
  settle()
}

export const setAutoLimit = (enabled) => {
  autoLimit = enabled
  if (persistEnabled && autoLimit) enforceTrail()
  settle()
}

export const setObjectTrailLimit = (id, frames, windowMs) => {
  const record = records[id]
  record.trailLimit = frames
  record.trailWindow = windowMs
  if (frames === 0 && windowMs === 0) objectFlags[id] &= ~OWN_TRAIL_LIMIT
  else objectFlags[id] |= OWN_TRAIL_LIMIT
  if (persistEnabled && (frames !== 0 || windowMs !== 0)) enforceObjectTrail(id)
}

// Lets a ranged restore keep extra frames until the head leaves them
export const allowRestoredFrames = (extra, boundary) => {
  restoredAllowance = extra
  restoredBoundary = boundary
}

// ---------------------------------------------------------------------------
// Keyframe snapshots: the tip column copied every SNAPSHOT_SPACING frames, so
// a long seek costs about min(distance, objects + spacing)
// ---------------------------------------------------------------------------

const snapshots = []
let framesSinceSnapshot = 0

const createSnapshot = (capacity) => ({ index: -1, length: 0, tips: new Float64Array(capacity) })

const takeSnapshot = (index) => {
  framesSinceSnapshot = 0
  const maximum = (frameCapacity / SNAPSHOT_SPACING) + 2
  let snapshot
  if (snapshots.length >= maximum) snapshot = snapshots.shift()
  else snapshot = createSnapshot(objectCapacity)
  if (snapshot.tips.length < objectCount) snapshot.tips = new Float64Array(objectCapacity)
  const tips = snapshot.tips
  for (let id = 0; id < objectCount; id++) tips[id] = tipFrame[id]
  snapshot.length = objectCount
  snapshot.index = index
  snapshots.push(snapshot)
}

export const invalidateSnapshots = () => {
  snapshots.length = 0
  framesSinceSnapshot = 0
}

// Snapshots are pushed in index order, so the latest one at or before a
// target is found by binary search
const latestSnapshotAtOrBefore = (target) => {
  let low = 0
  let high = snapshots.length - 1
  let found = null
  while (low <= high) {
    const middle = (low + high) >> 1
    const snapshot = snapshots[middle]
    if (snapshot.index <= target) {
      found = snapshot
      low = middle + 1
    } else {
      high = middle - 1
    }
  }
  return found !== null && found.index >= firstIndex ? found : null
}

// Rebuilds every view from the nearest snapshot. Just before the oldest frame
// in memory every stateObject shows its base value, which acts as an implicit
// snapshot, so jumps far back in time are as cheap as jumps forward.
const jumpWithSnapshot = (target) => {
  const best = latestSnapshotAtOrBefore(target)
  const start = best === null ? firstIndex - 1 : best.index
  const distance = target > headIndex ? target - headIndex : headIndex - target
  if (target - start + objectCount >= distance) return false
  const candidates = candidateFrames
  if (best === null) {
    candidates.fill(-1, 0, objectCount)
  } else {
    const tips = best.tips
    const length = best.length
    for (let id = 0; id < objectCount; id++) candidates[id] = id < length ? resolveLive(tips[id]) : -1
  }
  for (let index = start + 1; index <= target; index++) {
    const slot = slotOf(index)
    if ((frameFlags[slot] & FRAME_DEAD) === 0) candidates[frameObjectId[slot]] = index
  }
  for (let id = 0; id < objectCount; id++) {
    const frame = candidates[id]
    if (frame !== headFrame[id]) {
      headFrame[id] = frame
      headCells[id].value = frame < 0 ? baseValue[id] : frameValue[slotOf(frame)]
      markMoved(id)
    }
  }
  return true
}

// ---------------------------------------------------------------------------
// Head movement
// ---------------------------------------------------------------------------

const markMoved = (id) => {
  const flags = objectFlags[id]
  if ((flags & MOVED) === 0) {
    objectFlags[id] = flags | MOVED
    movedStack[movedLength++] = id
  }
}

const releaseMoved = (direction) => {
  for (let i = 0; i < movedLength; i++) {
    const id = movedStack[i]
    const flags = objectFlags[id] & ~MOVED
    objectFlags[id] = flags
    if ((flags & HAS_SUBSCRIBERS) !== 0) markDirty(id, direction)
  }
  movedLength = 0
}

const walkForward = (from, to) => {
  for (let index = from + 1; index <= to; index++) {
    const slot = slotOf(index)
    if ((frameFlags[slot] & FRAME_DEAD) !== 0) continue
    const id = frameObjectId[slot]
    headFrame[id] = index
    headCells[id].value = frameValue[slot]
    markMoved(id)
  }
}

const walkBackward = (from, to) => {
  for (let index = from; index > to; index--) {
    const slot = slotOf(index)
    if ((frameFlags[slot] & FRAME_DEAD) !== 0) continue
    const id = frameObjectId[slot]
    const previous = previousLive(slot)
    headFrame[id] = previous
    headCells[id].value = previous < 0 ? baseValue[id] : frameValue[slotOf(previous)]
    markMoved(id)
  }
}

export const noLiveFramesAfter = (index) => {
  for (let i = nextIndex - 1; i > index; i--) {
    if ((frameFlags[slotOf(i)] & FRAME_DEAD) === 0) return false
  }
  return true
}

// Moves the head to a logical index, notifying each stateObject whose view
// changed once
export const moveHeadTo = (target) => {
  const lowest = firstIndex - 1
  const highest = nextIndex - 1
  if (target < lowest) target = lowest
  else if (target > highest) target = highest
  const previous = headIndex
  if (target !== previous) {
    const direction = target > previous ? FORWARD : REVERSE
    const distance = direction === FORWARD ? target - previous : previous - target
    if (!(distance > objectCount + SNAPSHOT_SPACING && jumpWithSnapshot(target))) {
      if (direction === FORWARD) walkForward(previous, target)
      else walkBackward(previous, target)
    }
    headIndex = target
    releaseMoved(direction)
  }
  isHeadPresent = noLiveFramesAfter(headIndex)
  if (restoredAllowance !== 0 && headIndex >= restoredBoundary) restoredAllowance = 0
  settle()
}

// Next or previous live frame index from the head, or NaN when none
export const liveFrameAfter = (index) => {
  for (let i = index + 1; i < nextIndex; i++) {
    if ((frameFlags[slotOf(i)] & FRAME_DEAD) === 0) return i
  }
  return NaN
}

export const liveFrameBefore = (index) => {
  for (let i = index - 1; i >= firstIndex; i--) {
    if ((frameFlags[slotOf(i)] & FRAME_DEAD) === 0) return i
  }
  return NaN
}

// ---------------------------------------------------------------------------
// Purging and ignoring frames
// ---------------------------------------------------------------------------

const killFrame = (index, slot, flags) => {
  frameFlags[slot] = flags | FRAME_PURGED
  if ((flags & FRAME_ALIASED) !== 0) removeAliasOf(index)
  objectFrameCount[frameObjectId[slot]]--
  if (frameUpdatedHook !== null) frameUpdatedHook(index, slot)
  frameValue[slot] = null
}

// Makes the object's newest chain frame the last one at or before `limit`
const relinkTail = (id, limit) => {
  const frame = lastFrameAtOrBefore(id, limit)
  tipFrame[id] = frame
  if (frame < 0) firstFrame[id] = -1
  else frameNext[slotOf(frame)] = -1
  tipValue[id] = valueOfFrame(id, resolveLive(frame))
}

export const purgeChainAhead = () => {
  if (isHeadPresent) return 0
  let removed = 0
  for (let index = headIndex + 1; index < nextIndex; index++) {
    const slot = slotOf(index)
    const flags = frameFlags[slot]
    if ((flags & FRAME_PURGED) !== 0) continue
    const id = frameObjectId[slot]
    if (tipFrame[id] > headIndex) relinkTail(id, headIndex)
    killFrame(index, slot, flags)
    removed++
  }
  isHeadPresent = true
  return removed
}

export const purgeObjectAhead = (id) => {
  if (isHeadPresent) return 0
  let removed = 0
  let frame = tipFrame[id]
  while (frame > headIndex) {
    const slot = slotOf(frame)
    const previous = framePrevious[slot]
    killFrame(frame, slot, frameFlags[slot])
    removed++
    frame = previous
  }
  relinkTail(id, headIndex)
  isHeadPresent = noLiveFramesAfter(headIndex)
  return removed
}

const autoPurgeBeforePublish = (id) => {
  if (chainAutoPurge) {
    purgeChainAhead()
  } else {
    purgeObjectAhead(id)
    moveHeadTo(nextIndex - 1)
  }
}

export const setChainAutoPurge = (enabled) => { chainAutoPurge = enabled }

export const setObjectAutoPurge = (id, enabled) => {
  if (enabled) objectFlags[id] |= AUTO_PURGE
  else objectFlags[id] &= ~AUTO_PURGE
}

// Returns false when the frame does not exist or was purged
export const setFrameIgnored = (index, ignored) => {
  if (index < firstIndex || index >= nextIndex) return false
  const slot = slotOf(index)
  const flags = frameFlags[slot]
  if ((flags & FRAME_PURGED) !== 0) return false
  if (ignored === ((flags & FRAME_IGNORED) !== 0)) return true
  frameFlags[slot] = ignored ? flags | FRAME_IGNORED : flags & ~FRAME_IGNORED
  const id = frameObjectId[slot]
  tipValue[id] = valueOfFrame(id, resolveLive(tipFrame[id]))
  if (index <= headIndex) {
    const view = resolveLive(lastFrameAtOrBefore(id, headIndex))
    if (view !== headFrame[id]) {
      headFrame[id] = view
      headCells[id].value = valueOfFrame(id, view)
      markMoved(id)
      releaseMoved(ignored ? REVERSE : FORWARD)
    }
  }
  isHeadPresent = noLiveFramesAfter(headIndex)
  if (frameUpdatedHook !== null) frameUpdatedHook(index, slot)
  settle()
  return true
}

// ---------------------------------------------------------------------------
// Aliases
// ---------------------------------------------------------------------------

export const framesByAlias = new Map()
export const aliasesByFrame = new Map()
let aliasSlot = null
let aliasClearQueued = false

const clearAliasSlot = () => {
  aliasSlot = null
  aliasClearQueued = false
}

export const setPendingAlias = (name) => {
  aliasSlot = name
  if (!aliasClearQueued) {
    aliasClearQueued = true
    queueTask(clearAliasSlot)
  }
}

const attachAlias = (name, index) => {
  const existing = framesByAlias.get(name)
  if (existing !== undefined) {
    aliasesByFrame.delete(existing)
    if (existing >= firstIndex && existing < nextIndex) {
      const slot = slotOf(existing)
      frameFlags[slot] &= ~FRAME_ALIASED
    }
  }
  framesByAlias.set(name, index)
  aliasesByFrame.set(index, name)
  aliasSlot = null
}

const removeAliasOf = (index) => {
  const name = aliasesByFrame.get(index)
  if (name === undefined) return
  aliasesByFrame.delete(index)
  if (framesByAlias.get(name) === index) framesByAlias.delete(name)
}

// ---------------------------------------------------------------------------
// Frame hooks for chain subscribers, tail slices and storage
// ---------------------------------------------------------------------------

let frameRecordedHook = null
let frameEvictingHook = null
let frameUpdatedHook = null
let afterFlushHook = null
const hookLists = { recorded: [], evicting: [], updated: [], afterFlush: [] }

const composeHooks = (list) => {
  if (list.length === 0) return null
  if (list.length === 1) return list[0]
  const hooks = list.slice()
  return (index, slot) => {
    for (let i = 0; i < hooks.length; i++) hooks[i](index, slot)
  }
}

export const addHook = (kind, hook) => {
  const list = hookLists[kind]
  if (!list.includes(hook)) list.push(hook)
  refreshHooks()
}

export const removeHook = (kind, hook) => {
  const list = hookLists[kind]
  const at = list.indexOf(hook)
  if (at !== -1) list.splice(at, 1)
  refreshHooks()
}

const refreshHooks = () => {
  if (hooksSuspended) return
  frameRecordedHook = composeHooks(hookLists.recorded)
  frameEvictingHook = composeHooks(hookLists.evicting)
  frameUpdatedHook = composeHooks(hookLists.updated)
  afterFlushHook = composeHooks(hookLists.afterFlush)
}

// ---------------------------------------------------------------------------
// Observation (devtools) and error reporting
// ---------------------------------------------------------------------------

export let observer = null
let observerWarned = false

export const setObserver = (callback) => {
  observer = callback
  selectVariants()
}

export const observe = (kind, id, detail) => {
  if (observer !== null) observer(kind, id, detail)
}

const subscriberFailed = (id, error) => {
  if (observer !== null) observer('error', id, error)
  else reportError(`A subscriber of ${records[id].address} threw`, error)
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

let flushScheduled = false
let flushing = false
let afterFlushPending = false

// Sync mode: an event queue drained by the outermost operation
let syncIds = new Int32Array(256)
let syncDirections = new Uint8Array(256)
const syncValues = []
let syncLength = 0
let syncRead = 0

const markDirtySync = (id, direction) => {
  if (syncLength === syncIds.length) {
    syncIds = growTyped(syncIds, syncLength * 2)
    syncDirections = growTyped(syncDirections, syncLength * 2)
  }
  syncIds[syncLength] = id
  syncDirections[syncLength] = direction
  syncValues[syncLength] = headCells[id].value
  syncLength++
}

const markDirtyBatched = (id, direction) => {
  const flags = objectFlags[id]
  objectDirection[id] = direction
  if ((flags & DIRTY) === 0) {
    objectFlags[id] = flags | DIRTY
    dirtyStack[dirtyLength++] = id
    if (!flushScheduled) scheduleFlush()
  }
}

let markDirty = executionMode === SYNC ? markDirtySync : markDirtyBatched

const flushSync = () => {
  flushing = true
  try {
    while (syncRead < syncLength) {
      const i = syncRead++
      const value = syncValues[i]
      syncValues[i] = null
      notify(syncIds[i], value, syncDirections[i])
    }
    if (afterFlushPending) {
      afterFlushPending = false
      if (afterFlushHook !== null) afterFlushHook(-1, -1)
    }
  } finally {
    syncRead = 0
    syncLength = 0
    flushing = false
  }
}

const settleSync = () => {
  if (!flushing && (syncLength !== 0 || afterFlushPending)) flushSync()
}

// Delivers queued notifications when running in sync mode; a no-op otherwise
let settle = executionMode === SYNC ? settleSync : noop
export const settleNow = () => settle()

const flushBatched = () => {
  flushScheduled = false
  const stack = dirtyStack
  const length = dirtyLength
  dirtyStack = spareStack
  spareStack = stack
  dirtyLength = 0
  flushing = true
  try {
    for (let i = 0; i < length; i++) {
      const id = stack[i]
      objectFlags[id] &= ~DIRTY
      notify(id, headCells[id].value, objectDirection[id])
    }
    if (afterFlushPending) {
      afterFlushPending = false
      if (afterFlushHook !== null) afterFlushHook(-1, -1)
    }
  } finally {
    flushing = false
  }
}

const scheduleFlush = () => {
  flushScheduled = true
  if (executionMode === MICROTASK) queueTask(flushBatched)
  else queueFrame(flushBatched)
}

// Asks for an afterFlush hook run even if no stateObject is dirty
export const requestFlush = () => {
  afterFlushPending = true
  if (executionMode !== SYNC && !flushScheduled) scheduleFlush()
}

// Delivers anything queued right now, in any execution mode
export const flushNow = () => {
  if (flushing) return
  if (executionMode === SYNC) {
    settleSync()
  } else if (dirtyLength !== 0 || afterFlushPending) {
    flushBatched()
  }
}

export const createSubProps = (state, identity, timestamp, fwd, rev, states, finiteIndex, index, timeOffset, direction, isPending, alias) => ({
  state, identity, timestamp, fwd, rev, states, finiteIndex, index, timeOffset, direction, pending: isPending, alias
})

export const finiteIndexOfValue = (id, value) => {
  const map = records[id].finiteIndexByValue
  if (map === null) return -1
  const index = map.get(value)
  return index === undefined ? -1 : index
}

const nextStateAfterHead = (id) => {
  if (isHeadPresent) return undefined
  const frame = headFrame[id]
  let next = frame >= 0 ? frameNext[slotOf(frame)] : firstFrame[id]
  while (next >= 0 && (frameFlags[slotOf(next)] & FRAME_DEAD) !== 0) next = frameNext[slotOf(next)]
  return next >= 0 ? frameValue[slotOf(next)] : undefined
}

export const buildProps = (id, state, previous, direction) => {
  const record = records[id]
  let index = -1
  let timestamp = headTimestamp[id]
  let finiteIndex = -1
  let alias = null
  let fwd
  if (persistEnabled) {
    index = headFrame[id]
    if (index >= 0) {
      const slot = slotOf(index)
      timestamp = frameTimestamp[slot]
      finiteIndex = frameFiniteIndex[slot]
      if ((frameFlags[slot] & FRAME_ALIASED) !== 0) alias = aliasesByFrame.get(index) ?? null
    } else {
      timestamp = record.startTime
      finiteIndex = finiteIndexOfValue(id, state)
    }
    fwd = nextStateAfterHead(id)
  } else {
    finiteIndex = finiteIndexOfValue(id, state)
  }
  return createSubProps(state, record.address, timestamp, fwd, previous, record.finiteStates, finiteIndex, index, timestamp - startTime, directionNames[direction], state === pending, alias)
}

const notify = (id, state, direction) => {
  const record = records[id]
  const table = record.subscriptions
  if (table === null) return
  const proceeding = table.subscribers
  const inverted = table.invertedSubscribers
  const length = proceeding.length
  const previous = lastNotifiedValue[id]
  lastNotifiedValue[id] = state
  const props = record.propsSubscriberCount === 0 ? undefined : buildProps(id, state, previous, direction)
  if (direction === REVERSE) {
    for (let i = 0; i < length; i++) {
      const callback = inverted[i] !== null ? inverted[i] : proceeding[i]
      if (callback === null) continue
      try {
        callback(state, props)
      } catch (error) {
        subscriberFailed(id, error)
      }
    }
  } else {
    for (let i = 0; i < length; i++) {
      const callback = proceeding[i]
      if (callback === null) continue
      try {
        callback(state, props)
      } catch (error) {
        subscriberFailed(id, error)
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------

let refCounter = 0

export const subscribe = (id, proceeding, inverted, proceedingRef, invertedRef, forceProps) => {
  const record = records[id]
  if (record.subscriptions === null) record.subscriptions = createSubscriptionTable()
  const table = record.subscriptions
  const refs = table.refSlots
  if (refs.has(proceedingRef)) throw new Error(`Subscription reference "${proceedingRef}" already exists on ${record.address}`)
  if (invertedRef !== null && (refs.has(invertedRef) || invertedRef === proceedingRef)) throw new Error(`Subscription reference "${invertedRef}" already exists on ${record.address}`)
  const slot = table.subscribers.length
  const wants = forceProps || proceeding.length >= 2 || (inverted !== null && inverted.length >= 2)
  table.subscribers.push(proceeding)
  table.invertedSubscribers.push(inverted)
  table.subscriberRefs.push(proceedingRef)
  table.invertedRefs.push(invertedRef)
  table.wantsProps.push(wants)
  refs.set(proceedingRef, slot * 2)
  if (invertedRef !== null) refs.set(invertedRef, slot * 2 + 1)
  if (record.liveSlots++ === 0) lastNotifiedValue[id] = headCells[id].value
  let flags = objectFlags[id] | HAS_SUBSCRIBERS
  if (wants) {
    record.propsSubscriberCount++
    flags |= WANTS_PROPS
  }
  objectFlags[id] = flags
}

export const subscribeFromArguments = (id, first, second, third, fourth, forceProps) => {
  if (typeof first !== 'function') throw new TypeError('sub() expects a callback function')
  if (typeof second === 'function') {
    const proceedingRef = third === undefined ? `sub-${id}-${refCounter++}` : third
    const invertedRef = fourth === undefined ? `sub-${id}-${refCounter++}` : fourth
    subscribe(id, first, second, proceedingRef, invertedRef, forceProps)
    return [proceedingRef, invertedRef]
  }
  const ref = second === undefined ? `sub-${id}-${refCounter++}` : second
  subscribe(id, first, null, ref, null, forceProps)
  return ref
}

export const unsubscribe = (id, ref) => {
  const record = records[id]
  const table = record.subscriptions
  if (table === null) return false
  const code = table.refSlots.get(ref)
  if (code === undefined) return false
  table.refSlots.delete(ref)
  const slot = code >> 1
  if ((code & 1) === 0) {
    table.subscribers[slot] = null
    table.subscriberRefs[slot] = null
  } else {
    table.invertedSubscribers[slot] = null
    table.invertedRefs[slot] = null
  }
  if (table.subscribers[slot] === null && table.invertedSubscribers[slot] === null) {
    record.liveSlots--
    record.deadSlots++
    if (table.wantsProps[slot]) {
      table.wantsProps[slot] = false
      if (--record.propsSubscriberCount === 0) objectFlags[id] &= ~WANTS_PROPS
    }
    if (record.liveSlots === 0) objectFlags[id] &= ~HAS_SUBSCRIBERS
    if (!flushing && record.deadSlots > record.liveSlots) compactSubscribers(record)
  }
  return true
}

// Builds a fresh table so a dispatch already holding the old arrays is safe
const compactSubscribers = (record) => {
  const old = record.subscriptions
  const table = createSubscriptionTable()
  for (let i = 0; i < old.subscribers.length; i++) {
    if (old.subscribers[i] === null && old.invertedSubscribers[i] === null) continue
    const slot = table.subscribers.length
    table.subscribers.push(old.subscribers[i])
    table.invertedSubscribers.push(old.invertedSubscribers[i])
    table.subscriberRefs.push(old.subscriberRefs[i])
    table.invertedRefs.push(old.invertedRefs[i])
    table.wantsProps.push(old.wantsProps[i])
    if (old.subscriberRefs[i] !== null) table.refSlots.set(old.subscriberRefs[i], slot * 2)
    if (old.invertedRefs[i] !== null) table.refSlots.set(old.invertedRefs[i], slot * 2 + 1)
  }
  record.subscriptions = table
  record.deadSlots = 0
}

// ---------------------------------------------------------------------------
// Publishing
// ---------------------------------------------------------------------------

const recordWithoutHistory = (id, value, finiteIndex, flags) => {
  tipValue[id] = value
  headCells[id].value = value
  if ((flags & WANTS_PROPS) !== 0) headTimestamp[id] = taskClock()
  if ((flags & HAS_SUBSCRIBERS) !== 0) markDirty(id, FORWARD)
}

const canMerge = (last) => {
  const slot = slotOf(last)
  if ((frameFlags[slot] & (FRAME_ALIASED | FRAME_PENDING | FRAME_BASE | FRAME_DEAD)) !== 0) return false
  if (mergeMode === MERGE_BY_TIME) return times[FRAME_TIME] - frameTimestamp[slot] < mergeWindow
  return nextIndex - 1 - last < mergeWindow
}

const mergeFrame = (id, last, value, finiteIndex, flags) => {
  const slot = slotOf(last)
  frameValue[slot] = value
  frameFiniteIndex[slot] = finiteIndex
  tipValue[id] = value
  if (isHeadPresent || last <= headIndex) {
    headCells[id].value = value
    if ((flags & HAS_SUBSCRIBERS) !== 0) markDirty(id, FORWARD)
  }
  if (frameRecordedHook !== null) frameRecordedHook(last, slot)
}

const recordHistory = (id, value, finiteIndex, flags) => {
  if (!isHeadPresent && (chainAutoPurge || (flags & AUTO_PURGE) !== 0)) autoPurgeBeforePublish(id)
  stampFrameTime()
  const last = tipFrame[id]
  if (mergeMode !== MERGE_OFF && last >= 0 && aliasSlot === null && value !== pending && canMerge(last)) {
    mergeFrame(id, last, value, finiteIndex, flags)
    return
  }
  const index = appendFrame(id, value, finiteIndex, value === pending ? FRAME_PENDING : 0)
  tipValue[id] = value
  if (isHeadPresent) {
    headIndex = index
    headFrame[id] = index
    headCells[id].value = value
    if ((flags & HAS_SUBSCRIBERS) !== 0) markDirty(id, FORWARD)
  }
  if ((flags & OWN_TRAIL_LIMIT) !== 0) enforceObjectTrail(id)
  if (autoLimit) enforceTrail()
}

const observedRecord = (record) => (id, value, finiteIndex, flags) => {
  record(id, value, finiteIndex, flags)
  if (observer !== null) observer('stateChange', id, value)
}

let recordFrame = recordWithoutHistory

const validateValue = (value) => {
  if (typeof value === 'object' && value !== null) structuredClone(value)
  return value
}

const deepFreeze = (value) => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  Object.freeze(value)
  if (value instanceof Map) {
    for (const [key, entry] of value) {
      deepFreeze(key)
      deepFreeze(entry)
    }
  } else if (value instanceof Set) {
    for (const entry of value) deepFreeze(entry)
  } else if (!ArrayBuffer.isView(value)) {
    for (const key of Object.keys(value)) deepFreeze(value[key])
  }
  return value
}

const validateAndFreeze = (value) => deepFreeze(validateValue(value))

const cloneValue = (value) => typeof value === 'object' && value !== null ? structuredClone(value) : value

// Picked by o.config(): identity, validate, validate and freeze, or clone
let prepareValue = identity

export const checkSymbol = (value) => {
  if (value === pending) return value
  if (value === republish) throw new TypeError('republish can only be used through a mutex release function')
  throw new TypeError('Symbols cannot be published as state')
}

const rejectNaN = (id) => {
  if (observer !== null) observer('nonChange', id, NaN)
  reportError(`NaN was published to ${records[id].address} and ignored`)
  return undefined
}

export const finiteIndexFor = (id, value) => {
  const index = records[id].finiteIndexByValue.get(value)
  if (index === undefined) throw new TypeError(`${String(value)} is not one of the finite states of ${records[id].address}`)
  return index
}

export const checkTransition = (id, to, current) => {
  const record = records[id]
  const from = finiteIndexOfValue(id, current)
  if (from < 0 || from === to) return
  const count = record.finiteStates.length
  if (record.transitionTable[from * count + to] === 0) {
    throw new TypeError(`${record.address} cannot move from ${String(record.finiteStates[from])} to ${String(record.finiteStates[to])}`)
  }
}

// Validates a value for a stateObject. Returns the value to store and leaves
// its finite index in `validatedFiniteIndex`. Returns undefined when the value
// must be ignored.
export let validatedFiniteIndex = -1

export const validateForCommit = (id, value, current) => {
  validatedFiniteIndex = -1
  if (value === undefined) return undefined
  if (!allowNaN && Number.isNaN(value)) return rejectNaN(id)
  if (typeof value === 'symbol') value = checkSymbol(value)
  if ((objectFlags[id] & FINITE) !== 0) {
    if (value === pending) return value
    const index = finiteIndexFor(id, value)
    if ((objectFlags[id] & TRANSITIONS) !== 0) checkTransition(id, index, current)
    validatedFiniteIndex = index
    return records[id].finiteStates[index]
  }
  return value === pending ? value : prepareValue(value)
}

// Records a value with no lock check
const commitValue = (id, value) => {
  if (value === undefined) return undefined
  if (!allowNaN && Number.isNaN(value)) return rejectNaN(id)
  if (typeof value === 'symbol') value = checkSymbol(value)
  const flags = objectFlags[id]
  let finiteIndex = -1
  if ((flags & FINITE) !== 0) {
    if (value !== pending) {
      finiteIndex = finiteIndexFor(id, value)
      if ((flags & TRANSITIONS) !== 0) checkTransition(id, finiteIndex, tipValue[id])
      value = records[id].finiteStates[finiteIndex]
    }
  } else if (value !== pending) {
    value = prepareValue(value)
  }
  recordFrame(id, value, finiteIndex, flags)
  settle()
  return value
}

export const publishValue = (id, value) => {
  if (activeLocks !== 0 && isBlocked(id)) return bufferPublish(chainLocked ? CHAIN_KEY : id, id, value, BUFFERED_VALUE)
  return commitValue(id, value)
}

export const publishFromCallback = (id, callback) => {
  if (activeLocks !== 0 && isBlocked(id)) return bufferPublish(chainLocked ? CHAIN_KEY : id, id, callback, BUFFERED_CALLBACK)
  aliasSlot = null
  const result = callback(tipValue[id])
  if (result === undefined) return undefined
  if (result instanceof Promise) return publishAsync(id, result)
  return publishValue(id, result)
}

// ---------------------------------------------------------------------------
// Mutex, buffer and async callbacks
// ---------------------------------------------------------------------------

let activeLocks = 0
export let chainLocked = false
let chainLockToken = null
const buffers = new Map()

const isBlocked = (id) => chainLocked || (objectFlags[id] & LOCKED) !== 0

const createBuffer = () => ({ ids: [], payloads: [], kinds: [], read: 0 })

const bufferPublish = (key, id, payload, kind) => {
  let buffer = buffers.get(key)
  if (buffer === undefined) {
    buffer = createBuffer()
    buffers.set(key, buffer)
  }
  buffer.ids.push(id)
  buffer.payloads.push(payload)
  buffer.kinds.push(kind)
  if (observer !== null) observer('buffered', id, payload)
  return undefined
}

const keyIsLocked = (key) => key === CHAIN_KEY ? chainLocked : (objectFlags[key] & LOCKED) !== 0

const drainBuffer = (key) => {
  const buffer = buffers.get(key)
  if (buffer === undefined) return
  while (buffer.read < buffer.ids.length) {
    if (keyIsLocked(key)) return
    const i = buffer.read++
    const id = buffer.ids[i]
    const payload = buffer.payloads[i]
    buffer.payloads[i] = null
    try {
      if (buffer.kinds[i] === BUFFERED_VALUE) publishValue(id, payload)
      else publishFromCallback(id, payload)
    } catch (error) {
      reportError(`A buffered publish to ${records[id].address} failed`, error)
    }
  }
  if (buffers.get(key) === buffer) buffers.delete(key)
}

export const bufferedEntries = () => {
  const entries = []
  for (const [key, buffer] of buffers) {
    for (let i = buffer.read; i < buffer.ids.length; i++) {
      const id = buffer.ids[i]
      entries.push({
        target: key === CHAIN_KEY ? 'chain' : records[key].address,
        identity: records[id].address,
        kind: buffer.kinds[i] === BUFFERED_VALUE ? 'value' : 'callback',
        payload: buffer.payloads[i]
      })
    }
  }
  return entries
}

export const isObjectLocked = (id) => (objectFlags[id] & LOCKED) !== 0

export const lockObject = (id, token) => {
  if ((objectFlags[id] & LOCKED) !== 0) throw new Error(`${records[id].address} is already locked`)
  objectFlags[id] |= LOCKED
  records[id].lockToken = token
  activeLocks++
  if (observer !== null) observer('mutex', id, 'lock')
}

export const unlockObject = (id) => {
  if ((objectFlags[id] & LOCKED) === 0) return false
  objectFlags[id] &= ~LOCKED
  records[id].lockToken = null
  activeLocks--
  if (observer !== null) observer('mutex', id, 'unlock')
  drainBuffer(id)
  settle()
  return true
}

export const lockChain = (token) => {
  if (chainLocked) throw new Error('The chain is already locked')
  chainLocked = true
  chainLockToken = token
  activeLocks++
  if (observer !== null) observer('mutex', -1, 'lock')
}

export const unlockChain = () => {
  if (!chainLocked) return false
  chainLocked = false
  chainLockToken = null
  activeLocks--
  if (observer !== null) observer('mutex', -1, 'unlock')
  drainBuffer(CHAIN_KEY)
  settle()
  return true
}

export const chainLockHeldBy = (token) => chainLocked && chainLockToken === token

const runHolderCallback = (id, callback) => {
  aliasSlot = null
  const result = callback(tipValue[id])
  if (result instanceof Promise) throw new TypeError('A release function cannot take an async callback')
  return result
}

// Publishes as the holder of an object lock: bypasses that lock only
export const publishAsObjectHolder = (id, input) => {
  if (input === republish) return republishObject(id)
  const value = typeof input === 'function' ? runHolderCallback(id, input) : input
  if (chainLocked) return bufferPublish(CHAIN_KEY, id, value, BUFFERED_VALUE)
  return commitValue(id, value)
}

// Publishes as the holder of the chain lock: bypasses the chain lock only
export const publishAsChainHolder = (id, input) => {
  if (input === republish) return republishObject(id)
  if ((objectFlags[id] & LOCKED) !== 0) {
    return bufferPublish(id, id, input, typeof input === 'function' ? BUFFERED_CALLBACK : BUFFERED_VALUE)
  }
  const value = typeof input === 'function' ? runHolderCallback(id, input) : input
  return commitValue(id, value)
}

const republishObject = (id) => {
  if ((objectFlags[id] & HAS_SUBSCRIBERS) !== 0) markDirty(id, FORWARD)
  settle()
  return headCells[id].value
}

const warnIfAnimated = (id) => {
  const record = records[id]
  const now = clock()
  if (now - record.previousPublishTime < 50) {
    warn(`${record.address} is animated and fetched at once: an async callback locked it while it was publishing every frame. Animate and fetch with separate stateObjects.`)
  }
}

let trackPublishTimes = false

const publishAsync = (id, promise) => {
  if (syncOnly) throw new TypeError(`An async callback was published to ${records[id].address} while asyncCallbacks is 'sync-only'`)
  if (trackPublishTimes) warnIfAnimated(id)
  const token = {}
  lockObject(id, token)
  let timedOut = false
  const timer = unrefTimer(setTimeout(() => {
    if (records[id].lockToken !== token) return
    timedOut = true
    if (observer !== null) observer('mutex', id, 'timeout')
    else warn(`An async callback on ${records[id].address} held its lock for ${asyncLockTimeout} ms and was released`)
    unlockObject(id)
  }, asyncLockTimeout))
  return promise.then((value) => {
    clearTimeout(timer)
    if (timedOut || records[id].lockToken !== token) {
      if (observer !== null) observer('nonChange', id, value)
      return undefined
    }
    try {
      return value === undefined ? undefined : publishAsObjectHolder(id, value)
    } finally {
      unlockObject(id)
    }
  }, (error) => {
    clearTimeout(timer)
    if (records[id].lockToken === token) unlockObject(id)
    throw error
  })
}

// Dev-mode bookkeeping for the animated-and-fetched warning
const trackedRecord = (record) => (id, value, finiteIndex, flags) => {
  const entry = records[id]
  entry.previousPublishTime = entry.lastPublishTime
  entry.lastPublishTime = clock()
  record(id, value, finiteIndex, flags)
}

// ---------------------------------------------------------------------------
// The stateObject function and its access variants
// ---------------------------------------------------------------------------

const readHead = (id) => headCells[id].value
const writeDirect = (id, input) => typeof input === 'function' ? publishFromCallback(id, input) : publishValue(id, input)

export const baseAccess = { read: readHead, write: writeDirect, subscribe: subscribeFromArguments, unsubscribe }

let readState = readHead
let writeState = writeDirect
export let subscribeRoute = subscribeFromArguments
export let unsubscribeRoute = unsubscribe

// Isolation (o.isolate) and dev-mode scope checks wrap these
export const installAccess = (access) => {
  accessLayered = access !== baseAccess
  readState = access.read
  writeState = access.write
  subscribeRoute = access.subscribe
  unsubscribeRoute = access.unsubscribe
}

// With no access layer (isolation, dev-mode scope) a get reads the captured
// cell directly; layered reads go through readState
let accessLayered = false

export const createStateObject = (id) => {
  const cell = headCells[id]
  return (input = GET) => input === GET ? (accessLayered ? readState(id) : cell.value) : writeState(id, input)
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const executionModes = { sync: SYNC, 'async-queue': MICROTASK, 'async-frame': ANIMATION_FRAME }

const parseMergeFidelity = (value) => {
  if (value === 0 || value === false || value === null) return [MERGE_OFF, 0]
  if (typeof value === 'number') {
    if (!(value >= 0)) throw new RangeError('mergeFidelity must be a positive frame count or a duration such as \'200ms\'')
    return [value === 0 ? MERGE_OFF : MERGE_BY_FRAMES, value]
  }
  const duration = parseDuration(value)
  if (Number.isNaN(duration)) throw new RangeError('mergeFidelity must be a positive frame count or a duration such as \'200ms\'')
  return [duration === 0 ? MERGE_OFF : MERGE_BY_TIME, duration]
}

const selectVariants = () => {
  allowNaN = settings.allowNaN === true
  markDirty = executionMode === SYNC ? markDirtySync : markDirtyBatched
  settle = executionMode === SYNC ? settleSync : noop
  const merge = parseMergeFidelity(settings.mergeFidelity)
  mergeMode = merge[0]
  mergeWindow = merge[1]
  if (settings.clone) prepareValue = cloneValue
  else if (settings.development === 'freeze') prepareValue = validateAndFreeze
  else if (settings.development) prepareValue = validateValue
  else prepareValue = identity
  syncOnly = settings.asyncCallbacks === 'sync-only'
  asyncLockTimeout = settings.asyncLockTimeout
  trackPublishTimes = Boolean(settings.development)
  let record = persistEnabled ? recordHistory : recordWithoutHistory
  if (trackPublishTimes) record = trackedRecord(record)
  if (observer !== null) record = observedRecord(record)
  recordFrame = record
  if (settings.observe && observer === null && !observerWarned) {
    observerWarned = true
    warn('observe is set but nothing is listening; import \'soucouyant/devtools\' to log events')
  }
}

const startHistory = () => {
  invalidateSnapshots()
  firstIndex = nextIndex
  headIndex = nextIndex - 1
  isHeadPresent = true
  for (let id = 0; id < objectCount; id++) {
    baseValue[id] = headCells[id].value
    tipValue[id] = headCells[id].value
    headFrame[id] = -1
    tipFrame[id] = -1
    firstFrame[id] = -1
    objectFrameCount[id] = 0
  }
}

const stopHistory = () => {
  if (!isHeadPresent) moveHeadTo(nextIndex - 1)
  for (let index = firstIndex; index < nextIndex; index++) frameValue[slotOf(index)] = null
  framesByAlias.clear()
  aliasesByFrame.clear()
  firstIndex = nextIndex
  headIndex = nextIndex - 1
  invalidateSnapshots()
  for (let id = 0; id < objectCount; id++) {
    headFrame[id] = -1
    tipFrame[id] = -1
    firstFrame[id] = -1
    objectFrameCount[id] = 0
    baseValue[id] = headCells[id].value
  }
}

export const knownSettings = new Set(Object.keys(settings))

export const configure = (options) => {
  if (options === null || typeof options !== 'object') throw new TypeError('o.config() expects an options object')
  for (const key of Object.keys(options)) {
    if (!knownSettings.has(key)) throw new TypeError(`Unknown configuration option "${key}"`)
  }
  if ('execution' in options && !(options.execution in executionModes)) {
    throw new TypeError('execution must be \'sync\', \'async-queue\' or \'async-frame\'')
  }
  if ('asyncCallbacks' in options && options.asyncCallbacks !== 'lock' && options.asyncCallbacks !== 'sync-only') {
    throw new TypeError('asyncCallbacks must be \'lock\' or \'sync-only\'')
  }
  if ('seekTime' in options && options.seekTime !== 'session' && options.seekTime !== 'epoch') {
    throw new TypeError('seekTime must be \'session\' or \'epoch\'')
  }
  if ('mergeFidelity' in options) parseMergeFidelity(options.mergeFidelity)
  const previousPersist = persistEnabled
  const previousMode = executionMode
  for (const key of Object.keys(options)) {
    if (key === 'offlineStorage') settings.offlineStorage = { ...settings.offlineStorage, ...options.offlineStorage }
    else settings[key] = options[key]
  }
  const nextMode = executionModes[settings.execution]
  if (nextMode !== previousMode) {
    flushNow()
    executionMode = nextMode
  }
  persistEnabled = settings.persist === true
  if (persistEnabled && !previousPersist) startHistory()
  if (!persistEnabled && previousPersist) stopHistory()
  selectVariants()
  for (const listener of configListeners) listener(settings)
  return settings
}

const configListeners = []
export const onConfigure = (listener) => { configListeners.push(listener) }

// ---------------------------------------------------------------------------
// Bulk rebuild of the log, used by chain.replace(), chain.clear() and restore
// ---------------------------------------------------------------------------

export const resetLog = (startIndex) => {
  for (let index = firstIndex; index < nextIndex; index++) frameValue[slotOf(index)] = null
  framesByAlias.clear()
  aliasesByFrame.clear()
  invalidateSnapshots()
  firstIndex = startIndex
  nextIndex = startIndex
  headIndex = startIndex - 1
  isHeadPresent = true
  for (let id = 0; id < objectCount; id++) {
    tipFrame[id] = -1
    firstFrame[id] = -1
    headFrame[id] = -1
    objectFrameCount[id] = 0
  }
}

// A purged frame that occupies a slot but belongs to no chain
const writePlaceholder = (timestamp) => {
  if (nextIndex - firstIndex >= frameCapacity) growFrames()
  const slot = slotOf(nextIndex)
  frameFlags[slot] = FRAME_PURGED
  frameValue[slot] = null
  frameObjectId[slot] = 0
  frameTimestamp[slot] = timestamp
  framePrevious[slot] = -1
  frameNext[slot] = -1
  frameFiniteIndex[slot] = -1
  nextIndex++
}

// Appends a frame with a known index and timestamp during a rebuild
export const loadFrame = (index, id, value, finiteIndex, flags, timestamp, alias) => {
  if (index < nextIndex) throw new RangeError('Frames must be loaded in increasing index order')
  if (nextIndex === firstIndex) {
    firstIndex = index
    nextIndex = index
  }
  for (let gap = index - nextIndex; gap > 0; gap--) writePlaceholder(timestamp)
  if (timestamp > times[LAST_TIME]) times[LAST_TIME] = timestamp
  times[FRAME_TIME] = timestamp
  if ((flags & FRAME_PURGED) !== 0) {
    writePlaceholder(timestamp)
    return index
  }
  if (alias !== null && alias !== undefined) aliasSlot = alias
  appendFrame(id, value, finiteIndex, flags & ~FRAME_ALIASED)
  if ((flags & FRAME_IGNORED) === 0) tipValue[id] = value
  return index
}

// Rebuilds must not echo loaded frames to storage or chain subscribers
let hooksSuspended = false

export const suspendHooks = () => {
  hooksSuspended = true
  frameRecordedHook = null
  frameEvictingHook = null
  frameUpdatedHook = null
}

export const resumeHooks = () => {
  hooksSuspended = false
  refreshHooks()
}

// Recomputes every stateObject's head view after a rebuild and notifies the
// ones that changed
export const finishRebuild = (headTarget) => {
  if (headTarget > nextIndex - 1) headTarget = nextIndex - 1
  if (headTarget < firstIndex - 1) headTarget = firstIndex - 1
  headIndex = headTarget
  for (let id = 0; id < objectCount; id++) {
    const frame = resolveLive(lastFrameAtOrBefore(id, headIndex))
    headFrame[id] = frame
    const value = valueOfFrame(id, frame)
    if (value !== headCells[id].value) {
      headCells[id].value = value
      markMoved(id)
    }
  }
  isHeadPresent = noLiveFramesAfter(headIndex)
  releaseMoved(FORWARD)
  settle()
}

export const setBaseValue = (id, value) => { baseValue[id] = value }

const collectFrames = () => {
  const kept = []
  for (let index = firstIndex; index < nextIndex; index++) {
    const slot = slotOf(index)
    kept.push([index, frameObjectId[slot], frameValue[slot], frameFiniteIndex[slot], frameFlags[slot], frameTimestamp[slot], aliasesByFrame.get(index) ?? null])
  }
  return kept
}

// Shifts every logical index by `offset`, so a session continues numbering
// after frames already in storage
export const rebaseLog = (offset) => {
  const kept = collectFrames()
  const savedHead = headIndex
  const savedPresent = isHeadPresent
  const start = firstIndex + offset
  suspendHooks()
  resetLog(start)
  for (const entry of kept) loadFrame(entry[0] + offset, entry[1], entry[2], entry[3], entry[4], entry[5], entry[6])
  if (kept.length === 0) {
    firstIndex = start
    nextIndex = start
  }
  resumeHooks()
  finishRebuild(savedPresent ? nextIndex - 1 : savedHead + offset)
}

// Prepends older frames from storage in front of the frames in memory.
// `frames` must be sorted by index and end before firstIndex.
export const prependFrames = (frames, resolveId) => {
  if (frames.length === 0) return 0
  const keep = collectFrames()
  const savedHead = headIndex
  const savedPresent = isHeadPresent
  const savedBase = baseValue.slice()
  suspendHooks()
  resetLog(frames[0].index)
  let loaded = 0
  const firstLoadedValue = new Map()
  for (const frame of frames) {
    const id = resolveId(frame.identity)
    if (id < 0) continue
    if (!firstLoadedValue.has(id)) firstLoadedValue.set(id, frame.state)
    loadFrame(frame.index, id, frame.state, frame.finiteIndex, frame.flags, frame.timestamp, frame.alias)
    loaded++
  }
  for (let id = 0; id < objectCount; id++) {
    baseValue[id] = firstLoadedValue.has(id) ? firstLoadedValue.get(id) : savedBase[id]
  }
  for (const entry of keep) loadFrame(entry[0], entry[1], entry[2], entry[3], entry[4], entry[5], entry[6])
  resumeHooks()
  finishRebuild(savedPresent ? nextIndex - 1 : savedHead)
  return loaded
}

// Registry growth must also grow these when other modules need them
export const objectCapacityNow = () => objectCapacity
export const getAutoPurge = () => chainAutoPurge
export const timeOfLastFrame = () => times[LAST_TIME]
