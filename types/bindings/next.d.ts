// Types for soucouyant/bindings/next (Next.js 16 App Router, server side).

import type { AnyStateObject } from '../soucouyant-temporal.js'
import type { Snapshot } from './next-client.js'

export type { Snapshot }

/** { [address]: state } for the given stateObjects, to hand to <SoucouyantState>. */
export declare function snapshot(...stateObjects: AnyStateObject[]): Snapshot
