// Object state under each cloning policy
import { bench, run, summary, do_not_optimize as sink } from 'mitata'
import { o } from '../../src/soucouyant-core.js'

const mode = process.argv[2] ?? 'default'
o.config({ execution: 'sync', development: mode === 'development', clone: mode === 'clone' })
o`profile > user`({ name: 'ada', tags: ['math', 'engines'], visits: 0 })
let i = 0

summary(() => {
  bench(`Soucouyant: publish an object (${mode})`, () => sink(o.profile.user({ name: 'ada', tags: ['math', 'engines'], visits: i++ })))
})

await run()
