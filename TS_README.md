# Soucouyant with TypeScript

Soucouyant is written in JavaScript and ships hand-written type declarations for every import: the core, temporal, the storage adapters and every framework binding. There's nothing extra to install, and you describe your state exactly once: TypeScript infers every type from the object you declare it with.

```ts
import { o, finite } from 'soucouyant'

const state = o({
  editor: { text: '', saved: false },
  traffic: { light: finite('red', ['red', 'green', 'amber']) }
})

state.editor.text('Hello')         // ✓ string
state.editor.text(42)              // ✗ number is not a string
state.traffic.light('blue')        // ✗ not 'red' | 'green' | 'amber'

const light = state.traffic.light() // 'red' | 'green' | 'amber'
```

For everything that isn't about types, see the [README](README.md).

## Contents

- [Requirements](#requirements)
- [Declaring typed state](#declaring-typed-state)
- [How types are inferred](#how-types-are-inferred)
- [Typing o everywhere: Register](#typing-o-everywhere-register)
- [Pending and async state](#pending-and-async-state)
- [Finite states, transitions and keyframes](#finite-states-transitions-and-keyframes)
- [Subscriptions and props](#subscriptions-and-props)
- [Writing generic code](#writing-generic-code)
- [Mutex](#mutex)
- [Temporal](#temporal)
- [Storage adapters](#storage-adapters)
- [Framework bindings](#framework-bindings)
- [Tagged templates](#tagged-templates)
- [Strict compiler options](#strict-compiler-options)
- [Limits](#limits)
- [Exported types](#exported-types)

## Requirements

- **TypeScript 5.0 or later.** The types are tested on every release with TypeScript 5.0, 5.9 and 7.
- **Any module resolution:** `nodenext`/`node16`, `bundler`, and on TypeScript 5.x, `node10`.
- **Framework bindings** need whatever TypeScript their framework needs. Vue 3.5 and Angular 21 need 5.4 or later.

Soucouyant is an ES module package. Imports are the same as in JavaScript:

```ts
import { o } from 'soucouyant'                         // the core
import { o, head, chain } from 'soucouyant/temporal'   // the core plus history
import { useSoucouyant } from 'soucouyant/bindings/react'
```

The JavaScript lives in `dist/js` and the declarations in `dist/ts`, but you never write either path: `package.json` points each import at both.

CommonJS projects can `require('soucouyant')` on Node.js 22.12 and later, which loads ES modules from `require()`, or use `await import('soucouyant')` anywhere.

JavaScript projects get the types too. Editors that understand TypeScript, such as VS Code, use them for completion, and `// @ts-check` checks a JavaScript file against them.

## Declaring typed state

Pass `o()` an object. Plain objects become namespaces, and every other value becomes a stateObject whose type is inferred from it. `o()` returns the declared tree, fully typed:

```ts
import { o, finite, value } from 'soucouyant'

export const state = o({
  editor: {
    text: '',
    cursor: { line: 1, column: 0 }
  },
  cart: { open: false, items: [] as string[] },
  account: { profile: value({ name: 'Ada', role: 'admin' as 'admin' | 'member' }) },
  traffic: { light: finite('red', ['red', 'green', 'amber']) }
})

state.editor.cursor.line()          // number
state.cart.items((items) => [...items, 'sorrel'])
state.account.profile().role        // 'admin' | 'member'
```

At runtime the returned tree is `o` itself, so `state.editor.text` and `o.editor.text` are the same function. Export `state` from one module and import it wherever you need it, or [register the shape](#typing-o-everywhere-register) to type `o` everywhere.

Mistakes `o()` would throw for at runtime are type errors on the offending key:

```ts
o({ config: 1 })                // ✗ reserved on o
o({ group: { scope: 1 } })      // ✗ reserved everywhere
o({ group: { onClick: () => {} } }) // ✗ functions can't be state
o({ group: {} })                // ✗ an empty namespace
```

## How types are inferred

| You declare | The state type is |
| --- | --- |
| `''`, `0`, `false` | `string`, `number`, `boolean`. Literals widen, as with `useState` |
| `null` | `null`. Use `value<Thing \| null>(null)` for something that may be set later |
| `[] as string[]` | `string[]`. A bare `[]` is `never[]`, so give empty arrays a type |
| `['a']`, `new Map<string, number>()`, `new Set<Id>()`, `new Date()` | Their own types: arrays, Maps, Sets, Dates, RegExps, typed arrays and Promises are states |
| `finite('red', ['red', 'green'])` | `'red' \| 'green'`, the states as a union of literals |
| `value({ name: 'Ada' })` | `{ name: string }`: a plain object as a state, not a namespace |
| `value<User \| Pending>(pending)` | `User \| Pending`, exactly as written |
| `undefined` | `unknown`. The stateObject starts `pending`; use `value<T \| Pending>(pending)` to type it |
| A plain object | A namespace of its own entries |

To narrow a type beyond what a value says, write it on the value: `role: 'admin' as 'admin' | 'member'`, or use `value<T>()`.

## Typing o everywhere: Register

`o()` returns typed state. To have `o` itself typed in every module, so `o.editor.text()` is a `string` anywhere, register the object you declare with:

```ts
// state.ts
import { o, finite } from 'soucouyant'

const shape = {
  editor: { text: '', saved: false },
  traffic: { light: finite('red', ['red', 'green', 'amber']) }
}

export const state = o(shape)

declare module 'soucouyant' {
  interface Register {
    shape: typeof shape
  }
}
```

```ts
// toolbar.ts
import { o } from 'soucouyant'

o.editor.saved(true)     // ✓ boolean
o.editor.missing         // ✗ not declared
```

Register `typeof shape`, the object you pass to `o()`, not `typeof state`. The type of `o` depends on `Register`, so `typeof state`, which comes from calling `o`, would refer to itself and TypeScript would reject it. The shape is still written once.

The augmentation applies wherever `state.ts` is part of the program, which it is as soon as anything imports it. Importing from `soucouyant/temporal` works too: it's the same `o`.

With a registered shape, paths outside it are errors. Declare everything in the registered object, or use several objects and register their combined type:

```ts
const shape = { ...editorShape, ...cartShape }
```

## Pending and async state

A stateObject that starts empty and loads later holds `pending` until it's published:

```ts
import { o, value, pending, type Pending } from 'soucouyant'

interface User { id: number, name: string }

const state = o({ session: { user: value<User | Pending>(pending) } })

state.session.user(async () => fetchUser())   // locks until the promise settles

const user = state.session.user()
if (user !== pending) {
  user.name                                    // User
}
```

Publishing `pending` is only allowed when the type includes `Pending`.

## Finite states, transitions and keyframes

`finite()` infers the states as a union of literals. Transition rules are typed against them:

```ts
const state = o({
  traffic: {
    light: finite('red', ['red', 'green', 'amber'], {
      transitions: { red: ['green'], green: ['amber'], amber: ['red'] }
    })
  }
})

finite('purple', ['red', 'green'])                          // ✗ initial state not in the states
finite('a', ['a', 'b'], { transitions: { a: ['c'] } })      // ✗ 'c' isn't a state
finite(1, [1, 2], { transitions: new Map([[1, [2]]]) })     // a Map, for any state type
```

Object keys in transition rules are the states written as strings, which works for strings, numbers, booleans and `null`. For states that are objects, use a `Map`.

**Keyframes** are finite states with timing and an action. The state type comes from each keyframe's `state`, and actions written inline are typed from it. Keyframes may carry fields of their own:

```ts
const state = o({
  sprite: {
    frame: finite('up', [
      { state: 'up', duration: 100, startDelay: 0, endDelay: 0, sound: 'tap', action: (frame, props) => {
        frame                   // 'up' | 'down'
        props.keyframe.sound    // unknown: your own fields
      } },
      { state: 'down', duration: 120, startDelay: 0, endDelay: 10, action: (frame) => {} }
    ])
  }
})

state.sprite.frame('down')        // publish the state, not the keyframe
```

## Subscriptions and props

```ts
import type { Props } from 'soucouyant'

const ref = state.editor.text.sub((text) => {})           // text: string; ref: string
state.editor.text.sub((text, props) => {
  props.rev        // string | undefined: the state subscribers had before
  props.direction  // 'fwd' | 'rev'
})

const named = state.editor.text.sub(render, 'toolbar')    // 'toolbar'
const [forward, back] = state.editor.text.sub(onForward, onBack)
state.editor.text.unsub(ref, named)                       // number removed

const render = (text: string, props: Props<string>) => {}
```

## Writing generic code

Every stateObject is a `StateObject<T>`, so helpers can be generic over the state type:

```ts
import type { StateObject, FiniteStateObject, AnyStateObject, Namespace } from 'soucouyant'

const resetTo = <T>(stateObject: StateObject<T>, initial: T) => stateObject(initial)

resetTo(state.editor.text, '')        // ✓
resetTo(state.editor.text, 0)         // ✗

const all: AnyStateObject[] = [state.editor.text, state.traffic.light]
```

`FiniteStateObject<T>` is a stateObject with finite states, and `Namespace<S>` is the type of a namespace declared with the object `S`.

## Mutex

Release functions are typed by the stateObject they lock:

```ts
import { mutex, republish } from 'soucouyant'

const release = mutex.lock(state.editor.text)
release('saved')              // ✓ string
release((text) => text.trim())
release(republish)
release(42)                   // ✗

const releaseAll = mutex.lock(o)
releaseAll(state.editor.saved, true)
```

## Temporal

Importing `soucouyant/temporal` anywhere in a program does for the types what it does at runtime: every stateObject gains `purge()` and `trailLimit()`, finite ones gain `trajectory`, and `o.config()` accepts the history settings. In a program that never imports temporal, those are type errors, just as they'd throw.

```ts
import { o, head, chain, alias, finite } from 'soucouyant/temporal'

o.config({ persist: true, mergeFidelity: '200ms' })

const state = o({
  editor: { text: '' },
  player: { direction: finite('up', ['up', 'down', 'left', 'right']) }
})

head.seek('rev')                // a step: 'rev', 'fwd', '<3', '>3'
head.seek('2.5s')               // a duration: ms, s, m or h
head.seek(42)                   // a frame index
head.seek('opened')             // an alias

state.editor.text(alias('opened', 'Hello'))

const frames = chain.slice('first', 'present', state.editor.text)   // Frame[]
const removed = chain.purge()                                       // number
chain.trailLimit('30s')
chain.trailLimit('30 seconds')                                      // ✗ not a duration

state.player.direction.trajectory({ order: ['up', 'right', 'down', 'left'], intervals: 250 })
state.player.direction.trajectory({ order: ['up', 'jump'] })        // ✗ 'jump' isn't a state
state.player.direction.trajectory.fwd()                             // 'up' | 'down' | 'left' | 'right'
```

Durations are typed as `` `${number}${'ms' | 's' | 'm' | 'h'}` `` (the `Duration` type). For `intervals` by property name, plain object states allow only their numeric properties; keyframes allow any name, since they may carry fields of their own.

Frames carry the address of their stateObject and an `unknown` state: one chain holds every stateObject's frames.

## Storage adapters

```ts
import { o } from 'soucouyant/temporal'
import { sqliteStorage } from 'soucouyant/storage-sqlite'           // Node
import { indexedDbStorage } from 'soucouyant/storage-indexeddb'     // browsers

o.config({ persist: true, offlineStorage: { mode: 'all', adapter: sqliteStorage({ path: './state.db' }) } })
```

To store frames anywhere else, implement `StorageAdapter`:

```ts
import type { StorageAdapter, StorageBatch, StoredFrame } from 'soucouyant/temporal'

const remoteStorage: StorageAdapter = {
  open: async ({ databaseName, objectStoreName }) => ({ firstIndex: -1, lastIndex: -1 }),
  writeFrames: async (batch: StorageBatch) => {},
  readLatest: async (count) => [],
  readRange: async (from, to) => [],
  deleteBefore: async (index) => {},
  deleteBeforeTime: async (timestamp) => {},
  clear: async () => {},
  close: async () => {}
}
```

The contract is described at the top of `src/temporal/storage.js`.

## Framework bindings

Each binding carries the state type through:

```ts
// React
import { useSoucouyant, useSoucouyantModel } from 'soucouyant/bindings/react'
const text = useSoucouyant(state.editor.text)                  // string
const [typed, setTyped] = useSoucouyantModel(state.editor.text) // [string, (next: string) => void]

// Vue
import { useSoucouyant, useSoucouyantModel } from 'soucouyant/bindings/vue'
const text = useSoucouyant(state.editor.text)        // read-only ref: text.value is a string
const model = useSoucouyantModel(state.editor.text)  // WritableComputedRef<string>, for v-model

// Angular
import { injectSoucouyant } from 'soucouyant/bindings/angular'
readonly light = injectSoucouyant(state.traffic.light)  // Signal<'red' | 'green' | 'amber'>

// Svelte
import { fromSoucouyant, toStore } from 'soucouyant/bindings/svelte'
const text = fromSoucouyant(state.editor.text)       // text.current: string
const light = toStore(state.traffic.light)           // a store of 'red' | 'green' | 'amber'

// Next.js
import { snapshot } from 'soucouyant/bindings/next'                    // server
import { SoucouyantState, type Snapshot } from 'soucouyant/bindings/next/client'
```

## Tagged templates

Tagged declarations work in TypeScript, but TypeScript can't read the text inside a template, so it can't learn the address or the state's type from `` o`editor > text`('') ``. Without a registered shape, `o` then accepts any path and every state is `unknown`:

```ts
o`app > theme`('dark')
const theme = o.app.theme()     // unknown
```

Prefer `o({ ... })` in TypeScript. Both forms build the same tree, so they mix freely, and a tagged declaration's finite states and transition rules are still checked.

## Strict compiler options

The types are tested with `strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess` and `noPropertyAccessFromIndexSignature` on, and `skipLibCheck` off.

Two of those options affect paths that aren't declared with `o({ ... })` or registered. Those paths come from an index signature, so:

- with `noUncheckedIndexedAccess`, an unregistered path such as `o.app.theme` is possibly `undefined`;
- with `noPropertyAccessFromIndexSignature`, it has to be written `o['app']['theme']`.

Typed state, from `o({ ... })` or a registered shape, is unaffected by either.

## Limits

- **Class instances.** At runtime a class instance is a state, but TypeScript can't tell an instance from a plain object. Wrap instances in `value()`: `point: value(new Point(1, 2))`. An instance with methods is a type error until you do; an instance with only data fields would be typed as a namespace.
- **The namespace depth limit** (4 by default, `namespaceDepth`) is a setting, so it's checked at runtime only.
- **Identifier names.** Each name must be a JavaScript identifier. That's checked at runtime; object keys that need quotes aren't identifiers.
- **Frames and snapshots** hold `unknown` states, because one chain holds every stateObject.

## Exported types

From `soucouyant` (and re-exported by `soucouyant/temporal`):

| Type | |
| --- | --- |
| `StateObject<T>`, `FiniteStateObject<T, E>`, `AnyStateObject` | stateObjects |
| `Namespace<S>`, `NodeOf<S>`, `NamespaceMethods` | namespaces declared from an object `S` |
| `O`, `Root`, `Register`, `RegisteredTree`, `UntypedTree` | the type of `o`, and registration |
| `Pending`, `Republish` | the symbol types |
| `Props<T>`, `Subscriber<T>`, `Sub<T>`, `Subscribe<T>`, `SubscriptionRef`, `Direction` | subscriptions |
| `FiniteOptions<T>`, `TransitionRules<T>`, `Keyframe<S>`, `KeyframeProps<S>`, `KeyframeState`, `StateOfEntry<E>` | finite states |
| `FiniteDeclaration<T, E>`, `ValueDeclaration<T>`, `StateLeaf`, `ShapeCheck<S>` | object declarations |
| `ConfigOptions`, `Settings`, `Execution`, `ObserveLevel` | configuration |
| `Mutex`, `Release<T>`, `ReleaseAll`, `BufferedEntry` | the mutex |
| `ScopePath`, `Declare` | `scope()` paths and tagged declarations |

From `soucouyant/temporal`:

| Type | |
| --- | --- |
| `Head`, `HeadMeta`, `HeadPosition`, `Position`, `Duration`, `DurationUnit` | the head and positions |
| `Chain`, `ChainMeta`, `Frame<T>`, `FrameInput`, `StoredFrameSlice` | the chain |
| `Trajectory<T, E>`, `TrajectoryOptions<T, E>`, `TrajectoryDescription<T>`, `Continuation` | trajectories |
| `StorageAdapter`, `StorageBatch`, `StoredFrame`, `StorageOpenOptions`, `StorageOpenResult`, `OfflineStorageOptions`, `OfflineStorageMode` | storage |

The bindings export `SoucouyantRune<T>` and `SoucouyantStore<T>` (Svelte), `Snapshot` and `SoucouyantStateProps` (Next.js), and the storage adapters export their options types.
