// Vue 3.5+ binding (Vapor mode in 3.6 included).

import { computed, onScopeDispose, readonly, shallowRef } from 'vue'

const track = (stateObject) => {
  const value = shallowRef(stateObject())
  const subscription = stateObject.sub((state) => { value.value = state })
  onScopeDispose(() => stateObject.unsub(subscription))
  return value
}

export const useSoucouyant = (stateObject) => readonly(track(stateObject))

// For v-model: shows the typed value at once and publishes it
export const useSoucouyantModel = (stateObject) => {
  const value = track(stateObject)
  return computed({
    get: () => value.value,
    set: (next) => {
      value.value = next
      stateObject(next)
    }
  })
}
