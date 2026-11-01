// Types for soucouyant/temporal. Temporal re-exports the core and adds
// recorded history. Importing it anywhere in a program adds purge(),
// trailLimit() and trajectory to every stateObject type, and the history
// settings to o.config(), as it does at runtime.

import type { AnyStateObject, BufferedEntry, Direction, ReleaseAll } from './soucouyant-core.js'

export * from './soucouyant-core.js'

// ---------------------------------------------------------------------------
// Positions and frames
// ---------------------------------------------------------------------------

export type DurationUnit = 'ms' | 's' | 'm' | 'h'

/** A duration such as '200ms', '2.5s', '5m' or '1h'. */
export type Duration = `${number}${DurationUnit}`

/**
 * A place in the chain: a frame index, a time such as '2.5s' (from the start
 * of the session, or the epoch with seekTime: 'epoch'), 'first', 'present',
 * or an alias.
 */
export type Position = number | 'first' | 'present' | Duration | (string & {})

/** Anything head.seek() takes: a position, or a step such as 'rev', 'fwd', '<3' or '>3'. */
export type HeadPosition = Position | 'fwd' | 'rev' | `<${number}` | `>${number}`

/** One recorded publish. */
export interface Frame<T = unknown> {
  readonly index: number
  readonly timestamp: number
  /** The address of the stateObject, such as 'editor > text'. */
  readonly identity: string
  readonly state: T
  /** The position of the state in its finite states, or -1. */
  readonly finiteIndex: number
  readonly alias: string | null
  readonly pending: boolean
  /** True when time travel skips this frame. */
  readonly ignored: boolean
}

/** A frame for chain.validate() and chain.replace(). */
export interface FrameInput {
  readonly index: number
  readonly timestamp: number
  readonly identity: string
  readonly state?: unknown
  readonly pending?: boolean
  readonly ignored?: boolean
  readonly alias?: string | null
  readonly finiteIndex?: number
}

/** A frame read back from storage, as chain.IDBRequestTailSlice() hands it out. */
export interface StoredFrameSlice {
  readonly index: number
  readonly timestamp: number
  readonly identity: string
  readonly state: unknown
  readonly finiteIndex: number
  readonly alias: string | null
  /** Internal frame flags. */
  readonly flags: number
  readonly pending: boolean
}

// ---------------------------------------------------------------------------
// The head
// ---------------------------------------------------------------------------

export interface HeadMeta {
  readonly timestamp: number
  readonly index: number
  readonly isHeadPresent: boolean
  /** The newest live frame at or before the head, or null. */
  getCurrentFrame(): Frame | null
}

/** The playhead over the chain. It decides what get returns and when subscribers fire. */
export interface Head {
  /** When the session started, in milliseconds from performance.timeOrigin. */
  startTime(): number
  meta(): HeadMeta
  /** Moves the head. Returns the frame index it moved to. Throws when nothing matches. */
  seek(position: HeadPosition): number
  /** Makes time travel skip a frame, or stop skipping it with 'stop'. Returns the frame index. */
  ignoreFrame(position: Position, mode?: 'stop'): number
}

export declare const head: Head

// ---------------------------------------------------------------------------
// The chain
// ---------------------------------------------------------------------------

export interface ChainMeta {
  /** Live frames in memory. */
  readonly length: number
  readonly firstIndex: number
  readonly lastIndex: number
  readonly firstTimestamp: number | null
  readonly lastTimestamp: number | null
  readonly framesInMemory: number
  readonly framesInStorage: number
  readonly bufferLength: number
  readonly trailLimit: number | `${number}ms`
}

