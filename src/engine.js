// The core engine: the registry, publishing, notifications, subscriptions,
// the mutex and configuration. Everything on the hot path (get, publish,
// notify) lives in this one module so it reads its columns as module
// bindings and calls its own variants directly.
//
// Recorded history is not here. soucouyant-temporal.js plugs it in through
// setRecorder(), setHistoryProps(), registerSettings() and the registry
// hooks, so core alone carries none of it.
//
// Data layout: one row per stateObject, hot fields in typed columns indexed
// by the stateObject's integer id, cold fields in one shape-stable record.

import {
  pending, republish,
  FINITE, LOCKED, DIRTY, TRANSITIONS, WANTS_PROPS, HAS_SUBSCRIBERS,
  FORWARD, REVERSE, directionNames,
  BUFFERED_VALUE, BUFFERED_CALLBACK, ALL_KEY
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
  execution: defaultExecution,
  observe: false,
  development: false,
  clone: false,
  asyncCallbacks: 'lock',
  asyncLockTimeout: 10000
}

// Settings that soucouyant-temporal.js adds when it loads
const temporalSettingNames = ['persist', 'mergeFidelity', 'offlineStorage', 'seekTime', 'databaseName', 'objectStoreName']

const SYNC = 0
const MICROTASK = 1
const ANIMATION_FRAME = 2

// Hot-path copies of settings, so the hot path reads module bindings
let allowNaN = false
let executionMode = defaultExecution === 'sync' ? SYNC : defaultExecution === 'async-queue' ? MICROTASK : ANIMATION_FRAME
let syncOnly = false
let asyncLockTimeout = 10000

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export let objectCount = 0
let objectCapacity = 0

export let objectFlags = new Uint16Array(0)
let headTimestamp = new Float64Array(0)
let objectDirection = new Uint8Array(0)
let dirtyStack = new Int32Array(0)
let spareStack = new Int32Array(0)
let dirtyLength = 0

// State at the head, one { value } cell per stateObject. Each stateObject
// function captures its own cell, so a get is a single field load instead of
// an array element load and bounds check.
export const headCells = []
const createCell = (value) => ({ value })
export const headValueOf = (id) => headCells[id].value
// Newest recorded state: what publish callbacks receive. Without history it
// always equals the head state.
export const tipValue = []
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

// Plug-ins (temporal) keep their own per-stateObject columns and grow them
// with the registry
const growthListeners = []
const registrationListeners = []
export const onObjectsGrown = (listener) => {
  growthListeners.push(listener)
  if (objectCapacity !== 0) listener(objectCapacity)
}
export const onObjectRegistered = (listener) => { registrationListeners.push(listener) }

const growObjects = () => {
  const capacity = objectCapacity === 0 ? 64 : objectCapacity * 2
  headTimestamp = grownFloat64(headTimestamp, capacity, 0)
  objectFlags = growTyped(objectFlags, capacity)
  objectDirection = growTyped(objectDirection, capacity)
  dirtyStack = growTyped(dirtyStack, capacity)
  spareStack = growTyped(spareStack, capacity)
  objectCapacity = capacity
  for (let i = 0; i < growthListeners.length; i++) growthListeners[i](capacity)
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
  for (let i = 0; i < registrationListeners.length; i++) registrationListeners[i](id, initial, finite)
  return id
}

// ---------------------------------------------------------------------------
// The task clock. performance.now() allocates on every call, so it is read
// once per task, and again every 1024 reads so a long synchronous task
// cannot drift. The time lives in a Float64Array cell: a double stored in a
// module variable, or returned from a call that is not inlined, is boxed.
// ---------------------------------------------------------------------------

export const clockCell = new Float64Array(1)
let clockFresh = false
let clockReads = 0

const markClockStale = () => { clockFresh = false }

const refreshClock = () => {
  clockCell[0] = clock()
  clockReads = 0
  if (!clockFresh) {
    clockFresh = true
    queueTask(markClockStale)
  }
}

// Brings clockCell[0] up to date
export const tickClock = () => {
  if (!clockFresh || ++clockReads === 1024) refreshClock()
}

export const taskClock = () => {
  tickClock()
  return clockCell[0]
}

