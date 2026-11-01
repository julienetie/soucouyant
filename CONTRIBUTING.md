# Contributing

Don't hesitate, just contribute. Issues, questions and pull requests are all welcome. This page covers the few things that keep the code consistent and fast.

## Setup

```sh
git clone https://github.com/julienetie/soucouyant
cd soucouyant
npm install
npm test
```

You need Node.js 22.5 or later.

## Code style

- [StandardJS](https://standardjs.com): no semicolons unless necessary. `npm run lint` checks it, and `npx standard --fix` fixes most of it.
- Arrow functions. Use a named function only where an arrow can't work.
- No classes, and no `this` unless it can't be avoided.
- Human-readable names. Prefer `stateObject` to `so` and `frameIndex` to `fi`.
- Comments explain why, not what.
- No runtime dependencies. Bindings may import their framework, nothing else.

## Core and temporal

The library ships in two files, and the boundary matters:

- `src/soucouyant-core.js` and everything it imports must never import from `src/temporal/`. An app that only uses the core must not load history code.
- Temporal plugs into the core through the hooks in `src/engine.js` (`registerSettings`, `setRecorder`, `onObjectsGrown` and the rest). Add a hook there rather than importing temporal from the core.

`test/core/core-alone.test.js` checks that history stays out of the core.

## Tests

```sh
npm test                 # test/core alone, test/temporal, then test/core with temporal preloaded
npm run test:dist        # the same against ./dist
npm run test:min         # the same against the .min.js files
npm run test:types       # the TypeScript declarations, after npm run build
npm run test:natives     # V8 checks: hot paths stay optimized and allocate nothing
```

Put a test in `test/core/` if it only needs the core, and in `test/temporal/` if it needs history. Every file runs in its own process, so tests may configure `o` freely.

## Performance

Speed is a feature here, so changes to get, publish, notification or seeking need numbers:

1. Run `npm run bench -- <group>` before and after. The groups are in `bench/groups/`.
2. Run `npm run test:natives`.
3. Put both results in the pull request.

Benchmarks on shared machines are noisy. Run each side a few times and compare the typical result, not the best one.

## Types

The TypeScript declarations are written by hand in `types/`, one `.d.ts` per entry point, and copied to `dist/ts` by the build. When you change a public API, change its declaration in the same pull request.

`npm run build && npm run test:types` compiles the projects in `test/types/` against the built package with TypeScript 5.0, 5.9 and 7, under each module resolution mode. Each project tests both sides: code that should compile, and mistakes marked `// @ts-expect-error` that must not. Add both for a new API. `test/types/temporal/readme.ts` holds the examples from `TS_README.md`.

## Size

`npm run build && npm run size` prints the size of each library file and fails if a minified file goes over its gzip budget in `scripts/size.js`. If a change needs more room, raise the budget in the same pull request and say why.

## Pull requests

- Keep each pull request to one change.
- Update the README when behaviour changes, and add a line under "Unreleased" in `CHANGELOG.md`.
- CI runs lint, every test suite, the type tests, the size check and the V8 checks on Node 22 and 24.
