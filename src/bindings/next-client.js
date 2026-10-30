'use client'
// Next.js 16 binding, client side.

import { useState } from 'react'
import { o } from '../soucouyant-core.js'

export { useSoucouyant, useSoucouyantModel } from './react.js'

const findStateObject = (address) => address.split(' > ').reduce((node, name) => node[name], o)

// Applies a server snapshot once, during the first render, before any child
// reads state, so server HTML and the first client render match
export const SoucouyantState = ({ snapshot, children }) => {
  useState(() => {
    for (const address in snapshot) findStateObject(address)(snapshot[address])
  })
  return children
}
