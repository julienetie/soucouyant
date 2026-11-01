// The core on its own: object declarations, tagged templates, get, publish,
// subscriptions, finite states, the mutex and configuration. Nothing in this
// project imports temporal, so history methods must not exist.
import { o, finite, value, pending, republish, mutex, freeze } from 'soucouyant'
import type { Pending, StateObject, FiniteStateObject, Props, Settings, BufferedEntry, AnyStateObject } from 'soucouyant'
import { assert, type Equal } from '../expect.js'

o.config({ execution: 'sync' })

interface User { id: number }

// ---------------------------------------------------------------------------
// Object declarations infer every type
// ---------------------------------------------------------------------------

const state = o({
  editor: { text: '', cursor: { line: 1, column: 0 } },
  cart: { open: false, items: [] as string[] },
  traffic: {
    light: finite('red', ['red', 'green', 'amber'], { transitions: { red: ['green'], green: ['amber'], amber: ['red'] } }),
    size: finite(1, new Set([1, 2, 3]))
  },
  account: {
    profile: value({ name: 'Ada', age: 36 }),
    user: value<User | Pending>(pending)
  },
  later: undefined,
  lookup: new Map<string, number>(),
  when: new Date(0),
  nothing: null
})

const text = state.editor.text()
assert<Equal<typeof text, string>>()
const line = state.editor.cursor.line()
assert<Equal<typeof line, number>>()
const open = state.cart.open()
assert<Equal<typeof open, boolean>>()
const items = state.cart.items()
assert<Equal<typeof items, string[]>>()
const light = state.traffic.light()
assert<Equal<typeof light, 'red' | 'green' | 'amber'>>()
assert<Equal<typeof state.traffic.light, FiniteStateObject<'red' | 'green' | 'amber'>>>()
const size = state.traffic.size()
assert<Equal<typeof size, number>>()
const profile = state.account.profile()
assert<Equal<typeof profile, { name: string, age: number }>>()
const user = state.account.user()
assert<Equal<typeof user, User | Pending>>()
const later = state.later()
assert<Equal<typeof later, unknown>>()
const lookup = state.lookup()
assert<Equal<typeof lookup, Map<string, number>>>()
const when = state.when()
assert<Equal<typeof when, Date>>()
const nothing = state.nothing()
assert<Equal<typeof nothing, null>>()

// Getting with undefined is a get too
const alsoText = state.editor.text(undefined)
assert<Equal<typeof alsoText, string>>()

// ---------------------------------------------------------------------------
// Publishing
// ---------------------------------------------------------------------------

const published = state.editor.text('Hello')
assert<Equal<typeof published, string | undefined>>()

const appended = state.editor.text((current) => {
  assert<Equal<typeof current, string>>()
  return current + '!'
})
assert<Equal<typeof appended, string | undefined>>()

// Returning undefined from a callback publishes nothing
state.editor.text((current) => current === '' ? undefined : current.trim())

const fetched = state.editor.text(async (current) => current + '?')
assert<Equal<typeof fetched, Promise<string | undefined>>>()

state.traffic.light('green')
state.account.user({ id: 1 })
state.account.user(pending)

// @ts-expect-error a number is not a string
state.editor.text(3)
// @ts-expect-error the array holds strings
state.cart.items(['a', 1])
// @ts-expect-error 'blue' is not one of the finite states
state.traffic.light('blue')
// @ts-expect-error the callback must return a string
state.editor.text((current) => current.length)
// @ts-expect-error pending is not part of string
state.editor.text(pending)
// @ts-expect-error profile needs both fields
state.account.profile({ name: 'Grace' })

// ---------------------------------------------------------------------------
// finite() and value()
// ---------------------------------------------------------------------------

// @ts-expect-error the initial state must be one of the finite states
finite('purple', ['red', 'green'])
// @ts-expect-error transition rules can only name the finite states
finite('a', ['a', 'b'], { transitions: { a: ['c'] } })
// @ts-expect-error transition keys are the finite states
finite('a', ['a', 'b'], { transitions: { z: ['a'] } })
// Map rules for any state type
finite(1, [1, 2], { transitions: new Map([[1, [2]]]) })
// No initial state: starts pending
finite(undefined, ['a', 'b'])

// ---------------------------------------------------------------------------
// What o() rejects at runtime is a type error
// ---------------------------------------------------------------------------

// @ts-expect-error config is reserved on o
o({ config: 1 })
// @ts-expect-error scope is reserved everywhere
o({ group: { scope: 1 } })
// @ts-expect-error functions can't be state
o({ group: { handler: () => 1 } })
// @ts-expect-error o() needs at least one stateObject
o({})
// @ts-expect-error a namespace needs at least one stateObject
o({ group: {} })
// @ts-expect-error o() takes an object, not an array
o([1, 2])

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------

