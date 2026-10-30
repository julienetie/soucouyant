// Runtime detection and the few platform primitives the core needs.
// Everything here is resolved once at module load.

export const isBrowser = typeof window !== 'undefined' && typeof document !== 'undefined'
export const isNode = !isBrowser && typeof process !== 'undefined' && process.versions != null && process.versions.node != null

const performanceClock = globalThis.performance
const timeOrigin = performanceClock.timeOrigin

// Epoch milliseconds with sub-millisecond resolution where the platform allows
export const clock = () => timeOrigin + performanceClock.now()

export const startTime = clock()

export const queueTask = globalThis.queueMicrotask

const hasAnimationFrame = typeof globalThis.requestAnimationFrame === 'function'
const immediate = typeof globalThis.setImmediate === 'function'
  ? globalThis.setImmediate
  : (callback) => setTimeout(callback, 0)

// Runs a callback before the next paint. Hidden tabs pause animation frames,
// so a hidden page falls back to a timer and notifications never stall.
export const queueFrame = hasAnimationFrame
  ? (callback) => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        setTimeout(callback, 0)
      } else {
        globalThis.requestAnimationFrame(callback)
      }
    }
  : immediate

export const defaultExecution = isBrowser ? 'async-frame' : 'async-queue'

// Lets a Node timer not hold the process open
export const unrefTimer = (timer) => {
  if (timer !== null && typeof timer === 'object' && typeof timer.unref === 'function') timer.unref()
  return timer
}

// Synchronous access to Node built-ins without a static import, so the core
// stays loadable in browsers
export const nodeBuiltin = (name) => {
  if (!isNode || typeof process.getBuiltinModule !== 'function') return null
  return process.getBuiltinModule(name)
}

export const reportError = (message, error) => {
  if (error === undefined) console.error(`[soucouyant] ${message}`)
  else console.error(`[soucouyant] ${message}`, error)
}

export const warn = (message) => console.warn(`[soucouyant] ${message}`)
