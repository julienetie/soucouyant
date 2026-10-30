// Publishing a primitive with no subscribers
import { bench, run, summary, do_not_optimize as sink } from 'mitata'
import { references } from '../libraries.js'

const history = process.argv[2] === 'history'
// Recorded publishing needs temporal; plain publishing runs on core alone
const { o } = await import(history ? '../../src/soucouyant-temporal.js' : '../../src/soucouyant-core.js')
o.config(history ? { execution: 'sync', persist: true, mergeFidelity: 0 } : { execution: 'sync' })
o`counter > value`(0)
const value = o.counter.value
let floorValue = 0
const floorSet = (next) => { floorValue = next }
let i = 0

summary(() => {
  bench('floor: assign a variable through a function', () => floorSet(i++ & 1023))
  bench(`Soucouyant: publish${history ? ' (persist: true, trail wrapping)' : ' (persist: false)'}`, () => sink(value(i++ & 1023)))
  bench(`Soucouyant: publish with a callback${history ? ' (persist: true)' : ''}`, () => sink(value((n) => (n + 1) & 1023)))
  if (!history) {
    for (const [name, create] of Object.entries(references)) {
      const store = create()
      bench(`${name}: set`, () => store.set(i++ & 1023))
    }
  }
})

await run()
sink(floorValue)
