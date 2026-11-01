// What soucouyant-polychrony.js needs from inside a timeline. The main
// timeline imports this module directly, and every timeline made by
// chain.create() carries its own copy of it, so polychrony handles them all
// the same way.

import { declarationLog, onDeclared, declareNames, freezeLog, onFrozen, freezeAddress, setForeignFreeze, isNamespace } from '../accessor.js'
import { settings, objectCount, headValueOf, idOfStateObject, stateObjects, records } from '../engine.js'
import { baseValue, setBaseValue, persistEnabled, headIndex, isHeadPresent, setPendingAlias, clearPendingAlias, addHook, removeHook } from '../temporal/log.js'
import { setForeignMutex } from '../mutex.js'
import { startTime } from '../environment.js'

export { declarationLog, onDeclared, declareNames, freezeLog, onFrozen, freezeAddress, setForeignFreeze, setForeignMutex, settings, setBaseValue, headValueOf, setPendingAlias, clearPendingAlias }

// Runs a callback for each new frame this timeline records
export const onFrameRecorded = (hook) => addHook('recorded', hook)
export const offFrameRecorded = (hook) => removeHook('recorded', hook)

// When this timeline's session started: time strings count from it
export const sessionStart = () => startTime

export const stateObjectCount = () => objectCount

export const isRecording = () => persistEnabled

// The frame index the head shows, or null when it's at the present
export const headPosition = () => isHeadPresent ? null : headIndex

// The state each stateObject had before the oldest frame in memory
export const baseValueOf = (id) => baseValue[id]

// True for this timeline's root, namespaces and stateObjects
export const owns = (target) => idOfStateObject.has(target) || isNamespace(target)

// Pauses every playing trajectory, for a timeline being deleted
export const pauseTrajectories = () => {
  for (let id = 0; id < stateObjects.length; id++) {
    const trajectory = records[id].trajectory
    if (trajectory !== null && trajectory.configured && trajectory.playing) stateObjects[id].trajectory.pause()
  }
}
