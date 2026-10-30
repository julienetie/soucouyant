// Plain frame objects for user code, materialized from the columns. Only the
// calls that hand frames out allocate.

import { pending, FRAME_PENDING, FRAME_IGNORED } from '../constants.js'
import { records } from '../engine.js'
import { frameObjectId, frameTimestamp, frameFlags, frameFiniteIndex, frameValue, aliasesByFrame, slotOf } from './log.js'

export const createFrame = (index, timestamp, identity, state, finiteIndex, alias, isPending, ignored) => ({
  index, timestamp, identity, state, finiteIndex, alias, pending: isPending, ignored
})

export const materializeFrame = (index) => {
  const slot = slotOf(index)
  const flags = frameFlags[slot]
  return createFrame(
    index,
    frameTimestamp[slot],
    records[frameObjectId[slot]].address,
    (flags & FRAME_PENDING) !== 0 ? pending : frameValue[slot],
    frameFiniteIndex[slot],
    aliasesByFrame.get(index) ?? null,
    (flags & FRAME_PENDING) !== 0,
    (flags & FRAME_IGNORED) !== 0
  )
}
