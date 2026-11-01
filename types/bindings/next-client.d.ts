// Types for soucouyant/bindings/next/client (Next.js 16 App Router, client side).

import type { ReactNode } from 'react'

export { useSoucouyant, useSoucouyantModel } from './react.js'

/** States by address, as snapshot() returns them on the server. */
export type Snapshot = Readonly<Record<string, unknown>>

export interface SoucouyantStateProps {
  /** The server's snapshot(). It's applied once, during the first render, before any child reads state. */
  readonly snapshot: Snapshot
  readonly children?: ReactNode
}

/** Applies a server snapshot so server HTML and the first client render match. */
export declare function SoucouyantState(props: SoucouyantStateProps): ReactNode
