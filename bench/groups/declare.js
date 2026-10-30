// Declaring stateObjects: a one-off cost, timed directly
import { o } from '../../src/soucouyant-core.js'

const total = 10000
const start = performance.now()
for (let i = 0; i < total; i++) o`area${i % 100} > ${'item' + i}`(i)
const elapsed = performance.now() - start
console.log(`declare ${total.toLocaleString('en')} stateObjects in 100 namespaces: ${elapsed.toFixed(1)} ms (${((elapsed * 1e6) / total).toFixed(0)} ns each)`)
