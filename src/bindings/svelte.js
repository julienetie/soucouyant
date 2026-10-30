// Svelte 5.7+ binding.

import { createSubscriber } from 'svelte/reactivity'

// Runes: read .current in markup or $derived; bind:value={colour.current} works.
// The getter and setter are the one place method syntax is unavoidable:
// Svelte tracks reads through a property access. Neither uses `this`.
export const fromSoucouyant = (stateObject) => {
  const subscribe = createSubscriber((update) => {
    const subscription = stateObject.sub(() => update())
    return () => stateObject.unsub(subscription)
  })
  return {
    get current () {
      subscribe()
      return stateObject()
    },
    set current (next) {
      stateObject(next)
    }
  }
}

// The classic store contract, for $store syntax and libraries that expect stores
export const toStore = (stateObject) => ({
  subscribe: (run) => {
    run(stateObject())
    const subscription = stateObject.sub((state) => run(state))
    return () => stateObject.unsub(subscription)
  },
  set: (next) => { stateObject(next) }
})