/** The timeline of recorded frames. */
export interface Chain {
  /** Removes the frames ahead of the head. Returns how many were removed. */
  purge(): number
  /** 'auto': a publish made in the past removes the frames ahead of the head first (undo/redo). 'auto-stop' turns that off. */
  purge(mode: 'auto' | 'auto-stop'): void
  /** Frames kept in memory: a count, or a duration. Default 10,000. */
  trailLimit(): number | `${number}ms`
  trailLimit<L extends number | Duration>(limit: L): L
  /** Enforces the trail limit. 'idb' writes clipped frames to storage first; 'stop' turns it off. */
  autoLimitTail(mode?: 'idb' | 'stop'): void
  tailSliceSize(): number
  tailSliceSize(size: number): number
  /** Receives frames, in slices of tailSliceSize(), before they leave memory. */
  requestTailSlice(callback: (frames: Frame[]) => void): void
  IDBTailSliceSize(size: number): void
  /** Receives frames, in slices, before they leave storage. Optionally only for some stateObjects. */
  IDBRequestTailSlice(callback: (frames: StoredFrameSlice[]) => void, ...stateObjects: AnyStateObject[]): void
  /** A copy of every frame in memory. */
  expose(): Frame[]
  /** Throws a descriptive error when an edited copy of the chain is invalid. */
  validate(chain: readonly FrameInput[]): void
  /** Validates a chain and swaps it in. */
  replace(chain: readonly FrameInput[]): void
  find(position: Position): Frame | undefined
  /** Frames from one position to another, optionally only for some stateObjects. */
  slice(from: Position, to: Position, ...stateObjects: AnyStateObject[]): Frame[]
  /** { [address]: state } at a position, without moving the head. */
  stateAt(position: Position, ...stateObjects: AnyStateObject[]): Record<string, unknown>
  /** Drops history, keeping current states as the base. With storage: true, clears storage too. */
  clear(options: { readonly storage: true }): Promise<void>
  clear(options?: { readonly storage?: false }): undefined
  meta(): ChainMeta
  /** Receives arrays of new frames as they are recorded. Returns the reference. */
  sub<R extends string | number | symbol | object = string>(callback: (frames: Frame[]) => void, ref?: R): R
  unsub(...refs: Array<string | number | symbol | object>): number
  /** Loads the newest frames from storage and moves the head to the present. Returns how many loaded. */
  restore(): Promise<number>
  /** Loads older frames from storage so head.seek() can reach them. Returns how many loaded. */
  restore(from: number, to: number): Promise<number>
  /** Writes queued frames to storage now. */
  flush(): Promise<void>
  /** Publishes waiting behind a lock. */
  readonly buffer: BufferedEntry[]
}

export declare const chain: Chain

/** Names the frame the next publish records, so head.seek(name) can find it. Returns value. */
export declare function alias<T>(name: string, value: T): T

// ---------------------------------------------------------------------------
// Trajectories
// ---------------------------------------------------------------------------

export type Continuation = 'loop' | 'rebound' | 'end' | 'random' | 'random-unique'

type NumericKey<E> = E extends object
  ? { [K in keyof E]-?: E[K] extends number ? K : never }[keyof E] & string
  : never

// Keyframes may carry any field, so any name is allowed; the runtime checks
// it's numeric. Other object states allow only their numeric properties
type IntervalKey<E> = string extends keyof E ? string : NumericKey<E>

export interface TrajectoryOptions<T, E = T> {
  /** The states to visit, in order. Default: every finite state. */
  readonly order?: ReadonlyArray<T | E>
  /** What happens at the end. Default 'loop'. */
  readonly continuation?: Continuation
  /** Milliseconds per state, or the name of a numeric property on each state or keyframe. Default 1000. */
  readonly intervals?: number | IntervalKey<E>
  /** Run each keyframe's action as it becomes active. Needs keyframe states. */
  readonly keyframeActions?: boolean
}

export interface TrajectoryDescription<T> {
  readonly order: T[]
  readonly position: number
  readonly playing: boolean
  readonly direction: Direction
  readonly continuation: Continuation
  readonly intervals: number | string
  readonly keyframeActions: boolean
}

/** Timed playback through a stateObject's finite states. */
export interface Trajectory<T, E = T> {
  /** Configures the trajectory. */
  (options: TrajectoryOptions<T, E>): TrajectoryDescription<T>
  /** Describes the trajectory, or null before it's configured. */
  (): TrajectoryDescription<T> | null
  /** Steps forward one state. Returns the state shown. */
  fwd(): T
  /** Steps back one state. Returns the state shown. */
  rwd(): T
  play(): void
  pause(): void
  /** Stops and returns to the first state. */
  stop(): void
  /** Plays backwards. */
  reverse(): void
  /** Jumps to a position in the order. Returns the state shown. */
  seek(position: number): T
}

