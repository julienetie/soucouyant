# Changelog

All notable changes are listed here. Soucouyant follows [semantic versioning](https://semver.org); while it's below 1.0, a minor version may break the API.

## Unreleased

### Added

- **Timelines,** in `soucouyant/polychrony`. `chain.create(name)` branches a new timeline off the current one: it starts with the parent's states and recorded history, then moves independently, with its own subscribers, locks, settings, storage and head. Timelines share one shape. `chain.get()`, `chain.list()` and `delete()` manage them, and polychrony's `alias()` works on every timeline. Each timeline runs its own copy of the engine, so the main timeline's code and speed are unchanged.

- **Examples** in `examples/browser-js`: a shop on the core alone, a paint editor with undo history saved to IndexedDB, a keyframe walk cycle where inverted functions undo the world as time runs backwards, and a currency dashboard whose what-if scenarios are timelines. `npm run examples` builds them and serves them with an index page.

### Changed

- `head` and `chain` are now reserved top-level names, because they are a timeline's controls and every timeline shares one shape.

## 0.3.0

### Added

- **TypeScript.** Hand-written declarations for every import: the core, temporal, the storage adapters and every binding. They're tested on TypeScript 5.0, 5.9 and 7 under `nodenext`, `bundler` and `node10` resolution, with every strict option on. See [TS_README.md](TS_README.md).
- **Object declarations for TypeScript.** TypeScript can't read inside a tagged template, so `o({ editor: { text: '' } })` declares an object of stateObjects and types every state from it. `finite()` and `value()` mark finite states and object-valued states. Tagged templates remain the way to declare in JavaScript.
- `Register` types `o` itself from a declared shape, in every module.

### Changed

- The build writes JavaScript to `dist/js` and declarations to `dist/ts`. Imports through the package are unchanged; update any direct `dist/` paths, such as in an import map, to `dist/js/`.

## 0.2.1

### Performance

- A get is about 2.7 times faster: 0.8 ns per read instead of 2.1 ns in a tight loop. Through a cached reference it now costs the same as reading a plain variable, and less than Zustand's `getState()`. Callback publishes are faster too. The API is unchanged.

## 0.2.0

A complete rewrite. Nothing from earlier versions carries over.

npm versions 0.1.0 to 0.1.3 were published in 2018 and later unpublished. npm never allows those numbers again, so the rewrite starts at 0.2.0.

### Added

- Two weights: `soucouyant`, the core, and `soucouyant/temporal`, which adds recorded history. Temporal plugs into the core when imported, and the core never loads history code.
- Core: stateObjects declared with tagged templates, get and publish, subscriptions with props, sync or batched notification, `freeze`, `scope()` in development, and `o.isolate()` for servers.
- Core: finite states with transition rules.
- Core: a per-stateObject mutex with a write buffer, `mutex.lock(o)` to lock every stateObject, and async callbacks that lock until they settle.
- Temporal: the chain, a frame log with merging, trail limits, purge and ignore, and aliases.
- Temporal: the head, which seeks by frame, time or alias. Long jumps cost about the number of stateObjects, not the number of frames.
- Temporal: trajectories, timed sequences through finite states with keyframe actions.
- Temporal: storage adapters for SQLite (Node) and IndexedDB (browsers).
- Bindings for React, Vue, Angular, Svelte and Next.js.
- Builds: plain ES modules in StandardJS style, plus `soucouyant-core.min.js` and `soucouyant-temporal.min.js`.
