// 100 publishes in one task then delivery: Soucouyant coalesces to one
// notification per stateObject, the others notify on every set
import { bench, run, summary, do_not_optimize as sink } from 'mitata'
import { o } from '../../src/soucouyant-core.js'
import { references } from '../libraries.js'

o.config({ execution: 'async-queue' })
o`burst > value`(0)
const value = o.burst.value
let total = 0
for (let s = 0; s < 10; s++) value.sub((state) => { total += state })
const settle = () => new Promise((resolve) => queueMicrotask(resolve))

summary(() => {
  bench('Soucouyant: 100 publishes, 10 subscribers, async-queue', async () => {
    for (let n = 0; n < 100; n++) value(n)
    await settle()
  })
  for (const [name, create] of Object.entries(references)) {
    const store = create()
    for (let s = 0; s < 10; s++) store.subscribe((state) => { total += state })
    bench(`${name}: 100 sets, 10 subscribers`, async () => {
      for (let n = 0; n < 100; n++) store.set(n)
      await settle()
    })
  }
})

await run()
sink(total)
