// Trajectories: timed movement through a finite stateObject's states.
// Every trajectory shares one scheduler: a binary min-heap of due times
// driven by one animation-frame loop (browser) or one timer (Node).

import { records, publishValue, tipValue, finiteIndexOfValue, buildProps, headValueOf, observe } from './core.js'
import { pending, FORWARD } from './constants.js'
import { clock, isBrowser, reportError } from './environment.js'
import { transitionAllowed } from './finite.js'

const continuations = new Set(['loop', 'rebound', 'end', 'random', 'random-unique'])

const PHASE_START = 0
const PHASE_HOLD = 1

const createTrajectory = () => ({
  configured: false,
  order: new Int32Array(0),
  position: 0,
  direction: 1,
  playing: false,
  generation: 0,
  continuation: 'loop',
  interval: 1000,
  intervalProperty: null,
  keyframeActions: false,
  bag: new Int32Array(0),
  bagLength: 0,
  phase: PHASE_START
})

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

let heapDue = new Float64Array(64)
let heapId = new Int32Array(64)
let heapGeneration = new Int32Array(64)
let heapSize = 0
let frameRequested = false
let schedulerTimer = null

const heapSwap = (a, b) => {
  const due = heapDue[a]
  heapDue[a] = heapDue[b]
  heapDue[b] = due
  const id = heapId[a]
  heapId[a] = heapId[b]
  heapId[b] = id
  const generation = heapGeneration[a]
  heapGeneration[a] = heapGeneration[b]
  heapGeneration[b] = generation
}

const heapPush = (due, id, generation) => {
  if (heapSize === heapDue.length) {
    const grownDue = new Float64Array(heapSize * 2)
    grownDue.set(heapDue)
    heapDue = grownDue
    const grownId = new Int32Array(heapSize * 2)
    grownId.set(heapId)
    heapId = grownId
    const grownGeneration = new Int32Array(heapSize * 2)
    grownGeneration.set(heapGeneration)
    heapGeneration = grownGeneration
  }
  let at = heapSize++
  heapDue[at] = due
  heapId[at] = id
  heapGeneration[at] = generation
  while (at > 0) {
    const parent = (at - 1) >> 1
    if (heapDue[parent] <= heapDue[at]) break
    heapSwap(parent, at)
    at = parent
  }
}

const heapPop = () => {
  heapSize--
  if (heapSize === 0) return
  heapDue[0] = heapDue[heapSize]
  heapId[0] = heapId[heapSize]
  heapGeneration[0] = heapGeneration[heapSize]
  let at = 0
  while (true) {
    const left = at * 2 + 1
    const right = left + 1
    let smallest = at
    if (left < heapSize && heapDue[left] < heapDue[smallest]) smallest = left
    if (right < heapSize && heapDue[right] < heapDue[smallest]) smallest = right
    if (smallest === at) return
    heapSwap(at, smallest)
    at = smallest
  }
}

const tick = () => {
  frameRequested = false
  schedulerTimer = null
  const now = clock()
  for (;;) {
    if (heapSize === 0 || heapDue[0] > now) break
    const due = heapDue[0]
    const id = heapId[0]
    const generation = heapGeneration[0]
    heapPop()
    const trajectory = records[id].trajectory
    if (trajectory === null || !trajectory.playing || trajectory.generation !== generation) continue
    try {
      fire(id, trajectory, due, now)
    } catch (error) {
      trajectory.playing = false
      reportError(`The trajectory of ${records[id].address} stopped`, error)
    }
  }
  wake()
}

const wake = () => {
  if (heapSize === 0) return
  if (isBrowser && typeof globalThis.requestAnimationFrame === 'function') {
    if (!frameRequested) {
      frameRequested = true
      globalThis.requestAnimationFrame(tick)
    }
    return
  }
  if (schedulerTimer !== null) clearTimeout(schedulerTimer)
  schedulerTimer = setTimeout(tick, Math.max(0, heapDue[0] - clock()))
}

const schedule = (due, id, trajectory) => {
  heapPush(due, id, trajectory.generation)
  wake()
}

// ---------------------------------------------------------------------------
// Movement
// ---------------------------------------------------------------------------

const trajectoryStateAt = (record, trajectory, position) => record.finiteStates[trajectory.order[position]]

const keyframeAt = (record, trajectory, position) => record.keyframes[trajectory.order[position]]

