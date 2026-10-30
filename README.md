# Soucouyant (Alpha)

<img align="center" src="https://github.com/user-attachments/assets/60e17077-a633-4791-b0b8-59e7c46b962c" width="800">

## Relational State Management

Soucouyant is a JavaScript state management library. It comes in two weights: **core** and **temporal**. For most apps, the core on its own is enough. Temporal adds recorded history, e.g. undo/redo and time travel, and trajectories, e.g. timed animation sequences.

Although Soucouyant is a full featured state management system, please remember there are no brownie points for over-engineering your application. **Respect simplicity as a first principle**.

*Soucouyant is state management with an optional recorded, travelable history. With history on, every publish is a frame on one timeline (the chain), a playhead (the head) moves along it, and subscribers hear about what the head shows.*

- **Get is one field load.** Publishing a primitive allocates nothing.
- **Time travel in production.** Seek by frame, time or alias. Long jumps cost about the number of stateObjects, not the number of frames.
- **Locking.** A per-stateObject mutex with a write buffer, and async callbacks that lock automatically.
- **Finite states with transition rules**, and timed trajectories with keyframe actions.
- **Storage adapters** for SQLite (Node) and IndexedDB (browsers).
- **Bindings** for React, Vue, Angular, Svelte and Next.js.
- **No framework dependency.** It runs in browsers and Node.js 22.5 and later.
- **Two files.** `soucouyant` is the core: state, subscriptions and the mutex. `soucouyant/temporal` adds recorded history, time travel, trajectories and storage. Import temporal only if you need them.

```js
import { o, head, chain, mutex, alias, pending } from 'soucouyant/temporal'

o.config({ persist: true })

o`images > trees > showBaobab`(false)
  `colourPallet > colourChoices`('green', ['red', 'green', 'blue'])

o.images.trees.showBaobab()          // false: get
o.images.trees.showBaobab(true)      // publish a value
o.images.trees.showBaobab((shown) => !shown) // publish from the newest state

o.colourPallet.colourChoices.sub((colour, props) => {
  console.log(colour, props.direction, props.rev)
})

head.seek('rev')                     // undo one frame
head.seek('present')
```

## Contents

