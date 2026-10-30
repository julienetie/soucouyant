// o.isolate(handler): per-request state on Node servers, keeping one `o`.
// Declarations stay global; values, subscribers and locks live in the
// request's context, which AsyncLocalStorage carries across every await.

import { records, initialValue, validateForCommit, validatedFiniteIndex, createSubProps, finiteIndexOfValue } from './engine.js'
import { pending } from './constants.js'
import { nodeBuiltin, clock, startTime, reportError } from './environment.js'
import { setIsolationLayer } from './access.js'

const asyncHooks = nodeBuiltin('node:async_hooks')
let storage = null
let isolatedRefCounter = 0

const createContext = () => ({
  values: [],
  previous: [],
  subscribers: new Map(),
  locks: new Set(),
  buffers: new Map(),
  queue: [],
  draining: false
})

const createIsolatedSubscriber = (callback, ref, wantsProps) => ({ callback, ref, wantsProps })

const contextRead = (context, id) => {
  const value = context.values[id]
  return value === undefined ? initialValue[id] : value
}

const drainQueue = (context) => {
  if (context.draining) return
  context.draining = true
  try {
    while (context.queue.length !== 0) {
      const id = context.queue.shift()
      const list = context.subscribers.get(id)
      if (list === undefined) continue
      const state = contextRead(context, id)
      const previous = context.previous[id]
      context.previous[id] = state
      let props
      for (const subscriber of list.slice()) {
        if (subscriber.wantsProps && props === undefined) {
          const record = records[id]
          const now = clock()
          props = createSubProps(state, record.address, now, undefined, previous, record.finiteStates, finiteIndexOfValue(id, state), -1, now - startTime, 'fwd', state === pending, null)
        }
        try {
          subscriber.callback(state, props)
        } catch (error) {
          reportError(`A subscriber of ${records[id].address} threw`, error)
        }
      }
    }
  } finally {
    context.draining = false
  }
}

const contextCommit = (context, id, input) => {
  const value = validateForCommit(id, input, contextRead(context, id))
  if (value === undefined) return undefined
  // Finite stateObjects store the set's own reference
  const stored = validatedFiniteIndex >= 0 ? records[id].finiteStates[validatedFiniteIndex] : value
  if (context.previous[id] === undefined) context.previous[id] = contextRead(context, id)
  context.values[id] = stored
  if (context.subscribers.has(id)) {
    context.queue.push(id)
    drainQueue(context)
  }
  return stored
}

const contextBuffer = (context, id, input) => {
  let buffer = context.buffers.get(id)
  if (buffer === undefined) {
    buffer = []
    context.buffers.set(id, buffer)
  }
  buffer.push(input)
  return undefined
}

const contextUnlock = (context, id) => {
  context.locks.delete(id)
  const buffer = context.buffers.get(id)
  if (buffer === undefined) return
  while (buffer.length !== 0 && !context.locks.has(id)) contextWrite(context, id, buffer.shift())
  if (buffer.length === 0) context.buffers.delete(id)
}

const contextAsync = (context, id, promise) => {
  context.locks.add(id)
  return promise.then((value) => {
    try {
      return value === undefined ? undefined : contextCommit(context, id, value)
    } finally {
      contextUnlock(context, id)
    }
  }, (error) => {
    contextUnlock(context, id)
    throw error
  })
}

const contextWrite = (context, id, input) => {
  if (context.locks.has(id)) return contextBuffer(context, id, input)
  if (typeof input === 'function') {
    const result = input(contextRead(context, id))
    if (result === undefined) return undefined
    if (result instanceof Promise) return contextAsync(context, id, result)
    return contextCommit(context, id, result)
  }
  return contextCommit(context, id, input)
}

const contextSubscribe = (context, id, first, second, third, fourth, forceProps) => {
  if (typeof first !== 'function') throw new TypeError('sub() expects a callback function')
  let list = context.subscribers.get(id)
  if (list === undefined) {
    list = []
    context.subscribers.set(id, list)
  }
  // Time travel is not available inside an isolated request, so an inverted
  // callback is accepted but never runs
  const pair = typeof second === 'function'
  const ref = (pair ? third : second) ?? `isolated-${id}-${isolatedRefCounter++}`
  list.push(createIsolatedSubscriber(first, ref, forceProps || first.length >= 2))
  if (context.previous[id] === undefined) context.previous[id] = contextRead(context, id)
  if (pair) return [ref, fourth ?? `isolated-${id}-${isolatedRefCounter++}`]
  return ref
}

const contextUnsubscribe = (context, id, ref) => {
  const list = context.subscribers.get(id)
  if (list === undefined) return false
  const at = list.findIndex((subscriber) => subscriber.ref === ref)
  if (at === -1) return false
  list.splice(at, 1)
  return true
}

const isolationLayer = (access) => ({
  read: (id) => {
    const context = storage.getStore()
    return context === undefined ? access.read(id) : contextRead(context, id)
  },
  write: (id, input) => {
    const context = storage.getStore()
    return context === undefined ? access.write(id, input) : contextWrite(context, id, input)
  },
  subscribe: (id, first, second, third, fourth, forceProps) => {
    const context = storage.getStore()
    return context === undefined
      ? access.subscribe(id, first, second, third, fourth, forceProps)
      : contextSubscribe(context, id, first, second, third, fourth, forceProps)
  },
  unsubscribe: (id, ref) => {
    const context = storage.getStore()
    return context === undefined ? access.unsubscribe(id, ref) : contextUnsubscribe(context, id, ref)
  }
})

export const isolate = (handler) => {
  if (typeof handler !== 'function') throw new TypeError('o.isolate() expects a handler function')
  if (asyncHooks === null) throw new Error('o.isolate() needs Node.js with process.getBuiltinModule (Node 20.16 or 22.3 and later)')
  if (storage === null) {
    storage = new asyncHooks.AsyncLocalStorage()
    setIsolationLayer(isolationLayer)
  }
  return storage.run(createContext(), handler)
}

export const isIsolated = () => storage !== null && storage.getStore() !== undefined
