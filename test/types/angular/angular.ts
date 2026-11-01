// The Angular binding. Its own project, because Angular 21's types need a
// newer TypeScript than the oldest one Soucouyant supports.
import { o, finite } from 'soucouyant'
import { injectSoucouyant } from 'soucouyant/bindings/angular'
import type { Signal } from '@angular/core'
import { assert, type Equal } from '../expect.js'

const state = o({ form: { name: '', colour: finite('red', ['red', 'blue']) } })

const signal = injectSoucouyant(state.form.colour)
assert<Equal<typeof signal, Signal<'red' | 'blue'>>>()
const signalValue = signal()
assert<Equal<typeof signalValue, 'red' | 'blue'>>()
const name = injectSoucouyant(state.form.name)()
assert<Equal<typeof name, string>>()
// @ts-expect-error the signal is read-only
signal.set('blue')
