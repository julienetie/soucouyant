// Publish plus synchronous notification of N subscribers
import { bench, run, summary, do_not_optimize as sink } from 'mitata'
import { o } from '../../src/soucouyant-core.js'
import { references } from '../libraries.js'

const count = Number(process.argv[2] ?? 1)
o.config({ execution: 'sync' })
o`signal > value`(0)
const value = o.signal.value
let total = 0
for (let s = 0; s < count; s++) value.sub((state) => { total += state })

const floorSubscribers = []
for (let s = 0; s < count; s++) floorSubscribers.push((state) => { total += state })
let floorValue = 0
const floorPublish = (next) => {
  floorValue = next
  for (let s = 0; s < floorSubscribers.length; s++) floorSubscribers[s](next)
}
let i = 0

summary(() => {
  bench(`floor: assign and call ${count} callback(s)`, () => floorPublish(i++ & 1023))
  bench(`Soucouyant: publish, ${count} subscriber(s), sync`, () => sink(value(i++ & 1023)))
  for (const [name, create] of Object.entries(references)) {
    const store = create()
    for (let s = 0; s < count; s++) store.subscribe((state) => { total += state })
    bench(`${name}: set, ${count} subscriber(s)`, () => store.set(i++ & 1023))
  }
})

await run()
sink(total + floorValue)