const holdOf = (record, trajectory, position) => {
  if (trajectory.intervalProperty === null) return trajectory.interval
  const source = record.keyframes !== null ? keyframeAt(record, trajectory, position) : trajectoryStateAt(record, trajectory, position)
  return source[trajectory.intervalProperty]
}

const allowedFrom = (record, trajectory, position, candidate) => {
  if (record.transitionTable === null) return true
  return transitionAllowed(record.transitionTable, record.finiteStates.length, trajectory.order[position], trajectory.order[candidate])
}

const randomPosition = (record, trajectory) => {
  const length = trajectory.order.length
  if (length === 1) return 0
  const options = []
  for (let candidate = 0; candidate < length; candidate++) {
    if (candidate !== trajectory.position && allowedFrom(record, trajectory, trajectory.position, candidate)) options.push(candidate)
  }
  if (options.length === 0) return -1
  return options[Math.floor(Math.random() * options.length)]
}

// A shuffle bag: every position once before any repeats
const uniqueRandomPosition = (record, trajectory) => {
  const length = trajectory.order.length
  if (length === 1) return 0
  if (trajectory.bagLength === 0) {
    const bag = trajectory.bag
    for (let i = 0; i < length; i++) bag[i] = i
    for (let i = length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      const swap = bag[i]
      bag[i] = bag[j]
      bag[j] = swap
    }
    trajectory.bagLength = length
  }
  for (let i = trajectory.bagLength - 1; i >= 0; i--) {
    const candidate = trajectory.bag[i]
    if (candidate === trajectory.position || !allowedFrom(record, trajectory, trajectory.position, candidate)) continue
    trajectory.bag[i] = trajectory.bag[trajectory.bagLength - 1]
    trajectory.bagLength--
    return candidate
  }
  trajectory.bagLength = 0
  return randomPosition(record, trajectory)
}

// The next position in `step` direction (1 or -1), or -1 to stop
const advance = (record, trajectory, step) => {
  const length = trajectory.order.length
  const continuation = trajectory.continuation
  if (continuation === 'random') return randomPosition(record, trajectory)
  if (continuation === 'random-unique') return uniqueRandomPosition(record, trajectory)
  const next = trajectory.position + step
  if (next >= 0 && next < length) return next
  if (continuation === 'loop') return step > 0 ? 0 : length - 1
  if (continuation === 'rebound') {
    if (length === 1) return 0
    trajectory.direction = -trajectory.direction
    return trajectory.position - step
  }
  return -1
}

const runAction = (id, record, trajectory) => {
  const keyframe = keyframeAt(record, trajectory, trajectory.position)
  const action = keyframe.action
  const state = headValueOf(id)
  if (action.length >= 2) {
    const props = { ...buildProps(id, state, state, FORWARD), keyframe }
    action(state, props)
  } else {
    action(state)
  }
}

const show = (id, record, trajectory) => {
  publishValue(id, trajectoryStateAt(record, trajectory, trajectory.position))
  if (trajectory.keyframeActions) runAction(id, record, trajectory)
}

const fireInterval = (id, record, trajectory, due, now) => {
  let at = due
  let next = advance(record, trajectory, trajectory.direction)
  if (next < 0) {
    trajectory.playing = false
    return
  }
  let nextDue = at + holdOf(record, trajectory, next)
  // A hidden tab resumes on the state that should be showing now
  let guard = trajectory.order.length * 4
  while (nextDue <= now && guard-- > 0) {
    trajectory.position = next
    at = nextDue
    next = advance(record, trajectory, trajectory.direction)
    if (next < 0) {
      trajectory.playing = false
      show(id, record, trajectory)
      return
    }
    nextDue = at + holdOf(record, trajectory, next)
  }
  trajectory.position = next
  show(id, record, trajectory)
  schedule(nextDue, id, trajectory)
}

const fireKeyframe = (id, record, trajectory, due, now) => {
  const keyframe = keyframeAt(record, trajectory, trajectory.position)
  if (trajectory.phase === PHASE_START) {
    const holdEnds = due + keyframe.duration + keyframe.endDelay
    // Skip keyframes that already ended while the tab was hidden
    if (holdEnds > now) show(id, record, trajectory)
    trajectory.phase = PHASE_HOLD
    schedule(holdEnds, id, trajectory)
    return
  }
  const next = advance(record, trajectory, trajectory.direction)
  if (next < 0) {
    trajectory.playing = false
    return
  }
  trajectory.position = next
  trajectory.phase = PHASE_START
  schedule(due + keyframeAt(record, trajectory, next).startDelay, id, trajectory)
}

