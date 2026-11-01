// Registering the declared object types o itself, everywhere. This project
// turns on every strict option, including noUncheckedIndexedAccess and
// noPropertyAccessFromIndexSignature: registered paths are real properties.
import { o, finite, value, mutex, pending } from 'soucouyant'
import type { Pending, StateObject } from 'soucouyant'
import { useSoucouyant } from 'soucouyant/bindings/react'
import { assert, type Equal } from '../expect.js'

interface Profile { name: string, role: 'admin' | 'member' }

const shape = {
  editor: { text: '', saved: false },
  traffic: { light: finite('red', ['red', 'green', 'amber']) },
  account: { profile: value<Profile | Pending>(pending) }
}

export const state = o(shape)

declare module 'soucouyant' {
  interface Register {
    shape: typeof shape
  }
}

// o itself is typed now, in this file and every other
const text = o.editor.text()
assert<Equal<typeof text, string>>()
const light = o.traffic.light()
assert<Equal<typeof light, 'red' | 'green' | 'amber'>>()
const profile = o.account.profile()
assert<Equal<typeof profile, Profile | Pending>>()
o.account.profile({ name: 'Ada', role: 'admin' })
// @ts-expect-error role is 'admin' or 'member'
o.account.profile({ name: 'Ada', role: 'owner' })

// The same stateObjects either way
assert<Equal<typeof o.editor.text, typeof state.editor.text>>()

// @ts-expect-error not declared
void o.missing
// @ts-expect-error text is a string
o.editor.text(1)
// @ts-expect-error saved is not a namespace
void o.editor.saved.deeper

// The root keeps its own members
o.config({ execution: 'sync' })
o.scope('/src/state.js')
o`late > addition`(1)
const releaseAll = mutex.lock(o)
releaseAll(o.editor.saved, true)

// Bindings see the registered types
const shown = useSoucouyant(o.editor.text)
assert<Equal<typeof shown, string>>()

const describe = <T>(stateObject: StateObject<T>): T => stateObject()
const shownLight = describe(o.traffic.light)
assert<Equal<typeof shownLight, 'red' | 'green' | 'amber'>>()
