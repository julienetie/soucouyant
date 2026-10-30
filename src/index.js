// Soucouyant: state with a recorded, travelable history.

import { setPendingAlias } from './core.js'
import { isReservedAlias } from './positions.js'

export { pending, republish } from './constants.js'
export { o, freeze } from './accessor.js'
export { head } from './head.js'
export { chain } from './chain.js'
export { mutex } from './mutex.js'

// alias(name, value): names the frame the next publish records
export const alias = (name, value) => {
  if (typeof name !== 'string' || name.length === 0) throw new TypeError('alias() takes a non-empty string name')
  if (isReservedAlias(name)) throw new TypeError(`"${name}" cannot be an alias: it reads as a direction, time, frame index, 'first' or 'present'`)
  setPendingAlias(name)
  return value
}
