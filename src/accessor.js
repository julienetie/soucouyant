// The `o` tag and accessor tree. Namespaces are plain objects whose children
// are non-writable, non-configurable data properties, so V8 can treat a path
// such as o.images.trees as constant in optimized code.

import { pending } from './constants.js'
import { settings, configure, registerObject, createStateObject, records, stateObjects, idOfStateObject, subscribeRoute, unsubscribeRoute, checkSymbol, settleNow } from './engine.js'
import { prepareFinite } from './finite.js'
import { setScope } from './scope.js'
import { isolate } from './isolate.js'
import { warn } from './environment.js'

const identifierPattern = /^[A-Za-z_$][\w$]*$/
const reservedEverywhere = new Set([...Object.getOwnPropertyNames(Object.prototype), 'scope'])
const reservedOnRoot = new Set(['config', 'isolate', 'name', 'length', 'prototype', 'caller', 'arguments', 'apply', 'call', 'bind'])

const createNamespaceMeta = (target, address, parent) => ({ target, address, parent, scopePaths: null, frozen: false, children: 0 })

// V8 keeps at most 1020 properties in an object's fast layout; past that the
// object becomes a slower dictionary and paths through it stop being constant
const FAST_PROPERTY_LIMIT = 1020

const namespaceMetas = new WeakMap()

export const namespaceMeta = (target) => namespaceMetas.get(target)

const parseAddress = (strings, values) => {
  let text = strings[0]
  for (let i = 0; i < values.length; i++) text += String(values[i]) + strings[i + 1]
  const names = text.split('>').map((name) => name.trim())
  for (const name of names) {
    if (!identifierPattern.test(name)) throw new SyntaxError(`"${text}" is not a valid address: each part must be a JavaScript identifier, separated by ' > '`)
  }
  return names
}

const checkName = (name, isRoot) => {
  if (reservedEverywhere.has(name) || (isRoot && reservedOnRoot.has(name))) {
    throw new SyntaxError(`"${name}" is reserved and cannot be used in an address`)
  }
}

// Reused for every child so defining one allocates no descriptor object
const childDescriptor = { value: undefined, enumerable: true, writable: false, configurable: false }

const defineChild = (parentMeta, name, value) => {
  if (parentMeta.frozen || !Object.isExtensible(parentMeta.target)) {
    throw new Error(`${parentMeta.address || 'o'} is frozen: "${name}" cannot be added`)
  }
  childDescriptor.value = value
  Object.defineProperty(parentMeta.target, name, childDescriptor)
  childDescriptor.value = undefined
  if (++parentMeta.children === FAST_PROPERTY_LIMIT + 1 && settings.development) {
    warn(`${parentMeta.address || 'o'} has more than ${FAST_PROPERTY_LIMIT} children, which makes it a slow dictionary object in V8; split it into more namespaces`)
  }
}

const createNamespace = (parentMeta, name) => {
  const namespace = {}
  const address = parentMeta.address === '' ? name : `${parentMeta.address} > ${name}`
  const meta = createNamespaceMeta(namespace, address, parentMeta)
  Object.defineProperty(namespace, 'scope', {
    value: (...paths) => {
      setScope(meta, paths)
      return namespace
    },
    enumerable: false,
    writable: false,
    configurable: false
  })
  namespaceMetas.set(namespace, meta)
  defineChild(parentMeta, name, namespace)
  return meta
}

// Plug-ins add their own methods to every stateObject, existing and new, in
// registration order, so all stateObject functions keep one hidden class
// (finite ones may gain one more method)
const extenders = []

export const extendStateObjects = (extender) => {
  extenders.push(extender)
  for (let id = 0; id < stateObjects.length; id++) extender(stateObjects[id], id, records[id].finiteStates !== null)
}

const createStateObjectFunction = (id, isFinite) => {
  const stateObject = createStateObject(id)
  const sub = (first, second, third, fourth) => subscribeRoute(id, first, second, third, fourth, false)
  sub.withProps = (first, second, third, fourth) => subscribeRoute(id, first, second, third, fourth, true)
  stateObject.sub = sub
  stateObject.unsub = (...refs) => {
    let removed = 0
    for (const ref of refs) {
      if (unsubscribeRoute(id, ref)) removed++
    }
    return removed
  }
  stateObject.scope = (...paths) => {
    setScope(records[id], paths)
    return stateObject
  }
  stateObject.startTime = () => records[id].startTime
  for (let i = 0; i < extenders.length; i++) extenders[i](stateObject, id, isFinite)
  return stateObject
}