// ---------------------------------------------------------------------------
// Storage adapters
// ---------------------------------------------------------------------------

export interface StorageOpenOptions {
  readonly databaseName: string
  readonly objectStoreName: string
}

/** What open() resolves with. lastIndex is -1 when storage is empty. */
export interface StorageOpenResult {
  readonly firstIndex: number
  readonly lastIndex: number
}

/** A batch of frames to write, as columns. objects maps session object ids to addresses. */
export interface StorageBatch {
  readonly indices: Float64Array
  readonly timestamps: Float64Array
  readonly objectIds: Uint32Array
  readonly finiteIndexes: Int32Array
  readonly flags: Uint8Array
  readonly aliases: ReadonlyArray<string | null>
  readonly values: readonly unknown[]
  readonly objects: ReadonlyArray<readonly [id: number, address: string]>
}

/** A frame as an adapter reads it back. */
export interface StoredFrame {
  readonly index: number
  readonly timestamp: number
  readonly identity: string
  readonly state: unknown
  readonly finiteIndex: number
  readonly alias?: string | null
  readonly flags: number
}

/**
 * Persistence for recorded history. sqliteStorage() and indexedDbStorage()
 * implement it; implement it yourself for any other store.
 */
export interface StorageAdapter {
  open(options: StorageOpenOptions): Promise<StorageOpenResult | undefined> | StorageOpenResult | undefined
  /** Inserts or replaces frames by index. */
  writeFrames(batch: StorageBatch): Promise<void>
  readLatest(count: number): Promise<StoredFrame[]>
  readRange(from: number, to: number): Promise<StoredFrame[]>
  deleteBefore(index: number): Promise<void>
  deleteBeforeTime(timestamp: number): Promise<void>
  clear(): Promise<void>
  close(): Promise<void>
}

export type OfflineStorageMode = 'disabled' | 'all' | 'excess'

export interface OfflineStorageOptions {
  /** 'all' writes every frame; 'excess' writes only frames leaving memory. */
  readonly mode?: OfflineStorageMode
  /** Frames kept in storage: a count, or a duration. */
  readonly excessLimit?: number | Duration
  readonly adapter?: StorageAdapter | null
}

// ---------------------------------------------------------------------------
// What temporal adds to the core types
// ---------------------------------------------------------------------------

declare module './soucouyant-core.js' {
  interface StateObject<T> {
    /** Removes this stateObject's frames ahead of the head. Returns how many were removed. */
    purge(): number
    /** 'auto': a publish made in the past removes this stateObject's frames ahead of the head first. */
    purge(mode: 'auto' | 'auto-stop'): void
    /** This stateObject's own trail limit: a count, a duration, or Infinity for none. */
    trailLimit(): number | `${number}ms`
    trailLimit<L extends number | Duration | null>(limit: L): L
  }

  interface FiniteStateObject<T, E = T> {
    readonly trajectory: Trajectory<T, E>
  }

  interface ConfigOptions {
    /** Records history. Needed for time travel. */
    persist?: boolean
    /** Publishing again within this window overwrites the last frame: a duration, a frame count, or 0 to record every publish. Default '200ms'. */
    mergeFidelity?: number | Duration
    offlineStorage?: OfflineStorageOptions
    /** Whether time strings count from the session start or the epoch. Default 'session'. */
    seekTime?: 'session' | 'epoch'
    databaseName?: string
    objectStoreName?: string
  }

  interface Settings {
    readonly persist: boolean
    readonly mergeFidelity: number | Duration
    readonly offlineStorage: {
      readonly mode: OfflineStorageMode
      readonly excessLimit: number | Duration
      readonly adapter: StorageAdapter | null
    }
    readonly seekTime: 'session' | 'epoch'
    readonly databaseName: string
    readonly objectStoreName: string
  }

  interface Mutex {
    /** Locks every stateObject, the same as mutex.lock(o). */
    lock(target: Chain): ReleaseAll
    unlock(target: Chain): boolean
  }
}
