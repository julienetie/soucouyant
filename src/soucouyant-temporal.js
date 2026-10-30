// Soucouyant temporal: recorded history, time travel, trajectories and
// storage. Importing this module plugs history into the core, and it
// re-exports the core, so an app with history imports only this file.

import { setPendingAlias } from './temporal/log.js'
import { isReservedAlias } from './temporal/positions.js'
import { chain } from './temporal/chain.js'
import { addLockEverythingTarget } from './mutex.js'
import './temporal/methods.js'
import './temporal/storage.js'

export * from './soucouyant-core.js'
export { head } from './temporal/head.js'
export { chain }

// mutex.lock(chain) locks every stateObject, like mutex.lock(o)
addLockEverythingTarget(chain)

// alias(name, value): names the frame the next publish records
export const alias = (name, value) => {
  if (typeof name !== 'string' || name.length === 0) throw new TypeError('alias() takes a non-empty string name')
  if (isReservedAlias(name)) throw new TypeError(`"${name}" cannot be an alias: it reads as a direction, time, frame index, 'first' or 'present'`)
  setPendingAlias(name)
  return value
}