// ---------------------------------------------------------------------------
// Observation (devtools) and error reporting
// ---------------------------------------------------------------------------

// Run after each flush: temporal uses it to deliver chain subscriptions
let afterFlushHook = null
const afterFlushListeners = []

export const addAfterFlush = (listener) => {
  if (!afterFlushListeners.includes(listener)) afterFlushListeners.push(listener)
  afterFlushHook = afterFlushListeners.length === 0 ? null : runAfterFlush
}

export const removeAfterFlush = (listener) => {
  const at = afterFlushListeners.indexOf(listener)
  if (at !== -1) afterFlushListeners.splice(at, 1)
  afterFlushHook = afterFlushListeners.length === 0 ? null : runAfterFlush
}

const runAfterFlush = () => {
  for (let i = 0; i < afterFlushListeners.length; i++) afterFlushListeners[i]()
}

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

export let markDirty = executionMode === SYNC ? markDirtySync : markDirtyBatched

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
      if (afterFlushHook !== null) afterFlushHook()
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
      if (afterFlushHook !== null) afterFlushHook()
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

// Installed by soucouyant-temporal.js while history is recorded: fills index,
// fwd, alias and frame timestamps
let historyProps = null
export const setHistoryProps = (builder) => { historyProps = builder }

export const buildProps = (id, state, previous, direction) => {
  if (historyProps !== null) return historyProps(id, state, previous, direction)
  const record = records[id]
  const timestamp = headTimestamp[id]
  return createSubProps(state, record.address, timestamp, undefined, previous, record.finiteStates, finiteIndexOfValue(id, state), -1, timestamp - startTime, directionNames[direction], state === pending, null)
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
  if (activeLocks !== 0 && isBlocked(id)) return bufferPublish(allLocked ? ALL_KEY : id, id, value, BUFFERED_VALUE)
  return commitValue(id, value)
}

export const publishFromCallback = (id, callback) => {
  if (activeLocks !== 0 && isBlocked(id)) return bufferPublish(allLocked ? ALL_KEY : id, id, callback, BUFFERED_CALLBACK)
  const result = callback(tipValue[id])
  if (result === undefined) return undefined
  if (result instanceof Promise) return publishAsync(id, result)
  return publishValue(id, result)
}

// ---------------------------------------------------------------------------
// Mutex, buffer and async callbacks
// ---------------------------------------------------------------------------

let activeLocks = 0
export let allLocked = false
let allLockToken = null
const buffers = new Map()

const isBlocked = (id) => allLocked || (objectFlags[id] & LOCKED) !== 0

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

const keyIsLocked = (key) => key === ALL_KEY ? allLocked : (objectFlags[key] & LOCKED) !== 0

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
        target: key === ALL_KEY ? 'all' : records[key].address,
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

export const lockAll = (token) => {
  if (allLocked) throw new Error('Every stateObject is already locked')
  allLocked = true
  allLockToken = token
  activeLocks++
  if (observer !== null) observer('mutex', -1, 'lock')
}

export const unlockAll = () => {
  if (!allLocked) return false
  allLocked = false
  allLockToken = null
  activeLocks--
  if (observer !== null) observer('mutex', -1, 'unlock')
  drainBuffer(ALL_KEY)
  settle()
  return true
}

export const allLockHeldBy = (token) => allLocked && allLockToken === token

const runHolderCallback = (id, callback) => {
  const result = callback(tipValue[id])
  if (result instanceof Promise) throw new TypeError('A release function cannot take an async callback')
  return result
}

// Publishes as the holder of an object lock: bypasses that lock only
export const publishAsObjectHolder = (id, input) => {
  if (input === republish) return republishObject(id)
  const value = typeof input === 'function' ? runHolderCallback(id, input) : input
  if (allLocked) return bufferPublish(ALL_KEY, id, value, BUFFERED_VALUE)
  return commitValue(id, value)
}