const ref = state.editor.text.sub((current) => {
  assert<Equal<typeof current, string>>()
})
assert<Equal<typeof ref, string>>()

state.editor.text.sub((current, props) => {
  assert<Equal<typeof props, Props<string>>>()
  assert<Equal<typeof props.rev, string | undefined>>()
  assert<Equal<typeof props.direction, 'fwd' | 'rev'>>()
  assert<Equal<typeof props.states, readonly string[] | null>>()
})

const named = state.editor.text.sub(() => {}, 'toolbar')
assert<Equal<typeof named, 'toolbar'>>()

const both = state.editor.text.sub(() => {}, () => {})
assert<Equal<typeof both, [string, string]>>()

const withProps = state.traffic.light.sub.withProps((current) => {
  assert<Equal<typeof current, 'red' | 'green' | 'amber'>>()
})
assert<Equal<typeof withProps, string>>()

const removed = state.editor.text.unsub(ref, named)
assert<Equal<typeof removed, number>>()

// A subscriber written separately
const render = (value: string, props: Props<string>): void => { void value; void props }
state.editor.text.sub(render)
// @ts-expect-error the subscriber expects numbers
state.editor.text.sub((value: number) => { void value })

// ---------------------------------------------------------------------------
// scope(), startTime(), freeze()
// ---------------------------------------------------------------------------

const scoped = state.editor.text.scope('/src/editor.js')
assert<Equal<typeof scoped, typeof state.editor.text>>()
state.editor.scope('/src/editor.js', '/src/toolbar.js')
// @ts-expect-error scope paths start with '/'
state.editor.text.scope('src/editor.js')
// @ts-expect-error scope needs at least one path
state.editor.text.scope()

const declaredAt = state.editor.text.startTime()
assert<Equal<typeof declaredAt, number>>()

const frozen = freeze(state.editor)
assert<Equal<typeof frozen, typeof state.editor>>()
freeze(o)

// ---------------------------------------------------------------------------
// Tagged templates declare at runtime; untyped/untyped.ts covers reading them
// ---------------------------------------------------------------------------

o`app > theme`('dark')`app > fontSize`(14)
o`app > mode`('light', ['light', 'dark'], { transitions: { light: ['dark'] } })
// @ts-expect-error the initial state must be one of the finite states
o`app > other`('dim', ['light', 'dark'])

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const settings = o.config({ execution: 'async-queue', development: 'freeze', asyncLockTimeout: 5000 })
assert<Equal<typeof settings, Settings>>()
assert<Equal<typeof settings.execution, 'sync' | 'async-queue' | 'async-frame'>>()
// @ts-expect-error not an execution mode
o.config({ execution: 'later' })
// @ts-expect-error persist needs soucouyant/temporal
o.config({ persist: true })
// @ts-expect-error unknown option
o.config({ colour: 'red' })

const isolated = o.isolate(() => 1)
assert<Equal<typeof isolated, number>>()
const isolatedAsync = o.isolate(async () => 'done')
assert<Equal<typeof isolatedAsync, Promise<string>>>()

// ---------------------------------------------------------------------------
// Mutex
// ---------------------------------------------------------------------------

const release = mutex.lock(state.editor.text)
const releasedWith = release('saved')
assert<Equal<typeof releasedWith, string | undefined>>()
release()
release(republish)
release((current) => current.toUpperCase())
// @ts-expect-error the release function publishes strings
release(5)

const releaseAll = mutex.lock(o)
releaseAll(state.cart.open, true)
releaseAll(state.cart.items, (current) => [...current, 'x'])
releaseAll()
// @ts-expect-error open is a boolean
releaseAll(state.cart.open, 'yes')

const unlocked = mutex.unlock(state.editor.text)
assert<Equal<typeof unlocked, boolean>>()
mutex.unlock(o)
const buffer = mutex.buffer
assert<Equal<typeof buffer, BufferedEntry[]>>()

// ---------------------------------------------------------------------------
// Generic code over stateObjects
// ---------------------------------------------------------------------------

const read = <T>(stateObject: StateObject<T>): T => stateObject()
const readText = read(state.editor.text)
assert<Equal<typeof readText, string>>()
const readLight = read(state.traffic.light)
assert<Equal<typeof readLight, 'red' | 'green' | 'amber'>>()

const all: AnyStateObject[] = [state.editor.text, state.traffic.light, state.account.user]
void all

// ---------------------------------------------------------------------------
// Temporal is not loaded in this project
// ---------------------------------------------------------------------------

// @ts-expect-error purge() comes with soucouyant/temporal
state.editor.text.purge()
// @ts-expect-error trajectory comes with soucouyant/temporal
void state.traffic.light.trajectory
