# Changelog

All notable changes are listed here. Soucouyant follows [semantic versioning](https://semver.org); while it's below 1.0, a minor version may break the API.

## Unreleased

### Added

- **TypeScript.** Hand-written declarations for every import: the core, temporal, the storage adapters and every binding. They're tested on TypeScript 5.0, 5.9 and 7 under `nodenext`, `bundler` and `node10` resolution, with every strict option on. See [TS_README.md](TS_README.md).
- **Object declarations.** `o({ editor: { text: '' } })` declares a whole object of stateObjects at once and returns them. In TypeScript, every state is typed from the object, so state is described once. `finite()` and `value()` mark finite states and object-valued states. The whole object is checked before anything is declared.
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