const prepareInitial = (address, state) => {
  if (state === undefined) return pending
  if (typeof state === 'symbol') return checkSymbol(state)
  if (Number.isNaN(state) && !settings.allowNaN) throw new TypeError(`${address}: the initial state cannot be NaN`)
  if (typeof state === 'function') throw new TypeError(`${address}: state cannot be a function`)
  if (typeof state === 'object' && state !== null) {
    if (settings.clone) return structuredClone(state)
    if (settings.development) structuredClone(state)
  }
  return state
}

const declare = (names, state, finiteStates, options) => {
  if (names.length - 1 > settings.namespaceDepth) {
    throw new RangeError(`${names.join(' > ')} is ${names.length - 1} namespaces deep; the limit is ${settings.namespaceDepth} (o.config({ namespaceDepth }))`)
  }
  let meta = rootMeta
  for (let i = 0; i < names.length - 1; i++) {
    const name = names[i]
    checkName(name, meta === rootMeta)
    if (!Object.hasOwn(meta.target, name)) {
      meta = createNamespace(meta, name)
    } else {
      const child = namespaceMetas.get(meta.target[name])
      if (child === undefined) throw new Error(`${names.slice(0, i + 1).join(' > ')} is a stateObject, not a namespace`)
      meta = child
    }
  }
  const name = names[names.length - 1]
  checkName(name, meta === rootMeta)
  const address = names.join(' > ')
  if (Object.hasOwn(meta.target, name)) {
    // Redeclaring keeps the existing stateObject and its state (hot reload)
    if (idOfStateObject.has(meta.target[name])) return
    throw new Error(`${address} is a namespace, not a stateObject`)
  }
  if (meta.frozen || !Object.isExtensible(meta.target)) throw new Error(`${meta.address || 'o'} is frozen: "${name}" cannot be added`)
  let initial = prepareInitial(address, state)
  let finite = null
  if (finiteStates !== undefined) {
    finite = prepareFinite(address, finiteStates, initial, options)
    initial = finite.initial
  }
  const id = registerObject(address, initial, finite)
  records[id].namespace = meta === rootMeta ? null : meta
  const stateObject = createStateObjectFunction(id, finite !== null)
  stateObjects.push(stateObject)
  idOfStateObject.set(stateObject, id)
  defineChild(meta, name, stateObject)
  settleNow()
}

// ---------------------------------------------------------------------------
// Object declarations: o({ editor: { text: '' } })
// ---------------------------------------------------------------------------

// Markers for the leaves an object declaration can't express on its own.
// Frozen, and recognised by a private symbol, so no state value is mistaken
// for one
const declarationKind = Symbol('soucouyant.declaration')
const FINITE_DECLARATION = 1
const VALUE_DECLARATION = 2

// finite(initial, states, options): a finite stateObject in an object
// declaration, the same as o`name`(initial, states, options)
export const finite = (initial, states, options) => {
  if (!Array.isArray(states) && !(states instanceof Set)) throw new TypeError('finite() takes the initial state, then the finite states as an Array or a Set')
  return Object.freeze({ [declarationKind]: FINITE_DECLARATION, initial, states, options })
}

// value(state): a stateObject holding a plain object, which an object
// declaration would otherwise read as a namespace
export const value = (state) => Object.freeze({ [declarationKind]: VALUE_DECLARATION, state })

const isPlainObject = (candidate) => {
  if (candidate === null || typeof candidate !== 'object') return false
  const prototype = Object.getPrototypeOf(candidate)
  return prototype === Object.prototype || prototype === null
}

const kindOf = (entry) => entry !== null && typeof entry === 'object' ? entry[declarationKind] : undefined

