// npm run build: plain ES modules, one per entry point, in ./dist/js. The
// type declarations in ./types are copied to ./dist/ts by scripts/build-types.js.
//
// soucouyant-core.js and soucouyant-temporal.js are built together. Temporal
// imports core, so every module they share lands in soucouyant-core.js and
// temporal imports it from there: two files, one copy of the core.
// Bindings and storage adapters bundle everything they need except the
// framework, Node built-ins and Soucouyant itself, which stay imports so an
// app always has exactly one of each.

import { fileURLToPath } from 'node:url'
import terser from '@rollup/plugin-terser'

const source = (path) => fileURLToPath(new URL(`./src/${path}`, import.meta.url))
const core = source('soucouyant-core.js')
const temporal = source('soucouyant-temporal.js')
const polychrony = source('soucouyant-polychrony.js')

const frameworks = ['react', 'vue', '@angular/core', 'svelte', 'svelte/reactivity']
const isExternal = (id) => frameworks.includes(id) || id.startsWith('node:') || id === core || id === temporal

// Rollup strips module-level directives; Next.js needs 'use client' kept
const onwarn = (warning, warn) => {
  if (warning.code !== 'MODULE_LEVEL_DIRECTIVE') warn(warning)
}

const library = {
  // Polychrony imports temporal, which imports core, so each file holds only
  // its own modules. Polychrony also carries the timeline factory that
  // scripts/build-instance.js generates: a separate copy of core and temporal
  input: { 'soucouyant-core': core, 'soucouyant-temporal': temporal, 'soucouyant-polychrony': polychrony },
  external: (id) => frameworks.includes(id) || id.startsWith('node:'),
  onwarn,
  // Lets soucouyant-core.js also export the bindings temporal imports, rather
  // than splitting them into a third, shared file
  preserveEntrySignatures: 'allow-extension',
  output: [
    {
      dir: 'dist/js',
      format: 'es',
      entryFileNames: '[name].js',
      // Keep real names on the bindings temporal imports from core
      minifyInternalExports: false
    },
    {
      // soucouyant-core.min.js and soucouyant-temporal.min.js: temporal.min
      // imports core.min, so the pair still shares one copy of the core
      dir: 'dist/js',
      format: 'es',
      entryFileNames: '[name].min.js',
      // The bindings temporal imports from core get short names; the public
      // exports keep theirs
      minifyInternalExports: true,
      plugins: [terser({
        module: true,
        ecma: 2020,
        // reduce_vars is off because it inlines functions called from one
        // place as a closure created on every call: settleSync() wrapping
        // flushSync() made a sync publish with a subscriber about a third slower.
        // Turning it off costs about 450 bytes, and V8 folds the constants it
        // would have inlined anyway. Terser's defaults keep function
        // parameters and property names
        compress: { passes: 2, reduce_vars: false },
        format: { comments: false }
      })]
    }
  ]
}

const entry = (input, file, extra = {}) => ({
  input: source(input),
  external: isExternal,
  onwarn,
  output: {
    file: `dist/js/${file}`,
    format: 'es',
    paths: { [core]: '../soucouyant-core.js', [temporal]: '../soucouyant-temporal.js' },
    ...extra
  }
})

export default [
  library,
  entry('bindings/react.js', 'bindings/react.js'),
  entry('bindings/vue.js', 'bindings/vue.js'),
  entry('bindings/angular.js', 'bindings/angular.js'),
  entry('bindings/svelte.js', 'bindings/svelte.js'),
  entry('bindings/next.js', 'bindings/next.js'),
  entry('bindings/next-client.js', 'bindings/next-client.js', { banner: '\'use client\'' }),
  entry('storage/sqlite.js', 'storage/sqlite.js'),
  entry('storage/sqlite-worker.js', 'storage/sqlite-worker.js'),
  entry('storage/indexeddb.js', 'storage/indexeddb.js')
]
