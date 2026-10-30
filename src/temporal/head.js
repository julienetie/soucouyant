// The head: a playhead over the chain. It decides what get returns and when
// subscribers fire; it never decides what gets recorded.

import { observe } from '../engine.js'
import { headIndex, isHeadPresent, firstIndex, nextIndex, moveHeadTo, liveFrameAfter, liveFrameBefore, setFrameIgnored, frameTimestamp, frameFlags, slotOf } from './log.js'
import { FRAME_DEAD } from '../constants.js'
import { startTime } from '../environment.js'
import { requireHistory, resolvePosition, stepPattern } from './positions.js'
import { materializeFrame } from './frames.js'

// The last live frame at or before the head, or NaN
const currentLiveFrame = () => {
  for (let index = headIndex; index >= firstIndex; index--) {
    if ((frameFlags[slotOf(index)] & FRAME_DEAD) === 0) return index
  }
  return NaN
}

const stepBy = (count) => {
  let target = headIndex
  if (count > 0) {
    for (let i = 0; i < count; i++) {
      const next = liveFrameAfter(target)
      if (Number.isNaN(next)) break
      target = next
    }
  } else {
    let current = currentLiveFrame()
    for (let i = 0; i > count && !Number.isNaN(current); i--) {
      const previous = liveFrameBefore(current)
      target = Number.isNaN(previous) ? firstIndex - 1 : previous
      current = previous
    }
  }
  moveHeadTo(target)
}

const seekHead = (position) => {
  requireHistory()
  if (position === 'fwd') stepBy(1)
  else if (position === 'rev') stepBy(-1)
  else if (typeof position === 'string' && stepPattern.test(position)) {
    const count = Number(position.slice(1))
    stepBy(position[0] === '>' ? count : -count)
  } else {
    const index = resolvePosition(position)
    if (Number.isNaN(index)) throw new RangeError(`No frame matches ${String(position)}`)
    moveHeadTo(index)
  }
  observe('seek', -1, position)
  return headIndex
}

const ignoreFrame = (position, mode) => {
  requireHistory()
  if (mode !== undefined && mode !== 'stop') throw new TypeError('ignoreFrame() takes \'stop\' as its second argument to stop ignoring a frame')
  const index = resolvePosition(position)
  if (Number.isNaN(index) || !setFrameIgnored(index, mode !== 'stop')) {
    throw new RangeError(`No frame matches ${String(position)}`)
  }
  return index
}

const headMeta = () => {
  const inMemory = headIndex >= firstIndex && headIndex < nextIndex
  return {
    timestamp: inMemory ? frameTimestamp[slotOf(headIndex)] : startTime,
    index: headIndex,
    isHeadPresent,
    getCurrentFrame: () => {
      const index = currentLiveFrame()
      return Number.isNaN(index) ? null : materializeFrame(index)
    }
  }
}

export const head = {
  startTime: () => startTime,
  meta: headMeta,
  seek: seekHead,
  ignoreFrame
}
