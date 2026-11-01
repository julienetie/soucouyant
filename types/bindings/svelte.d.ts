// Types for soucouyant/bindings/svelte (Svelte 5.7 and later).

import type { StateObject } from '../soucouyant-core.js'

/** Read .current in markup or $derived; bind:value={colour.current} publishes. */
export interface SoucouyantRune<T> {
  current: T
}

/** The Svelte store contract, for $store syntax and libraries that expect stores. */
export interface SoucouyantStore<T> {
  subscribe(run: (value: T) => void): () => void
  set(value: T): void
}

export declare function fromSoucouyant<T>(stateObject: StateObject<T>): SoucouyantRune<T>

export declare function toStore<T>(stateObject: StateObject<T>): SoucouyantStore<T>
