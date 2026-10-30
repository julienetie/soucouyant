import { bench, run, summary, do_not_optimize as sink } from 'mitata'
import { o } from '../../src/soucouyant-core.js'

o.config({ execution: 'sync' })
const states = ['idle', 'loading', 'success', 'error']
o`request > status`('idle', states)
o`request > guarded`('idle', states, { transitions: { idle: ['loading'], loading: ['success', 'error'], success: ['idle'], error: ['idle'] } })
const cycle = ['loading', 'success', 'idle']
const allowed = new Set(states)
let floorValue = 'idle'
let i = 0
let guardedStep = 0

summary(() => {
  bench('floor: Set.has then assign', () => {
    const next = cycle[i++ % 3]
    if (allowed.has(next)) floorValue = next
  })
  bench('Soucouyant: finite publish', () => sink(o.request.status(cycle[i++ % 3])))
  bench('Soucouyant: finite publish with transition rules', () => sink(o.request.guarded(cycle[guardedStep++ % 3])))
})

await run()
sink(floorValue)
