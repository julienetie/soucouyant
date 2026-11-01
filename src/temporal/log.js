// Recorded history: the frame log, the head, purging, ignoring, aliases,
// merging, trail limits and bulk rebuilds. Loading this module plugs a
// recorder and history-aware subscription props into the core engine.
//
// The frame log is a struct-of-arrays ring buffer, one row per recorded
// frame. Logical frame indices only ever grow; the physical slot is
// index & mask. Each stateObject's own history is a linked list threaded
// through the log.

import {
  pending,
  FRAME_PENDING, FRAME_IGNORED, FRAME_PURGED, FRAME_ALIASED, FRAME_BASE, FRAME_DEAD,
  AUTO_PURGE, OWN_TRAIL_LIMIT, MOVED, HAS_SUBSCRIBERS, FORWARD, REVERSE, directionNames,
  SNAPSHOT_SPACING, INT32_LIMIT
} from '../constants.js'
import { queueTask, startTime } from '../environment.js'
import {
  objectCount, objectFlags, headCells, tipValue, records, markDirty, settleNow, tickClock, clockCell,
  createSubProps, finiteIndexOfValue, setRecorder, setHistoryProps, registerSettings, onConfigure,
  onObjectsGrown, onObjectRegistered, settings, objectCapacityNow
} from '../engine.js'

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

const MERGE_OFF = 0
const MERGE_BY_TIME = 1
const MERGE_BY_FRAMES = 2

export let persistEnabled = false
let mergeMode = MERGE_BY_TIME
let mergeWindow = 200
let chainAutoPurge = false

// ---------------------------------------------------------------------------
// Per-stateObject history columns, grown with the core registry
// ---------------------------------------------------------------------------

// Logical frame index shown at the head, or -1 for the base value
export let headFrame = new Float64Array(0)
// Logical index of the newest frame in the object's chain, or -1
export let tipFrame = new Float64Array(0)
// Logical index of the oldest frame in memory for the object, or -1
export let firstFrame = new Float64Array(0)
let objectFrameCount = new Uint32Array(0)
let movedStack = new Int32Array(0)
let movedLength = 0
let candidateFrames = new Float64Array(0)
// State before the oldest frame still in memory
export const baseValue = []

const grownFloat64 = (array, capacity) => {
  const next = new Float64Array(capacity).fill(-1)
  next.set(array)
  return next
}

const growTyped = (array, capacity) => {
  const next = new array.constructor(capacity)
  next.set(array)
  return next
}

const growHistoryColumns = (capacity) => {
  headFrame = grownFloat64(headFrame, capacity)
  tipFrame = grownFloat64(tipFrame, capacity)
  firstFrame = grownFloat64(firstFrame, capacity)
  candidateFrames = grownFloat64(candidateFrames, capacity)
  objectFrameCount = growTyped(objectFrameCount, capacity)
  movedStack = growTyped(movedStack, capacity)
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
const times = new Float64Array(2)
const FRAME_TIME = 0
const LAST_TIME = 1

export let trailLimitFrames = 10000
export let trailWindowMs = 0
export let autoLimit = true
let restoredAllowance = 0
let restoredBoundary = 0

export const slotOf = (index) => index < INT32_LIMIT ? index & frameMask : index % frameCapacity

// Sets times[FRAME_TIME] to a timestamp that never goes backwards
const stampFrameTime = () => {
  tickClock()
  const now = clockCell[0]
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
  settleNow()
}

export const setAutoLimit = (enabled) => {
  autoLimit = enabled
  if (persistEnabled && autoLimit) enforceTrail()
  settleNow()
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
  else snapshot = createSnapshot(objectCapacityNow())
  if (snapshot.tips.length < objectCount) snapshot.tips = new Float64Array(objectCapacityNow())
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
  settleNow()
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
  settleNow()
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

// Drops a pending alias another timeline has already used
export const clearPendingAlias = () => { aliasSlot = null }

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
const hookLists = { recorded: [], evicting: [], updated: [] }

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
}

// ---------------------------------------------------------------------------
// Subscription props while history is recorded
// ---------------------------------------------------------------------------

const nextStateAfterHead = (id) => {
  if (isHeadPresent) return undefined
  const frame = headFrame[id]
  let next = frame >= 0 ? frameNext[slotOf(frame)] : firstFrame[id]
  while (next >= 0 && (frameFlags[slotOf(next)] & FRAME_DEAD) !== 0) next = frameNext[slotOf(next)]
  return next >= 0 ? frameValue[slotOf(next)] : undefined
}

const historyProps = (id, state, previous, direction) => {
  const record = records[id]
  const index = headFrame[id]
  let timestamp
  let finiteIndex
  let alias = null
  if (index >= 0) {
    const slot = slotOf(index)
    timestamp = frameTimestamp[slot]
    finiteIndex = frameFiniteIndex[slot]
    if ((frameFlags[slot] & FRAME_ALIASED) !== 0) alias = aliasesByFrame.get(index) ?? null
  } else {
    timestamp = record.startTime
    finiteIndex = finiteIndexOfValue(id, state)
  }
  return createSubProps(state, record.address, timestamp, nextStateAfterHead(id), previous, record.finiteStates, finiteIndex, index, timestamp - startTime, directionNames[direction], state === pending, alias)
}

// ---------------------------------------------------------------------------
// Recording: the recorder the core engine calls for every publish
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

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

const offlineModes = ['disabled', 'all', 'excess']

const validateSettings = (options) => {
  if ('seekTime' in options && options.seekTime !== 'session' && options.seekTime !== 'epoch') {
    throw new TypeError('seekTime must be \'session\' or \'epoch\'')
  }
  if ('mergeFidelity' in options) parseMergeFidelity(options.mergeFidelity)
  const storage = options.offlineStorage
  if (storage !== undefined && storage !== null && 'mode' in storage && !offlineModes.includes(storage.mode)) {
    throw new TypeError('offlineStorage.mode must be \'disabled\', \'all\' or \'excess\'')
  }
}

const applyHistorySettings = () => {
  const merge = parseMergeFidelity(settings.mergeFidelity)
  mergeMode = merge[0]
  mergeWindow = merge[1]
  const persist = settings.persist === true
  if (persist === persistEnabled) return
  persistEnabled = persist
  if (persist) startHistory()
  else stopHistory()
  setRecorder(persist ? recordHistory : null)
  setHistoryProps(persist ? historyProps : null)
}

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
  settleNow()
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

export const getAutoPurge = () => chainAutoPurge
export const timeOfLastFrame = () => times[LAST_TIME]

// ---------------------------------------------------------------------------
// Plugging into the core engine
// ---------------------------------------------------------------------------

const recordBaseFrame = (id, initial, finite) => {
  baseValue.push(initial)
  if (!persistEnabled) return
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

registerSettings({
  persist: false,
  mergeFidelity: '200ms',
  seekTime: 'session',
  databaseName: 'soucouyant',
  objectStoreName: 'transient-state',
  offlineStorage: { mode: 'disabled', excessLimit: Infinity, adapter: null }
}, validateSettings)

// stateObjects declared before this module loaded start from their state now
for (let id = baseValue.length; id < objectCount; id++) baseValue.push(headCells[id].value)
onObjectsGrown(growHistoryColumns)
onObjectRegistered(recordBaseFrame)
onConfigure(applyHistorySettings)
