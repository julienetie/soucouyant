// React 19 binding, built on useSyncExternalStore.

import { useState, useSyncExternalStore } from 'react'

const subscribeFunctions = new WeakMap()

// One stable subscribe function per stateObject, so React never resubscribes
// on re-render
const subscribeTo = (stateObject) => {
  let subscribe = subscribeFunctions.get(stateObject)
  if (subscribe === undefined) {
    subscribe = (onChange) => {
      const ref = stateObject.sub(() => onChange())
      return () => stateObject.unsub(ref)
    }
    subscribeFunctions.set(stateObject, subscribe)
  }
  return subscribe
}

// The stateObject itself is the snapshot function: calling it with no
// arguments is a get
export const useSoucouyant = (stateObject) =>
  useSyncExternalStore(subscribeTo(stateObject), stateObject, stateObject)

// For text inputs: shows what was typed until the store moves on, so a
// notification arriving a frame later never resets the input or its cursor
export const useSoucouyantModel = (stateObject) => {
  const stored = useSoucouyant(stateObject)
  const [typed, setTyped] = useState({ value: stored, from: stored })
  const value = Object.is(typed.from, stored) ? typed.value : stored
  const setValue = (next) => {
    setTyped({ value: next, from: stored })
    stateObject(next)
  }
  return [value, setValue]
}
