// Types for soucouyant/bindings/vue (Vue 3.5 and later).

import type { DeepReadonly, ShallowRef, WritableComputedRef } from 'vue'
import type { StateObject } from '../soucouyant-core.js'

/** A read-only ref of the stateObject's state. Call it in setup() or an effect scope. */
export declare function useSoucouyant<T>(stateObject: StateObject<T>): DeepReadonly<ShallowRef<T>>

/** A writable computed ref for v-model: shows the typed value at once and publishes it. */
export declare function useSoucouyantModel<T>(stateObject: StateObject<T>): WritableComputedRef<T>
