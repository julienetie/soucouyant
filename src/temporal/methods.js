// The history methods every stateObject gains when temporal loads:
// purge(), trailLimit() and, on finite stateObjects, trajectory().

import { records, settleNow } from '../engine.js'
import { extendStateObjects } from '../accessor.js'
import { persistEnabled, purgeObjectAhead, setObjectAutoPurge, setObjectTrailLimit, parseDuration } from './log.js'
import { createTrajectoryControls } from './trajectory.js'

const objectTrailLimit = (id, limit) => {
  const record = records[id]
  if (limit === undefined) return record.trailWindow !== 0 ? `${record.trailWindow}ms` : record.trailLimit === 0 ? Infinity : record.trailLimit
  if (limit === Infinity || limit === 0 || limit === null) {
    setObjectTrailLimit(id, 0, 0)
  } else if (typeof limit === 'number') {
    if (!Number.isInteger(limit) || limit < 1) throw new RangeError('trailLimit() takes a whole number of frames or a duration such as \'30s\'')
    setObjectTrailLimit(id, limit, 0)
  } else {
    const window = parseDuration(limit)
    if (Number.isNaN(window)) throw new RangeError('trailLimit() takes a whole number of frames or a duration such as \'30s\'')
    setObjectTrailLimit(id, 0, window)
  }
  return limit
}

const purgeObject = (id, mode) => {
  if (mode === 'auto') return setObjectAutoPurge(id, true)
  if (mode === 'auto-stop') return setObjectAutoPurge(id, false)
  if (mode !== undefined) throw new TypeError('purge() takes no argument, \'auto\' or \'auto-stop\'')
  if (!persistEnabled) return 0
  const removed = purgeObjectAhead(id)
  settleNow()
  return removed
}

extendStateObjects((stateObject, id, isFinite) => {
  stateObject.purge = (mode) => purgeObject(id, mode)
  stateObject.trailLimit = (limit) => objectTrailLimit(id, limit)
  if (isFinite) stateObject.trajectory = createTrajectoryControls(id)
})
