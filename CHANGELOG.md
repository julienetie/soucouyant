# Changelog

All notable changes are listed here. Soucouyant follows [semantic versioning](https://semver.org); while it's below 1.0, a minor version may break the API.

## Unreleased

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
