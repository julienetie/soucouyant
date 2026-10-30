// Shared symbols and bit flags. Kept in one tiny module so every other
// module agrees on the same values without import cycles.

// Public subscription symbols
export const pending = Symbol.for('soucouyant.pending')
export const republish = Symbol.for('soucouyant.republish')

// Internal sentinel: a stateObject called with no argument is a get
export const GET = Symbol('soucouyant.get')
// Internal sentinel: a release function called with no argument only unlocks
export const NO_VALUE = Symbol('soucouyant.no-value')

// Per-stateObject flags (objectFlags column, Uint16Array)
export const FINITE = 1
export const LOCKED = 2
export const DIRTY = 4
export const TRANSITIONS = 8
export const WANTS_PROPS = 16
export const AUTO_PURGE = 32
export const OWN_TRAIL_LIMIT = 64
export const MOVED = 128
export const HAS_SUBSCRIBERS = 256

// Per-frame flags (frameFlags column, Uint8Array)
export const FRAME_PENDING = 1
export const FRAME_IGNORED = 2
export const FRAME_PURGED = 4
export const FRAME_ALIASED = 8
// A stateObject's declaration frame: never merged into
export const FRAME_BASE = 16
export const FRAME_DEAD = FRAME_IGNORED | FRAME_PURGED

// Notification directions
export const FORWARD = 0
export const REVERSE = 1
export const directionNames = ['fwd', 'rev']

// Buffer entry kinds
export const BUFFERED_VALUE = 0
export const BUFFERED_CALLBACK = 1

// Key used in the lock buffer map for the lock on every stateObject
export const ALL_KEY = -1

// Spacing between keyframe snapshots of the registry, in frames
export const SNAPSHOT_SPACING = 1024

// Indices at or above this cannot use the bitwise ring mask
export const INT32_LIMIT = 2147483648
