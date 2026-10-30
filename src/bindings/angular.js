// Angular 21+ binding. Signals mark zoneless and OnPush components for
// update, so no change-detection wiring is needed.

import { DestroyRef, inject, signal } from '@angular/core'

// Call in an injection context: a field initializer or a constructor
export const injectSoucouyant = (stateObject) => {
  const value = signal(stateObject())
  const subscription = stateObject.sub((state) => value.set(state))
  inject(DestroyRef).onDestroy(() => stateObject.unsub(subscription))
  return value.asReadonly()
}
