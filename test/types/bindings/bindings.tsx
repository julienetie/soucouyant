// Framework bindings that need only the core.
import { o, finite } from 'soucouyant'
import { useSoucouyant, useSoucouyantModel } from 'soucouyant/bindings/react'
import { useSoucouyant as useVue, useSoucouyantModel as useVueModel } from 'soucouyant/bindings/vue'
import { fromSoucouyant, toStore } from 'soucouyant/bindings/svelte'
import { SoucouyantState, useSoucouyant as useNextClient, type Snapshot } from 'soucouyant/bindings/next/client'
import type { ReactNode } from 'react'
import { assert, type Equal } from '../expect.js'

const state = o({ form: { name: '', colour: finite('red', ['red', 'blue']) } })

// React
const name = useSoucouyant(state.form.name)
assert<Equal<typeof name, string>>()
const colour = useSoucouyant(state.form.colour)
assert<Equal<typeof colour, 'red' | 'blue'>>()
const [typed, setTyped] = useSoucouyantModel(state.form.name)
assert<Equal<typeof typed, string>>()
setTyped('Ada')
// @ts-expect-error the setter takes strings
setTyped(1)

// Vue
const nameRef = useVue(state.form.name)
const nameValue: string = nameRef.value
void nameValue
// @ts-expect-error the ref is read-only
nameRef.value = 'Ada'
const model = useVueModel(state.form.name)
model.value = 'Ada'
// @ts-expect-error the model holds strings
model.value = 1

// Svelte
const rune = fromSoucouyant(state.form.name)
rune.current = 'Ada'
const runeValue = rune.current
assert<Equal<typeof runeValue, string>>()
const store = toStore(state.form.colour)
const stop = store.subscribe((value) => { assert<Equal<typeof value, 'red' | 'blue'>>() })
stop()
// @ts-expect-error not a colour
store.set('green')

// Next.js client
const snapshot: Snapshot = { 'form > name': 'Ada' }
const page = (
  <SoucouyantState snapshot={snapshot}>
    <p>{useNextClient(state.form.name)}</p>
  </SoucouyantState>
)
const node: ReactNode = page
void node
