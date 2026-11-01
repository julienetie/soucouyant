// Soucouyant polychrony: several timelines at once. Importing this module
// adds chain.create(), chain.get() and chain.list(), and it re-exports
// temporal, which re-exports the core.
//
// A timeline is a whole world of state with its own history: it acts like o
// from the moment it exists. chain.create(name) branches one off the current
// timeline. The new timeline starts with everything the parent has, its
// states and its recorded past, then the two move independently. Their
// stateObjects stay related through that shared past: the same addresses,
// the same frames up to the branch.
//
//     const draft = chain.create('draft')
//     draft.editor.text('A new idea')   // the main timeline keeps its text
//     draft.head.seek('rev')            // only draft travels back
//
// Each timeline runs its own copy of the engine (see scripts/build-instance.js),
// so the main timeline's code and speed are exactly what they were.

import { o, chain, head, mutex, freeze, alias as aliasMain } from './soucouyant-temporal.js'
import * as mainInternals from './polychrony/internals.js'
import { createInstance } from './polychrony/instance.generated.js'

// Everything temporal exports, except alias(), which polychrony replaces
export { o, chain, head, mutex, freeze, finite, value, pending, republish } from './soucouyant-temporal.js'

const createTimeline = (name, parts, parent) => ({
  name,
  o: parts.o,
  chain: parts.chain,
  head: parts.head,
  mutex: parts.mutex,
  freeze: parts.freeze,
  internals: parts.internals,
  parent
})

const main = createTimeline(null, { o, chain, head, mutex, freeze, internals: mainInternals }, null)

// Timelines made by chain.create(), by name
const timelines = new Map()

const isLive = (timeline) => timeline === main || timelines.get(timeline.name) === timeline

const everyTimeline = () => [main, ...timelines.values()]

// ---------------------------------------------------------------------------
// One shape for every timeline
// ---------------------------------------------------------------------------

// A declaration or freeze in one timeline is repeated in every other, in the
// same order, so a stateObject has the same address and id everywhere.
// `repeating` stops the repeats from being repeated in turn
let repeating = false

const repeatInOthers = (source, apply) => {
  if (repeating || !isLive(source)) return
  repeating = true
  try {
    for (const timeline of everyTimeline()) {
      if (timeline !== source) apply(timeline)
    }
  } finally {
    repeating = false
  }
}

const shareShape = (timeline) => {
  timeline.internals.onDeclared((names, state, finiteStates, options) => {
    repeatInOthers(timeline, (other) => other.internals.declareNames(names, state, finiteStates, options))
  })
  timeline.internals.onFrozen((address) => {
    repeatInOthers(timeline, (other) => other.internals.freezeAddress(address))
  })
}

// ---------------------------------------------------------------------------
// mutex and freeze accept any timeline's stateObjects
// ---------------------------------------------------------------------------

const ownerOf = (target, asking) => {
  for (const timeline of everyTimeline()) {
    if (timeline !== asking && (timeline.chain === target || timeline.internals.owns(target))) return timeline
  }
  return undefined
}

const routeToOwner = (timeline) => {
  timeline.internals.setForeignMutex((target) => ownerOf(target, timeline)?.mutex)
  timeline.internals.setForeignFreeze((target) => {
    const owner = ownerOf(target, timeline)
    if (owner === undefined) return undefined
    owner.freeze(target)
    return target
  })
}

// ---------------------------------------------------------------------------
// Branching
// ---------------------------------------------------------------------------

// Settings a new timeline takes from its parent. Recording is always on: a
// timeline records time. Storage is not inherited, because an adapter holds
// one open database; pass a new adapter in chain.create()'s options
const inheritedSettings = ['allowNaN', 'namespaceDepth', 'execution', 'development', 'clone', 'asyncCallbacks', 'asyncLockTimeout', 'mergeFidelity', 'seekTime', 'objectStoreName']

const checkName = (name) => {
  if (typeof name !== 'string' || name.length === 0) throw new TypeError('chain.create() takes a non-empty name')
  if (timelines.has(name)) throw new Error(`A timeline named "${name}" already exists; chain.get('${name}') returns it`)
}

