import { bench, run, summary, do_not_optimize as sink } from 'mitata'
import { o } from '../../src/soucouyant-core.js'
import { references } from '../libraries.js'

o`app > settings > theme > colour`(1)
const colour = o.app.settings.theme.colour
let floorValue = 1
const floorGet = () => floorValue

summary(() => {
  bench('floor: read a variable through a function', () => sink(floorGet()))
  bench('Soucouyant: o.app.settings.theme.colour()', () => sink(o.app.settings.theme.colour()))
  bench('Soucouyant: cached reference colour()', () => sink(colour()))
  for (const [name, create] of Object.entries(references)) {
    const store = create()
    bench(`${name}: get`, () => sink(store.get()))
  }
})

await run()
floorValue++
