// Turns the position forms accepted by head and chain into logical frame
// indices: numbers are frame indices, unit strings are times, 'first' and
// 'present' are the ends, anything else is an alias.

import {
  settings, firstIndex, nextIndex, framesByAlias, frameTimestamp, slotOf, parseDuration, liveFrameAfter, persistEnabled
} from './core.js'
import { startTime } from './environment.js'

export const timePattern = /^\s*\d+(?:\.\d+)?\s*(?:ms|s|m|h)\s*$/
export const stepPattern = /^[<>]\d+$/

export const requireHistory = () => {
  if (!persistEnabled) throw new Error('Time travel and history need o.config({ persist: true })')
}

// Last frame with a timestamp at or before `time`, or firstIndex - 1
export const frameAtTime = (time) => {
  let low = firstIndex
  let high = nextIndex - 1
  let found = firstIndex - 1
  while (low <= high) {
    const middle = low + Math.floor((high - low) / 2)
    if (frameTimestamp[slotOf(middle)] <= time) {
      found = middle
      low = middle + 1
    } else {
      high = middle - 1
    }
  }
  return found
}

export const timeOf = (text) => {
  const amount = parseDuration(text)
  return settings.seekTime === 'epoch' ? amount : startTime + amount
}

// Returns a logical index, or NaN when the position names nothing
export const resolvePosition = (position) => {
  if (typeof position === 'number') {
    if (!Number.isInteger(position)) throw new TypeError('Frame indices are integers')
    return position
  }
  if (typeof position !== 'string') throw new TypeError('A position is a frame index, a time such as \'2.5s\', \'first\', \'present\' or an alias')
  if (position === 'first') {
    const first = liveFrameAfter(firstIndex - 1)
    return Number.isNaN(first) ? firstIndex - 1 : first
  }
  if (position === 'present') return nextIndex - 1
  if (timePattern.test(position)) return frameAtTime(timeOf(position))
  const aliased = framesByAlias.get(position)
  return aliased === undefined ? NaN : aliased
}

export const isReservedAlias = (name) =>
  name === 'fwd' || name === 'rev' || name === 'first' || name === 'present' ||
  stepPattern.test(name) || timePattern.test(name) || /^\s*-?\d+(?:\.\d+)?\s*$/.test(name)
