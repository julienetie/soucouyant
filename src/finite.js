// Finite states: converted once, at declaration, into an array plus a
// value-to-index Map, so validating a publish is one Map lookup.

import { pending } from './constants.js'

const isKeyframe = (item) => item !== null && typeof item === 'object' && typeof item.action === 'function'

const toList = (address, source) => {
  if (Array.isArray(source)) return source
  if (source instanceof Set) return [...source]
  if (source instanceof WeakSet) throw new TypeError(`${address}: WeakSet cannot be used for finite states; use an Array or a Set`)
  throw new TypeError(`${address}: finite states must be an Array or a Set`)
}

// Object keys are always strings, so a key such as '1' also matches the
// state 1 and 'true' matches true
const resolveTransitionKey = (address, key, indexByValue) => {
  if (indexByValue.has(key)) return indexByValue.get(key)
  if (typeof key === 'string') {
    const asNumber = Number(key)
    if (key.trim() !== '' && indexByValue.has(asNumber)) return indexByValue.get(asNumber)
    if (key === 'true' && indexByValue.has(true)) return indexByValue.get(true)
    if (key === 'false' && indexByValue.has(false)) return indexByValue.get(false)
    if (key === 'null' && indexByValue.has(null)) return indexByValue.get(null)
  }
  throw new TypeError(`${address}: transition rule names ${String(key)}, which is not one of its finite states`)
}

const buildTransitionTable = (address, states, indexByValue, transitions) => {
  const count = states.length
  // Unlisted states are unrestricted
  const table = new Uint8Array(count * count).fill(1)
  const entries = transitions instanceof Map ? [...transitions] : Object.entries(transitions)
  for (const [key, allowed] of entries) {
    const from = resolveTransitionKey(address, key, indexByValue)
    if (!Array.isArray(allowed)) throw new TypeError(`${address}: transitions for ${String(key)} must be an array of states`)
    const row = from * count
    table.fill(0, row, row + count)
    table[row + from] = 1
    for (const target of allowed) {
      const to = indexByValue.get(target)
      if (to === undefined) throw new TypeError(`${address}: transition target ${String(target)} is not one of its finite states`)
      table[row + to] = 1
    }
  }
  return table
}

export const prepareFinite = (address, source, initial, options) => {
  const list = toList(address, source)
  if (list.length === 0) throw new TypeError(`${address}: finite states cannot be empty`)
  const keyframeCount = list.filter(isKeyframe).length
  if (keyframeCount !== 0 && keyframeCount !== list.length) {
    throw new TypeError(`${address}: either every finite state is a keyframe object with an action, or none is`)
  }
  const keyframes = keyframeCount === 0 ? null : list.slice()
  const states = keyframes === null ? list.slice() : keyframes.map((keyframe) => keyframe.state)
  const indexByValue = new Map()
  for (let index = 0; index < states.length; index++) {
    const state = states[index]
    if (state === undefined) throw new TypeError(`${address}: a finite state cannot be undefined`)
    if (Number.isNaN(state)) throw new TypeError(`${address}: a finite state cannot be NaN`)
    if (indexByValue.has(state)) throw new TypeError(`${address}: duplicate finite state ${String(state)}`)
    indexByValue.set(state, index)
  }
  // Keyframe objects hold functions, so only their states are cloneable
  structuredClone(states)
  let start = initial
  if (keyframes !== null && start !== pending) {
    const at = keyframes.indexOf(start)
    if (at !== -1) start = states[at]
  }
  if (start !== pending && !indexByValue.has(start)) {
    throw new TypeError(`${address}: the initial state ${String(start)} is not one of its finite states`)
  }
  const transitions = options !== undefined && options !== null ? options.transitions : undefined
  const transitionTable = transitions === undefined || transitions === null
    ? null
    : buildTransitionTable(address, states, indexByValue, transitions)
  return { states, indexByValue, keyframes, transitionTable, initial: start }
}

// True when a move between two finite indices is allowed
export const transitionAllowed = (table, count, from, to) => table === null || from === to || table[from * count + to] === 1