const fire = (id, trajectory, due, now) => {
  const record = records[id]
  observe('trajectory', id, 'step')
  if (trajectory.keyframeActions) fireKeyframe(id, record, trajectory, due, now)
  else fireInterval(id, record, trajectory, due, now)
}

// ---------------------------------------------------------------------------
// Configuration and controls
// ---------------------------------------------------------------------------

const requireConfigured = (record) => {
  const trajectory = record.trajectory
  if (trajectory === null || !trajectory.configured) throw new Error(`${record.address} has no trajectory; call trajectory({ ... }) first`)
  return trajectory
}

const validateKeyframes = (record) => {
  if (record.keyframes === null) throw new TypeError(`${record.address}: keyframeActions needs finite states that are keyframe objects`)
  for (const keyframe of record.keyframes) {
    for (const key of ['duration', 'startDelay', 'endDelay']) {
      if (typeof keyframe[key] !== 'number' || !(keyframe[key] >= 0)) {
        throw new TypeError(`${record.address}: every keyframe needs a non-negative number for ${key}`)
      }
    }
    if (typeof keyframe.action !== 'function') throw new TypeError(`${record.address}: every keyframe needs an action function`)
  }
}

const validateOrder = (record, trajectory) => {
  if (record.transitionTable === null) return
  const order = trajectory.order
  const length = order.length
  const count = record.finiteStates.length
  const check = (from, to) => {
    if (!transitionAllowed(record.transitionTable, count, order[from], order[to])) {
      throw new TypeError(`${record.address}: the trajectory order moves from ${String(record.finiteStates[order[from]])} to ${String(record.finiteStates[order[to]])}, which its transition rules forbid`)
    }
  }
  if (trajectory.continuation === 'random' || trajectory.continuation === 'random-unique') return
  for (let i = 0; i + 1 < length; i++) check(i, i + 1)
  if (trajectory.continuation === 'loop' && length > 1) check(length - 1, 0)
  if (trajectory.continuation === 'rebound') {
    for (let i = length - 1; i > 0; i--) check(i, i - 1)
  }
}

const configureTrajectory = (id, options) => {
  const record = records[id]
  if (options === undefined) return describe(record)
  if (options === null || typeof options !== 'object') throw new TypeError('trajectory() expects an options object')
  const trajectory = record.trajectory ?? createTrajectory()
  const states = record.finiteStates
  let order
  if (options.order === undefined) {
    order = new Int32Array(states.length)
    for (let i = 0; i < states.length; i++) order[i] = i
  } else {
    if (!Array.isArray(options.order) || options.order.length === 0) throw new TypeError(`${record.address}: order must be a non-empty array of its finite states`)
    order = new Int32Array(options.order.length)
    for (let i = 0; i < options.order.length; i++) {
      let state = options.order[i]
      if (record.keyframes !== null) {
        const at = record.keyframes.indexOf(state)
        if (at !== -1) state = states[at]
      }
      const index = finiteIndexOfValue(id, state)
      if (index < 0) throw new TypeError(`${record.address}: ${String(state)} in order is not one of its finite states`)
      order[i] = index
    }
  }
  const continuation = options.continuation ?? 'loop'
  if (!continuations.has(continuation)) throw new TypeError(`${record.address}: continuation must be loop, rebound, end, random or random-unique`)
  const intervals = options.intervals ?? 1000
  if (typeof intervals === 'number') {
    if (!(intervals >= 0)) throw new TypeError(`${record.address}: intervals must be a non-negative number of milliseconds`)
    trajectory.interval = intervals
    trajectory.intervalProperty = null
  } else if (typeof intervals === 'string') {
    for (let i = 0; i < order.length; i++) {
      const source = record.keyframes !== null ? record.keyframes[order[i]] : states[order[i]]
      if (source === null || typeof source !== 'object' || typeof source[intervals] !== 'number') {
        throw new TypeError(`${record.address}: every state in the trajectory needs a numeric "${intervals}" property`)
      }
    }
    trajectory.intervalProperty = intervals
  } else {
    throw new TypeError(`${record.address}: intervals is a number of milliseconds or a property name`)
  }
  trajectory.keyframeActions = options.keyframeActions === true
  if (trajectory.keyframeActions) validateKeyframes(record)
  trajectory.order = order
  trajectory.continuation = continuation
  trajectory.bag = new Int32Array(order.length)
  trajectory.bagLength = 0
  trajectory.direction = 1
  trajectory.phase = PHASE_START
  validateOrder(record, trajectory)
  const current = tipValue[id] === pending ? -1 : finiteIndexOfValue(id, tipValue[id])
  const at = current < 0 ? -1 : order.indexOf(current)
  trajectory.position = at < 0 ? 0 : at
  trajectory.generation++
  trajectory.playing = false
  trajectory.configured = true
  record.trajectory = trajectory
  observe('trajectory', id, 'configure')
  return describe(record)
}

