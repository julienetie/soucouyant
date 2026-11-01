// Types for soucouyant/bindings/angular (Angular 21 and later).

import type { Signal } from '@angular/core'
import type { StateObject } from '../soucouyant-core.js'

/** A read-only signal of the stateObject's state. Call it in an injection context: a field initializer or a constructor. */
export declare function injectSoucouyant<T>(stateObject: StateObject<T>): Signal<T>