// Copies the parent's settings, shape and history into a new timeline
const branch = (parent, timeline) => {
  const parentSettings = parent.internals.settings
  const settings = { persist: true, databaseName: `${parentSettings.databaseName}:${timeline.name}` }
  for (const key of inheritedSettings) settings[key] = parentSettings[key]
  timeline.o.config(settings)

  // The same shape, declared in the same order, so ids match
  repeating = true
  try {
    for (const [names, state, finiteStates, options] of parent.internals.declarationLog) {
      timeline.internals.declareNames(names, state, finiteStates, options)
    }
    for (const address of parent.internals.freezeLog) timeline.internals.freezeAddress(address)
  } finally {
    repeating = false
  }

  // The same history: base states, then every frame in memory, then the
  // head where the parent's is. A parent that doesn't record hands over its
  // current states as the starting point
  timeline.chain.trailLimit(parent.chain.trailLimit())
  const recording = parent.internals.isRecording()
  const count = parent.internals.stateObjectCount()
  for (let id = 0; id < count; id++) {
    timeline.internals.setBaseValue(id, recording ? parent.internals.baseValueOf(id) : parent.internals.headValueOf(id))
  }
  timeline.chain.replace(recording ? parent.chain.expose() : [])
  const position = recording ? parent.internals.headPosition() : null
  if (position !== null) timeline.head.seek(position)
}

const create = (parent, name, options) => {
  checkName(name)
  if (options !== undefined && (options === null || typeof options !== 'object')) {
    throw new TypeError('chain.create() takes an options object, the same as o.config(), as its second argument')
  }
  const timeline = createTimeline(name, createInstance({ startTime: parent.internals.sessionStart() }), parent)
  branch(parent, timeline)
  if (options !== undefined) timeline.o.config(options)

  // A timeline's controls sit on its root, the way config sits on o
  Object.defineProperty(timeline.o, 'head', { value: timeline.head, enumerable: false, writable: false, configurable: false })
  Object.defineProperty(timeline.o, 'chain', { value: timeline.chain, enumerable: false, writable: false, configurable: false })
  Object.defineProperty(timeline.chain, 'name', { value: name, enumerable: true, writable: false, configurable: false })
  timeline.chain.delete = () => remove(timeline)
  addTimelineControls(timeline)

  shareShape(timeline)
  routeToOwner(timeline)
  timelines.set(name, timeline)
  return timeline.o
}

// Discards a timeline: it stops receiving declarations, its trajectories
// pause, its storage is flushed and closed, and chain.get() no longer finds
// it. Timelines branched from it carry on
const remove = (timeline) => {
  if (!isLive(timeline)) return false
  timelines.delete(timeline.name)
  timeline.internals.pauseTrajectories()
  timeline.chain.flush()
  timeline.o.config({ offlineStorage: { mode: 'disabled', adapter: null } })
  return true
}

const get = (name) => timelines.get(name)?.o

// ---------------------------------------------------------------------------
// alias() names the next frame recorded on whichever timeline records first
// ---------------------------------------------------------------------------

// While an alias is pending, every timeline watches for its next frame. The
// first to record one keeps the alias and the rest drop it. Nothing watches
// when no alias is pending, so recording costs nothing extra
let watchers = []

const stopWatching = () => {
  for (const [timeline, watcher] of watchers) timeline.internals.offFrameRecorded(watcher)
  watchers = []
}

const watchForAliasedFrame = () => {
  stopWatching()
  for (const timeline of everyTimeline()) {
    const watcher = () => {
      for (const other of everyTimeline()) {
        if (other !== timeline) other.internals.clearPendingAlias()
      }
      stopWatching()
    }
    watchers.push([timeline, watcher])
    timeline.internals.onFrameRecorded(watcher)
  }
  // An alias only lasts until the end of the task
  queueMicrotask(stopWatching)
}

// alias(name, value): names the frame the next publish records, on any
// timeline. Import it from here rather than from temporal, whose alias()
// only knows the main timeline
export const alias = (name, value) => {
  aliasMain(name, value)
  for (const timeline of timelines.values()) timeline.internals.setPendingAlias(name)
  if (timelines.size !== 0) watchForAliasedFrame()
  return value
}

const list = () => [...timelines.keys()]

// Every chain can branch, and find or list every timeline
const addTimelineControls = (timeline) => {
  timeline.chain.create = (name, options) => create(timeline, name, options)
  timeline.chain.get = get
  timeline.chain.list = list
}

addTimelineControls(main)
shareShape(main)
routeToOwner(main)
