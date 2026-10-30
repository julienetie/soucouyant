// scope(...modulePaths): which modules may use a namespace or stateObject.
// Checked only when development is on: finding the calling module means
// capturing a stack on every call, and bundles merge modules anyway.

import { records, settings, onConfigure } from './engine.js'
import { setScopeLayer } from './access.js'

// Everything under this URL is Soucouyant itself and is skipped
const libraryRoot = new URL('.', import.meta.url).href

let scopesDeclared = 0

const locationPattern = /(?:\(|@|at\s+)((?:file|https?|blob|webpack-internal|node):\/\/?[^\s)]*?|\/[^\s)]*?)(?::\d+)?:\d+\)?\s*$/

const toPath = (location) => {
  try {
    return new URL(location).pathname
  } catch {
    return location.split(/[?#]/)[0]
  }
}

export const callerModule = () => {
  const previousLimit = Error.stackTraceLimit
  Error.stackTraceLimit = 64
  const stack = new Error().stack
  Error.stackTraceLimit = previousLimit
  if (typeof stack !== 'string') return null
  const lines = stack.split('\n')
  for (const line of lines) {
    const match = locationPattern.exec(line)
    if (match === null) continue
    const location = match[1]
    if (location.startsWith(libraryRoot) || location.startsWith('node:')) continue
    return toPath(location)
  }
  return null
}

// Nearest scope: the stateObject's own, then each namespace above it
const nearestScope = (record) => {
  if (record.scopePaths !== null) return record.scopePaths
  let meta = record.namespace
  while (meta !== null) {
    if (meta.scopePaths !== null) return meta.scopePaths
    meta = meta.parent
  }
  return null
}

const checkScope = (id) => {
  const paths = nearestScope(records[id])
  if (paths === null) return
  const caller = callerModule()
  if (caller === null) return
  for (const path of paths) {
    if (caller.endsWith(path)) return
  }
  throw new Error(`${records[id].address} is scoped to ${paths.join(', ')} and cannot be used from ${caller}`)
}

const scopeLayer = (access) => ({
  read: (id) => {
    checkScope(id)
    return access.read(id)
  },
  write: (id, input) => {
    checkScope(id)
    return access.write(id, input)
  },
  subscribe: (id, first, second, third, fourth, forceProps) => {
    checkScope(id)
    return access.subscribe(id, first, second, third, fourth, forceProps)
  },
  unsubscribe: (id, ref) => {
    checkScope(id)
    return access.unsubscribe(id, ref)
  }
})

const refreshLayer = () => {
  setScopeLayer(settings.development && scopesDeclared !== 0 ? scopeLayer : null)
}

onConfigure(refreshLayer)

const normalisePaths = (paths) => {
  if (paths.length === 0) throw new TypeError('scope() needs at least one module path')
  return paths.map((path) => {
    if (typeof path !== 'string' || !path.startsWith('/')) {
      throw new TypeError(`scope() paths start with '/' so they match whole file names: received ${String(path)}`)
    }
    return path
  })
}

// `holder` is a stateObject record or a namespace meta: both carry scopePaths
export const setScope = (holder, paths) => {
  if (holder.scopePaths === null) scopesDeclared++
  holder.scopePaths = normalisePaths(paths)
  refreshLayer()
}
