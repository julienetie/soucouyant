// Next.js 16 binding, server side. Client components import
// 'soucouyant/bindings/next/client' instead: a 'use client' module turns
// every export into a client reference, so snapshot() lives here.

import { chain } from '../soucouyant-temporal.js'

// { [address]: state } for the given stateObjects, to hand to <SoucouyantState>
export const snapshot = (...stateObjects) => chain.stateAt('present', ...stateObjects)