- [Imports](#imports)
- [Declaring state](#declaring-state)
- [Get and publish](#get-and-publish)
- [Subscriptions](#subscriptions)
- [Configuration](#configuration)
- [The head](#the-head)
- [The chain](#the-chain)
- [Mutex and async callbacks](#mutex-and-async-callbacks)
- [Finite states and trajectories](#finite-states-and-trajectories)
- [Storage](#storage)
- [Servers: o.isolate()](#servers-oisolate)
- [Framework bindings](#framework-bindings)
- [Devtools](#devtools)
- [Performance](#performance)
- [Changes from the original spec](#changes-from-the-original-spec)
- [Development](#development)

## Imports

| Import                            | Contents                                                             |
| --------------------------------- | -------------------------------------------------------------------- |
| `soucouyant`                      | The core: `o`, `mutex`, `freeze`, `pending`, `republish`             |
| `soucouyant/temporal`             | The core, plus `head`, `chain` and `alias`                           |
| `soucouyant/storage-sqlite`       | `sqliteStorage()` for Node                                           |
| `soucouyant/storage-indexeddb`    | `indexedDbStorage()` for browsers                                    |
| `soucouyant/devtools`             | Not in `dist` yet; import `./src/devtools.js` from a source checkout |
| `soucouyant/bindings/react`       | `useSoucouyant`, `useSoucouyantModel`                                |
| `soucouyant/bindings/vue`         | `useSoucouyant`, `useSoucouyantModel`                                |
| `soucouyant/bindings/angular`     | `injectSoucouyant`                                                   |
| `soucouyant/bindings/svelte`      | `fromSoucouyant`, `toStore`                                          |
| `soucouyant/bindings/next`        | `snapshot()` (server)                                                |
| `soucouyant/bindings/next/client` | `SoucouyantState`, `useSoucouyant`, `useSoucouyantModel`             |

### Core and temporal

The core works on its own. Temporal is built on the core and never the other way round: the core contains no history code, so an app that never imports temporal never loads it.

Temporal plugs itself into the core when it is imported. Both files share one registry, so `o` from either import is the same object, and every stateObject gains `purge()`, `trailLimit()` and, if finite, `trajectory`, including those declared before temporal loaded. Import temporal once, early, in your entry module; every other module can keep importing `soucouyant`.

```js
// main.js
import 'soucouyant/temporal'
import { o } from 'soucouyant'
o.config({ persist: true })
```

Configuring a history setting without temporal throws, naming the import, rather than being silently ignored. Those settings are `persist`, `mergeFidelity`, `offlineStorage`, `seekTime`, `databaseName` and `objectStoreName`.

The Next.js server binding imports temporal itself. The storage adapters import nothing from Soucouyant, but `offlineStorage` is a history setting, so using one needs temporal. The other bindings need only the core.

## Declaring state

```js
o`address`(state, finiteStates?, options?) // returns o, so declarations chain
```

- An address is namespaces then a stateObject name, separated by ` > `. Each part is a JavaScript identifier, and template interpolation works.
- With no state, the initial state is `pending`.
- At most 4 namespaces deep by default (`namespaceDepth`).
- Redeclaring an existing address keeps its state, so hot module reload never throws.
- Reserved names: anything on `Object.prototype` and `scope`. At the top level, also `config`, `isolate`, `name`, `length`, `prototype`, `caller`, `arguments`, `apply`, `call` and `bind`.
- Namespace properties are read-only, so `o.a.b = 1` throws.

```js
freeze(o.one.two.three) // no new children on one, two or three; four stays open
freeze(o)               // no new top-level namespaces
```

`scope(...modulePaths)` limits which modules may use a namespace or stateObject, including everything under it. It is checked only when `development` is on.

```js
o.colourPallet.scope('/interfaces/dashboard.js', '/pallet-selection.js')
```

Each stateObject function has `sub`, `unsub`, `scope`, `purge`, `startTime` and `trailLimit`, plus `trajectory` when it is finite.

V8 keeps up to 1,020 properties per object in its fast layout. In development mode a warning tells you when a namespace passes that, so you can split it.

## Get and publish

```js
so()                         // get: the state at the head
so(value)                    // publish
so((newest) => next)         // publish from the newest recorded state
so((newest) => { use(newest) }) // returns undefined: nothing is published
so(alias('opened', value))   // publish and name the frame
```

- Publishing `undefined` is ignored, and `so(undefined)` reads.
- `NaN` is ignored and reported unless `allowNaN` is set.
- `pending` publishes as a normal frame.
- Any other symbol throws. `republish` works only through a mutex release function.
- Objects are not copied by default: once published, treat them as owned by Soucouyant. `development: true` validates with `structuredClone`, `development: 'freeze'` also deep-freezes, and `clone: true` stores a copy.
- Writes are always synchronous. Only notifications follow `execution`.

## Subscriptions

```js
const ref = so.sub((state) => {})                  // state only, no props object built
so.sub((state, props) => {}, 'my-ref')             // props are built only for 2+ parameters
so.sub.withProps((...args) => {})                  // force props
const [forward, back] = so.sub(proceeding, inverted, 'drive-forward', 'drive-in-reverse')
so.unsub(ref, 'my-ref')                            // returns how many were removed
```

`props` is `{ state, identity, timestamp, fwd, rev, states, finiteIndex, index, timeOffset, direction, pending, alias }`. `rev` is the state the subscribers last received. On reverse travel the inverted callback runs if there is one; otherwise the proceeding callback runs with `direction: 'rev'`. A subscriber that throws is reported, and the others still run.

## Configuration

```js
o.config({
  allowNaN: false,
  namespaceDepth: 4,
  execution: 'async-frame',    // browsers; 'async-queue' is the Node default; or 'sync'
  observe: false,              // 'minimal' | 'moderate' | 'verbose' (with soucouyant/devtools)
  development: false,          // true | 'freeze'
  clone: false,
  asyncCallbacks: 'lock',      // or 'sync-only'
  asyncLockTimeout: 10000,

  // These need soucouyant/temporal
  persist: false,              // true records history (needed for time travel)
  mergeFidelity: '200ms',      // a duration, a frame count, or 0 to record every publish
  offlineStorage: { mode: 'disabled', excessLimit: Infinity, adapter: null },
  seekTime: 'session',         // time strings count from head.startTime(); or 'epoch'
  databaseName: 'soucouyant',
  objectStoreName: 'transient-state'
})
```

- **`sync`** notifies before the outermost publish returns. Publishes made inside a subscriber run after it finishes, never recursively.
- **`async-queue`** (microtask) and **`async-frame`** (animation frame, or a timer while the tab is hidden) coalesce: each changed stateObject is notified once per batch with its latest state.
- **`mergeFidelity`** overwrites a stateObject's last frame instead of adding a new one when it publishes again inside the window.
- **Timestamps** are read once per task, and refreshed every 1,024 frames, because `performance.now()` allocates on every call. The frame index is the unique key; time only orders frames.

## The head

The head, the chain, trajectories and storage need `soucouyant/temporal`.

```js
head.seek('fwd') // also 'rev', '>3', '<3', 'first', 'present'
head.seek(8)          // a frame index
head.seek('2.5s')     // a time: ms, s, m or h, from head.startTime() (or the epoch)
head.seek('opened')   // an alias
head.ignoreFrame('opened')          // skip a frame in time travel
head.ignoreFrame('opened', 'stop')
head.meta()           // { timestamp, index, isHeadPresent, getCurrentFrame }
head.startTime()
```

Publishing never depends on the head. While the head is in the past, new frames are still recorded at the newest end of the chain, `get()` keeps showing the past, and subscribers stay quiet until the head passes the new frames. Callbacks receive the newest recorded state.

With `chain.purge('auto')`, a publish made while the head is in the past first removes the frames ahead of the head, then the head follows the new frame. That is undo/redo. `so.purge('auto')` does the same for one stateObject's own frames, then moves the head to the present.

When old frames leave memory, the state they held becomes the base state. A head parked behind them is pulled forward with notifications, so memory stays bounded.

## The chain

| Method | |
| --- | --- |
| `purge()`, `purge('auto')`, `purge('auto-stop')` | Remove frames ahead of the head |
| `trailLimit(n \| '30s' \| Infinity)` | Frames kept in memory (default 10,000); no argument returns it |
| `autoLimitTail()`, `('idb')`, `('stop')` | Enforce the limit; `'idb'` writes clipped frames to storage first |
| `tailSliceSize(n)`, `requestTailSlice(fn)` | Receive frames in slices before they leave memory |
| `IDBTailSliceSize(n)`, `IDBRequestTailSlice(fn, ...stateObjects)` | The same, for frames leaving storage |
| `expose()`, `validate(chain)`, `replace(chain)` | Copy the chain, check an edited copy, swap it in |
| `find(position)`, `slice(from, to, ...stateObjects)` | Read frames |
| `stateAt(position, ...stateObjects)` | `{ [address]: state }` without moving the head |
| `sub(fn, ref)`, `unsub(...refs)` | Receive arrays of new frames as they are recorded |
| `clear({ storage })` | Drop history; current states become the base |
| `meta()` | Length, index and time bounds, frames in memory and storage, buffer length |
| `restore()`, `restore(from, to)`, `flush()` | Storage (see below) |
| `buffer` | Publishes waiting behind a lock |

A frame is `{ index, timestamp, identity, state, finiteIndex, alias, pending, ignored }`.

## Mutex and async callbacks

```js
const release = mutex.lock(o.user.profile)
const profile = await fetchProfile()
release(profile)   // publishes as the holder, unlocks, then replays buffered publishes in order
// release() only unlocks; release(republish) notifies without recording

const releaseAll = mutex.lock(o)        // buffers every publish
releaseAll(o.user.profile, value)
mutex.unlock(o.user.profile)            // escape hatch
mutex.buffer                            // publishes waiting behind a lock
```

With temporal loaded, `mutex.lock(chain)` and `chain.buffer` are the same lock and buffer as `mutex.lock(o)` and `mutex.buffer`.

- **An async callback locks its stateObject until it settles.** Other publishes queue, and buffered callbacks run later against the then-newest state, so concurrent read-modify-write never loses an update.
- **`asyncLockTimeout`** releases a hung lock and discards the late result.
- **`asyncCallbacks: 'sync-only'`** makes a returned promise throw.

**Choosing sync or async.** Awaiting outside and publishing, or awaiting inside an async callback, record the same frames. The only difference is the lock. Lock when the new state is built from the current state across a wait. Don't lock when the result replaces the state outright, or when the stateObject must keep updating while you wait.

**For animation-heavy apps:** animate with sync publishes or trajectories, fetch with async, never mix both on one stateObject, and move heavy computation to a worker.

## Finite states and trajectories

```js
o`traffic > light`('red', ['red', 'green', 'amber'], {
  transitions: { red: ['green'], green: ['amber'], amber: ['red'] }
})
```

- **Finite states** come from an Array or a Set. Primitives match by value, objects by identity.
- **Transition rules** throw on an illegal move. A state with an empty list is terminal, and a state left out is unrestricted. Time travel ignores the rules.

Finite states and transition rules are core. Trajectories need `soucouyant/temporal`.

```js
o.player.direction.trajectory({ order, continuation: 'loop', intervals: 1000, keyframeActions: false })
o.player.direction.trajectory.fwd()     // also rwd(), play(), pause(), stop(), reverse(), seek(index)
```

- **`continuation`** is `loop`, `rebound`, `end`, `random` or `random-unique` (a shuffle bag).
- **`intervals`** is a number of milliseconds, or the name of a numeric property on each state.
- **Keyframe actions:** when every finite state is a keyframe object `{ state, duration, startDelay, endDelay, action, ...custom }`, publishes use the keyframe's `state`. With `keyframeActions: true`, each keyframe's action runs as it becomes active, with `props.keyframe` set to the keyframe.
- **One scheduler** (a min-heap) drives every trajectory. Due times advance by the interval rather than by "now plus interval", so playback doesn't drift. A hidden tab resumes on the state that should be showing, without a burst of missed steps.

## Storage

```js
import { o, chain } from 'soucouyant/temporal'
import { sqliteStorage } from 'soucouyant/storage-sqlite'
o.config({ persist: true, offlineStorage: { mode: 'all', adapter: sqliteStorage({ path: './state.db' }) } })
await chain.restore()   // load the newest frames and jump to the present
```

- **Modes:** `all` writes every frame; `excess` writes only frames that leave memory; `excessLimit` trims storage.
- **Write-behind:** writes are batched every second or every 512 frames, and on page hide or process exit. `await chain.flush()` writes now.
- **Numbering:** each new session continues numbering after the frames already stored.
- **Declaration frames** are never stored: they come from your code on every run.
- **`chain.restore(from, to)`** loads older frames into memory so `head.seek()` (which stays synchronous) can reach them. Everything from `from` up to the oldest frame in memory is loaded.
- **SQLite** runs `node:sqlite` in a worker thread with WAL and one transaction per batch. Values are stored with `v8.serialize()`.
- **IndexedDB** runs on the main thread.
- **Custom adapters** implement `open`, `writeFrames`, `readLatest`, `readRange`, `deleteBefore`, `deleteBeforeTime`, `clear` and `close`. The contract is described at the top of `src/temporal/storage.js`.

## Servers: o.isolate()

```js
createServer((request, response) => o.isolate(() => handle(request, response)))
```

`o.isolate()` runs each request with its own values, subscribers and async locks, carried across every `await` by `AsyncLocalStorage`. Declarations stay global, and `o` stays one object.

- Isolated subscribers are notified synchronously.
- History, storage, trajectories and `mutex` are process-wide.
- Calls outside `isolate()` use the shared state. Nothing pays for isolation until the first `isolate()` call.

## Framework bindings

| Framework | Minimum version | Use |
| --- | --- | --- |
| React | 19 | `useSoucouyant(so)`; `useSoucouyantModel(so)` for text inputs |
| Vue | 3.5 (3.6 Vapor too) | `useSoucouyant(so)`; `useSoucouyantModel(so)` for `v-model` |
| Angular | 21 | `injectSoucouyant(so)` in an injection context returns a signal |
| Svelte | 5.7 | `fromSoucouyant(so).current`; `toStore(so)` for `$store` |
| Next.js | 16 (App Router) | `snapshot(...)` on the server, `<SoucouyantState snapshot>` on the client |

- Bindings only read; write with `so(value)`.
- The `Model` variants exist because notifications arrive after the keystroke. Without them, a bound input can be reset for a frame and lose its cursor.

## Devtools

```js
import { tree, table } from 'soucouyant/devtools'
o.config({ observe: 'moderate' })
tree(o); table(chain)
```

Without this import, setting `observe` logs one warning, and production bundles carry no logging code.

## Performance

Measured with `npm run bench` on a shared 2-vCPU cloud machine (Intel Xeon, about 2–3 GHz, Node 22). Each group runs in its own process. Read the ratios rather than the absolute times; the absolute numbers will be lower on a desktop. Each **floor** is the barest hand-written JavaScript that does the same job.

| Scenario | Floor | Soucouyant | Legend-State 2.1 | Zustand 5 | Nanostores 1.5 | Redux Toolkit 2 | XState 5 | MobX 7 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Get | 0.5 ns | **1.1 ns** | 466 ns | 0.5 ns | 70 ns | 0.8 ns | 0.5 ns | 3.9 ns |
| Publish a primitive | 1 ns | **17 ns** | 3.4 µs | 83 ns | 49 ns | 1.1 µs | 3.9 µs | 184 ns |
| Publish, 1 subscriber | 9 ns | **37 ns** | 3.3 µs | 121 ns | 146 ns | 2.3 µs | 2.7 µs | 396 ns |
| Publish, 10 subscribers | 110 ns | **171 ns** | 5.2 µs | 307 ns | 398 ns | 2.4 µs | 4.5 µs | 3.1 µs |
| Publish, 100 subscribers | 950 ns | **1.1 µs** | 11 µs | 1.9 µs | 4.0 µs | 4.8 µs | 6.4 µs | 35 µs |
| 100 publishes then delivery, 10 subscribers | | **2.9 µs** | 390 µs | 22 µs | 28 µs | 149 µs | 464 µs | 348 µs |

Notes on the table:

- **Get** through the full path `o.app.settings.theme.colour()` costs the same as through a cached reference: V8 folds the path as constant.
- **Subscriber benchmarks** use `execution: 'sync'`.
- **The batched row** uses `async-queue`, which coalesces a burst into one notification per stateObject. The other libraries notify on every set.

Soucouyant only:

| Scenario | Time |
| --- | --- |
| Recorded publish (`persist: true`, 10,000-frame trail evicting every frame) | 69 ns |
| Finite publish / with transition rules | 29–45 ns / no measurable extra |
| Object publish: default / `development` / `clone` | 40 ns / 2.4 µs / 2.3 µs |
| Seek one frame back and forward | 107 ns |
| Jump across 1,000,000 frames and back, 100 stateObjects | 8 µs |
| Jump to a random frame in 1,000,000 | 6 µs |
| Seek by time string | 3.6 µs |
| Declare a stateObject (10,000 in 100 namespaces) | about 10 µs each |

`npm run test:natives` checks with V8's native syntax that:

- get, publish and callback publish stay optimized;
- namespaces and stateObject functions keep fast properties;
- 5,000,000 primitive publishes with the core alone, and 2,000,000 recorded publishes with the trail wrapping once temporal has loaded, cause zero garbage collections.

How it gets there:

- **Head state:** one `{ value }` cell per stateObject, captured by its function, so a get is one field load.
- **Hot columns:** stateObject columns live in typed arrays indexed by an integer id.
- **The log:** a struct-of-arrays ring buffer. Each stateObject's own history is a linked list threaded through it.
- **Purge and ignore** only set flag bits.
- **Keyframe snapshots** of the registry every 1,024 frames, plus an implicit one just before the oldest frame, bound every jump.
- **Config-time variants:** `o.config()` picks pre-written variants for recording, validation, scheduling and observation, so disabled features cost no branches.
- **Allocation-free dirty tracking:** a bit flag plus a reusable `Int32Array` stack.
- **Times:** stored in a `Float64Array` cell, because doubles in module variables are boxed.
- **Subscriber tables:** created only on first `sub()`.

## Changes from the original spec

The spec, as amended by the design discussion, is the reference. This implementation follows it with these decided changes:

- `stateObject.offset()` and the `offset` prop are removed.
- Subscription callbacks are always `(state, props)`. Props are built when the callback declares two or more parameters (`Function.length` survives minification; parameter names don't).
- Bare numbers in `head.seek()` are frame indices; times are strings with units (`'4786347ms'`).
- `mutex.lock()` returns a release function, and only its holder publishes through the lock.
- WeakSet finite states are dropped.
- Keyframe actions are looked up by finite index, not by function name.
- `chain.IDBTailSliceSize()` is the method name, `trajectory.rwd()` keeps its name, and both purge variants use `'auto-stop'`.
- New: `chain.restore`, `sub`, `unsub`, `slice`, `stateAt`, `clear`, `meta`, `replace`, `flush`; transition rules; `scope()`; `o.isolate()`; `development`, `clone`, `asyncCallbacks`, `asyncLockTimeout`, `seekTime` and `offlineStorage.adapter`.
- The library is two files: the core, and temporal for history, time travel, trajectories and storage. `mutex.lock(o)` and `mutex.buffer` lock and read every stateObject in the core; `mutex.lock(chain)` and `chain.buffer` are aliases for them once temporal is loaded.

## Build

`npm run build` writes one plain ES module per entry point, readable and in StandardJS style, plus minified copies of the two library files:

```
dist/soucouyant-core.js         the core: import maps, browsers and Node
dist/soucouyant-temporal.js     history; imports ./soucouyant-core.js
dist/soucouyant-core.min.js     minified core
dist/soucouyant-temporal.min.js minified temporal; imports ./soucouyant-core.min.js
dist/bindings/<framework>.js    react, vue, angular, svelte, next, next-client
dist/storage/sqlite.js          plus sqlite-worker.js, loaded beside it
dist/storage/indexeddb.js
```

| File | Size | gzip | Brotli |
| --- | --- | --- | --- |
| `soucouyant-core.js` | 58.2 KB | 15.4 KB | 13.4 KB |
| `soucouyant-core.min.js` | 23.8 KB | 8.8 KB | 7.9 KB |
| `soucouyant-temporal.js` | 77.7 KB | 18.2 KB | 15.8 KB |
| `soucouyant-temporal.min.js` | 30.0 KB | 10.9 KB | 9.8 KB |

Each file bundles everything it needs except three kinds of import, which stay imports so an app always has exactly one of each: the framework (`react`, `vue`, `@angular/core`, `svelte/reactivity`), Node built-ins (`node:`), and Soucouyant itself, which bindings import as `../soucouyant-core.js` (the Next.js server binding as `../soucouyant-temporal.js`). There is no module wrapper or runtime helper code. Rollup merges the modules into one scope, keeping their comments, and `scripts/format-dist.js` puts the output in StandardJS style. It runs ESLint with the Standard config directly, because `standard` skips anything in `.gitignore`, which includes `dist/`.

The two library files are built together, so they share one copy of the core. Besides its public exports, `soucouyant-core.js` exports the internal bindings that temporal imports from it. Those extra exports are plumbing, not API; the alternative was a third, shared file.

The minified pair is the same build passed through Terser, with comments removed and the internal exports given short names. Public export names, property names and function parameters are kept. Terser's `reduce_vars` is off: it turned `flushSync()` into a closure created on every sync publish with a subscriber, which made that publish about a third slower. With it off, the minified files benchmark the same as the unminified ones, and `npm run test:min` runs the whole suite against them.

Use the minified files as a pair. `soucouyant-temporal.min.js` imports `soucouyant-core.min.js`, so mixing a minified file with an unminified one loads two copies of the core, each with its own registry. The React, Vue, Angular and Svelte bindings don't import the core, so they work with either pair. The Next.js bindings import the unminified files, which is fine because Next.js bundles and minifies them itself.

In a browser with an import map:

```html
<script type="importmap">
  {
    "imports": {
      "soucouyant": "/dist/soucouyant-core.min.js",
      "soucouyant/temporal": "/dist/soucouyant-temporal.min.js",
      "react": "https://esm.sh/react@19"
    }
  }
</script>
<script type="module">
  import { o, head } from 'soucouyant/temporal'
  import { useSoucouyant } from '/dist/bindings/react.js'
</script>
```

Temporal loads the core by relative URL, so it resolves to the same file as the `soucouyant` mapping. Keep that mapping pointing at the core file next to temporal, not a copy, or the app gets two registries.

## Development

```sh
npm install
npm run build            # ./dist
npm test                 # all three runs below, against ./src
npm run test:core        # test/core: the core alone, temporal never loaded
npm run test:temporal    # test/temporal: history, chain, trajectories, storage, devtools
npm run test:core-with-temporal  # test/core again, with temporal preloaded
npm run test:dist        # build, then all three runs against ./dist
npm run test:min         # build, then all three runs against the .min.js pair
npm run test:natives     # V8 optimization, fast-properties and allocation checks
npm run lint             # StandardJS
npm run bench            # all benchmark groups; npm run bench -- notify for one
```

### What is a Soucouyant?

A soucouyant is a mythical figure from Caribbean folklore.

### Contributing

Don't hesitate just contribute. More guidelines will be introduced overtime.

---

MIT © Julien Etienne 