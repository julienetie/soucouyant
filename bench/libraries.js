// Reference stores, each set up the way its documentation recommends for a
// single value. Every store exposes get(), set(value) and subscribe(fn).
import { createStore } from 'zustand/vanilla'
import { atom } from 'nanostores'
import { observable as legendObservable } from '@legendapp/state'
import { configureStore, createSlice } from '@reduxjs/toolkit'
import { createActor, createMachine, assign } from 'xstate'
import { observable as mobxObservable, reaction, runInAction, configure as configureMobx } from 'mobx'

configureMobx({ enforceActions: 'never' })

export const zustandStore = () => {
  const store = createStore(() => ({ value: 0 }))
  return {
    get: () => store.getState().value,
    set: (value) => store.setState({ value }),
    subscribe: (fn) => store.subscribe((state) => fn(state.value))
  }
}

export const nanostoresStore = () => {
  const store = atom(0)
  return {
    get: () => store.get(),
    set: (value) => store.set(value),
    subscribe: (fn) => store.listen(fn)
  }
}

export const legendStore = () => {
  const state = legendObservable({ value: 0 })
  return {
    get: () => state.value.get(),
    set: (value) => state.value.set(value),
    subscribe: (fn) => state.value.onChange(({ value }) => fn(value))
  }
}

export const reduxStore = () => {
  const slice = createSlice({
    name: 'counter',
    initialState: { value: 0 },
    reducers: { set: (state, action) => { state.value = action.payload } }
  })
  const store = configureStore({ reducer: slice.reducer, middleware: (getDefault) => getDefault({ serializableCheck: false, immutableCheck: false }) })
  const { set } = slice.actions
  return {
    get: () => store.getState().value,
    set: (value) => store.dispatch(set(value)),
    subscribe: (fn) => store.subscribe(() => fn(store.getState().value))
  }
}

export const xstateStore = () => {
  const machine = createMachine({
    context: { value: 0 },
    on: { set: { actions: assign({ value: ({ event }) => event.value }) } }
  })
  const actor = createActor(machine).start()
  return {
    get: () => actor.getSnapshot().context.value,
    set: (value) => actor.send({ type: 'set', value }),
    subscribe: (fn) => actor.subscribe((snapshot) => fn(snapshot.context.value))
  }
}

export const mobxStore = () => {
  const box = mobxObservable.box(0)
  return {
    get: () => box.get(),
    set: (value) => runInAction(() => box.set(value)),
    subscribe: (fn) => reaction(() => box.get(), fn)
  }
}

export const references = {
  'Legend-State': legendStore,
  'Zustand (vanilla)': zustandStore,
  Nanostores: nanostoresStore,
  'Redux Toolkit': reduxStore,
  XState: xstateStore,
  MobX: mobxStore
}