// Publishes as the holder of the lock on everything: bypasses that lock only
export const publishAsAllHolder = (id, input) => {
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

// A get is a call with no argument (or undefined). With no access layer it
// reads the captured cell directly: the fast path matches when the input
// equals fastRead.input, which is undefined. While a layer is installed
// (isolation, dev-mode scope) fastRead.input is a private symbol no caller
// can pass, so every call goes through readState or writeState instead.
// One compare covers both the get check and the layer check. It is a
// property of a const object rather than a module `let` because V8 checks a
// `let` for the temporal dead zone on every read, and this read is most of a
// get: the object measured about a quarter faster
const NO_FAST_READ = Symbol('soucouyant.no-fast-read')
const fastRead = { input: undefined }

// Isolation (o.isolate) and dev-mode scope checks wrap these
export const installAccess = (access) => {
  fastRead.input = access === baseAccess ? undefined : NO_FAST_READ
  readState = access.read
  writeState = access.write
  subscribeRoute = access.subscribe
  unsubscribeRoute = access.unsubscribe
}

export const createStateObject = (id) => {
  const cell = headCells[id]
  return (input) => input === fastRead.input ? cell.value : input === undefined ? readState(id) : writeState(id, input)
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const executionModes = { sync: SYNC, 'async-queue': MICROTASK, 'async-frame': ANIMATION_FRAME }

// Installed by soucouyant-temporal.js while history is recorded
let historyRecorder = null

export const setRecorder = (recorder) => {
  historyRecorder = recorder
  selectVariants()
}

const selectVariants = () => {
  allowNaN = settings.allowNaN === true
  markDirty = executionMode === SYNC ? markDirtySync : markDirtyBatched
  settle = executionMode === SYNC ? settleSync : noop
  if (settings.clone) prepareValue = cloneValue
  else if (settings.development === 'freeze') prepareValue = validateAndFreeze
  else if (settings.development) prepareValue = validateValue
  else prepareValue = identity
  syncOnly = settings.asyncCallbacks === 'sync-only'
  asyncLockTimeout = settings.asyncLockTimeout
  trackPublishTimes = Boolean(settings.development)
  let record = historyRecorder !== null ? historyRecorder : recordWithoutHistory
  if (trackPublishTimes) record = trackedRecord(record)
  if (observer !== null) record = observedRecord(record)
  recordFrame = record
  if (settings.observe && observer === null && !observerWarned) {
    observerWarned = true
    warn('observe is set but nothing is listening; import \'soucouyant/devtools\' to log events')
  }
}

export const knownSettings = new Set(Object.keys(settings))
const settingValidators = []

// Lets a plug-in add settings with their defaults and a validator that runs
// before any option is applied
export const registerSettings = (defaults, validate) => {
  for (const key of Object.keys(defaults)) {
    if (!(key in settings)) settings[key] = defaults[key]
    knownSettings.add(key)
  }
  settingValidators.push(validate)
}

const isPlainObject = (value) => value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype

export const configure = (options) => {
  if (options === null || typeof options !== 'object') throw new TypeError('o.config() expects an options object')
  for (const key of Object.keys(options)) {
    if (knownSettings.has(key)) continue
    if (temporalSettingNames.includes(key)) {
      throw new Error(`"${key}" belongs to recorded history: import soucouyant-temporal.js ('soucouyant/temporal') before configuring it`)
    }
    throw new TypeError(`Unknown configuration option "${key}"`)
  }
  if ('execution' in options && !(options.execution in executionModes)) {
    throw new TypeError('execution must be \'sync\', \'async-queue\' or \'async-frame\'')
  }
  if ('asyncCallbacks' in options && options.asyncCallbacks !== 'lock' && options.asyncCallbacks !== 'sync-only') {
    throw new TypeError('asyncCallbacks must be \'lock\' or \'sync-only\'')
  }
  for (const validate of settingValidators) validate(options)
  const previousMode = executionMode
  for (const key of Object.keys(options)) {
    // Nested option objects such as offlineStorage merge into the current one
    if (isPlainObject(settings[key]) && isPlainObject(options[key])) settings[key] = { ...settings[key], ...options[key] }
    else settings[key] = options[key]
  }
  const nextMode = executionModes[settings.execution]
  if (nextMode !== previousMode) {
    flushNow()
    executionMode = nextMode
  }
  selectVariants()
  for (const listener of configListeners) listener(settings)
  return settings
}

const configListeners = []
export const onConfigure = (listener) => { configListeners.push(listener) }

export const objectCapacityNow = () => objectCapacity
