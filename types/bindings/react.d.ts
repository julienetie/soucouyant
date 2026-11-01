// Types for soucouyant/bindings/react (React 19 and later).

import type { StateObject } from '../soucouyant-core.js'

/** The stateObject's state, re-rendering the component when it changes. */
export declare function useSoucouyant<T>(stateObject: StateObject<T>): T

/**
 * For text inputs: the value and a setter. Shows what was typed until the
 * store moves on, so a notification arriving a frame later never resets the
 * input or its cursor.
 */
export declare function useSoucouyantModel<T>(stateObject: StateObject<T>): [value: T, setValue: (next: T) => void]