const describe = (record) => {
  const trajectory = record.trajectory
  if (trajectory === null || !trajectory.configured) return null
  return {
    order: Array.from(trajectory.order, (index) => record.finiteStates[index]),
    position: trajectory.position,
    playing: trajectory.playing,
    direction: trajectory.direction === 1 ? 'fwd' : 'rev',
    continuation: trajectory.continuation,
    intervals: trajectory.intervalProperty ?? trajectory.interval,
    keyframeActions: trajectory.keyframeActions
  }
}

const step = (id, direction) => {
  const record = records[id]
  const trajectory = requireConfigured(record)
  // A manual step never changes the playing direction, even on a rebound
  const saved = trajectory.direction
  const next = advance(record, trajectory, direction)
  trajectory.direction = saved
  if (next < 0) return headValueOf(id)
  trajectory.position = next
  if (trajectory.playing) {
    trajectory.generation++
    trajectory.phase = PHASE_START
    startPlaying(id, record, trajectory)
  } else {
    show(id, record, trajectory)
  }
  return headValueOf(id)
}

const startPlaying = (id, record, trajectory) => {
  trajectory.playing = true
  const now = clock()
  if (trajectory.keyframeActions) {
    trajectory.phase = PHASE_START
    schedule(now + keyframeAt(record, trajectory, trajectory.position).startDelay, id, trajectory)
  } else {
    schedule(now + holdOf(record, trajectory, trajectory.position), id, trajectory)
  }
}

const play = (id, direction) => {
  const record = records[id]
  const trajectory = requireConfigured(record)
  trajectory.generation++
  trajectory.direction = direction
  startPlaying(id, record, trajectory)
  observe('trajectory', id, direction === 1 ? 'play' : 'reverse')
}

const pause = (id) => {
  const trajectory = requireConfigured(records[id])
  trajectory.generation++
  trajectory.playing = false
  observe('trajectory', id, 'pause')
}

const stop = (id) => {
  const record = records[id]
  const trajectory = requireConfigured(record)
  trajectory.generation++
  trajectory.playing = false
  trajectory.position = 0
  trajectory.direction = 1
  trajectory.phase = PHASE_START
  show(id, record, trajectory)
  observe('trajectory', id, 'stop')
}

const seekTrajectory = (id, position) => {
  const record = records[id]
  const trajectory = requireConfigured(record)
  if (!Number.isInteger(position) || position < 0 || position >= trajectory.order.length) {
    throw new RangeError(`${record.address}: trajectory position ${String(position)} is outside its order`)
  }
  trajectory.position = position
  trajectory.phase = PHASE_START
  if (trajectory.playing) {
    trajectory.generation++
    show(id, record, trajectory)
    startPlaying(id, record, trajectory)
  } else {
    show(id, record, trajectory)
  }
  observe('trajectory', id, 'seek')
  return headValueOf(id)
}

export const trajectoryOwners = new WeakMap()

export const createTrajectoryControls = (id) => {
  const trajectory = (options) => configureTrajectory(id, options)
  trajectory.fwd = () => step(id, 1)
  trajectory.rwd = () => step(id, -1)
  trajectory.play = () => play(id, 1)
  trajectory.pause = () => pause(id)
  trajectory.stop = () => stop(id)
  trajectory.reverse = () => play(id, -1)
  trajectory.seek = (position) => seekTrajectory(id, position)
  trajectoryOwners.set(trajectory, id)
  return trajectory
}