// Checked in full before anything is declared, so a mistake anywhere in the
// object leaves no half-declared state behind. `existing` is the namespace
// already at this path, if any
const checkShape = (shape, names, existing) => {
  const keys = Object.keys(shape)
  if (keys.length === 0) {
    throw new TypeError(names.length === 0 ? 'o() needs at least one stateObject to declare' : `${names.join(' > ')} is an empty namespace: give it at least one stateObject`)
  }
  const existingMeta = existing === undefined ? undefined : namespaceMetas.get(existing)
  for (const key of keys) {
    const path = [...names, key]
    const address = path.join(' > ')
    if (!identifierPattern.test(key)) throw new SyntaxError(`"${address}" is not a valid address: each name must be a JavaScript identifier`)
    checkName(key, names.length === 0)
    const child = existing !== undefined && Object.hasOwn(existing, key) ? existing[key] : undefined
    if (child === undefined && existingMeta !== undefined && (existingMeta.frozen || !Object.isExtensible(existing))) {
      throw new Error(`${existingMeta.address || 'o'} is frozen: "${key}" cannot be added`)
    }
    const entry = shape[key]
    const kind = kindOf(entry)
    if (kind === undefined && isPlainObject(entry)) {
      if (path.length > settings.namespaceDepth) {
        throw new RangeError(`${address} is more than ${settings.namespaceDepth} namespaces deep; the limit is ${settings.namespaceDepth} (o.config({ namespaceDepth }))`)
      }
      if (child !== undefined && !namespaceMetas.has(child)) throw new Error(`${address} is a stateObject, not a namespace`)
      checkShape(entry, path, child)
      continue
    }
    if (child !== undefined) {
      if (!idOfStateObject.has(child)) throw new Error(`${address} is a namespace, not a stateObject`)
      // Redeclaring keeps the existing stateObject and its state (hot reload)
      continue
    }
    if (kind === FINITE_DECLARATION) prepareFinite(address, entry.states, prepareInitial(address, entry.initial), entry.options)
    else prepareInitial(address, kind === VALUE_DECLARATION ? entry.state : entry)
  }
}

const declareShape = (shape, names) => {
  for (const key of Object.keys(shape)) {
    const path = [...names, key]
    const entry = shape[key]
    const kind = kindOf(entry)
    if (kind === FINITE_DECLARATION) declare(path, entry.initial, entry.states, entry.options)
    else if (kind === VALUE_DECLARATION) declare(path, entry.state)
    else if (isPlainObject(entry)) declareShape(entry, path)
    else declare(path, entry)
  }
}

// o`namespace > name`(state) declares one stateObject; o({ ... }) declares a
// whole object of them. Plain objects are namespaces, finite() and value()
// mark the leaves that need them, and anything else is a state
export const o = (strings, ...values) => {
  if (isPlainObject(strings)) {
    checkShape(strings, [], o)
    declareShape(strings, [])
    return o
  }
  if (!Array.isArray(strings) || !Array.isArray(strings.raw)) throw new TypeError('o is a tag, o`namespace > name`(state), or takes an object of states, o({ name: state })')
  const names = parseAddress(strings, values)
  return (state = pending, finiteStates, options) => {
    declare(names, state, finiteStates, options)
    return o
  }
}

const rootMeta = createNamespaceMeta(o, '', null)
namespaceMetas.set(o, rootMeta)

Object.defineProperty(o, 'config', { value: (options) => configure(options), enumerable: false, writable: false, configurable: false })
Object.defineProperty(o, 'isolate', { value: (handler) => isolate(handler), enumerable: false, writable: false, configurable: false })
Object.defineProperty(o, 'scope', {
  value: (...paths) => {
    setScope(rootMeta, paths)
    return o
  },
  enumerable: false,
  writable: false,
  configurable: false
})

// freeze(target): no more children on the target or its namespaces above
// it, except o itself unless o is the target
export const freeze = (target) => {
  let meta = namespaceMetas.get(target)
  if (meta === undefined) {
    const id = idOfStateObject.get(target)
    if (id === undefined) throw new TypeError('freeze() takes o, a namespace or a stateObject')
    meta = records[id].namespace ?? rootMeta
  }
  if (meta === rootMeta) {
    rootMeta.frozen = true
    Object.preventExtensions(o)
    return target
  }
  while (meta !== null && meta !== rootMeta) {
    meta.frozen = true
    Object.preventExtensions(meta.target)
    meta = meta.parent
  }
  return target
}

export const isNamespace = (target) => namespaceMetas.has(target)
export { rootMeta }
