// Copies the hand-written type declarations in ./types to ./dist/ts, next to
// the JavaScript in ./dist/js they describe. package.json points each import
// at both: "types" for TypeScript, "default" for everything else.
import { cp } from 'node:fs/promises'

await cp(new URL('../types/', import.meta.url), new URL('../dist/ts/', import.meta.url), { recursive: true })
