// Types for soucouyant/polychrony: several timelines at once. Importing it
// adds chain.create(), chain.get() and chain.list(), and it re-exports
// temporal, which re-exports the core.

import type { O, ConfigOptions } from './soucouyant-core.js'
import type { Chain, Head } from './soucouyant-temporal.js'

export * from './soucouyant-temporal.js'

/** A timeline's chain: the same interface as the main chain, plus its name and delete(). */
export interface TimelineChain extends Chain {
  /** The name given to chain.create(). */
  readonly name: string
  /**
   * Discards the timeline: it stops receiving declarations, its trajectories
   * pause, its storage is flushed and closed, and chain.get() no longer finds
   * it. Returns false when it was already deleted.
   */
  delete(): boolean
}

/** What a timeline adds to a root like o: its own head and chain. */
export interface TimelineControls {
  readonly head: Head
  readonly chain: TimelineChain
}

/**
 * A timeline: a whole world of state with its own values, subscribers,
 * locks, history and head. It acts like o, typed from the same registered
 * shape, and branches off its parent with the parent's states and past.
 */
export type Timeline = O & TimelineControls

/** Names the frame the next publish records, on whichever timeline records it first. Returns value. */
export declare function alias<T>(name: string, value: T): T

declare module './soucouyant-temporal.js' {
  interface Chain {
    /**
     * Branches a new timeline off this one. It starts with this timeline's
     * states and recorded past, then moves independently. Options are the
     * same as o.config(); the rest are inherited, with recording on.
     */
    create(name: string, options?: ConfigOptions): Timeline
    /** The timeline with this name, or undefined. */
    get(name: string): Timeline | undefined
    /** The names of every timeline made by chain.create(). */
    list(): string[]
  }
}
