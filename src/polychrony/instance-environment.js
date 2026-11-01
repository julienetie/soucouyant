// Stands in for ../environment.js inside a timeline made by chain.create().
// A timeline continues its parent's history, so it keeps the parent's
// session start: time strings such as '2.5s' then mean the same moment on
// every timeline. instanceSeed is createInstance()'s parameter.
/* global instanceSeed */

export { isBrowser, isNode, clock, queueTask, queueFrame, defaultExecution, unrefTimer, nodeBuiltin, reportError, warn } from '../environment.js'
export const startTime = instanceSeed.startTime
