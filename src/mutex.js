// mutex.lock() returns a release function; only its holder publishes through
// the lock. Everyone else's publishes queue in the buffer.
//
// mutex.lock(o) locks every stateObject at once. soucouyant-temporal.js adds
// its chain as another name for the same lock.

import { NO_VALUE } from './constants.js'
import {
  records, idOfStateObject, lockObject, unlockObject, lockAll, unlockAll, allLockHeldBy,
  publishAsObjectHolder, publishAsAllHolder, bufferedEntries
} from './engine.js'
import { o } from './accessor.js'

const lockEverythingTargets = new Set([o])

export const addLockEverythingTarget = (target) => { lockEverythingTargets.add(target) }

const idOfLockTarget = (stateObject) => {
  const id = idOfStateObject.get(stateObject)
  if (id === undefined) throw new TypeError('mutex expects a stateObject or o')
  return id
}

const lockStateObject = (id) => {
  const token = {}
  lockObject(id, token)
  return (value = NO_VALUE) => {
    if (records[id].lockToken !== token) return undefined
    let result
    try {
      if (value !== NO_VALUE) result = publishAsObjectHolder(id, value)
    } finally {
      unlockObject(id)
    }
    return result
  }
}

const lockEverything = () => {
  const token = {}
  lockAll(token)
  return (stateObject, value = NO_VALUE) => {
    if (!allLockHeldBy(token)) return undefined
    let result
    try {
      if (stateObject !== undefined && value !== NO_VALUE) result = publishAsAllHolder(idOfLockTarget(stateObject), value)
    } finally {
      unlockAll()
    }
    return result
  }
}

export const mutex = {
  lock: (target) => lockEverythingTargets.has(target) ? lockEverything() : lockStateObject(idOfLockTarget(target)),
  unlock: (target) => lockEverythingTargets.has(target) ? unlockAll() : unlockObject(idOfLockTarget(target)),
  // Publishes waiting behind a lock
  get buffer () {
    return bufferedEntries()
  }
}
