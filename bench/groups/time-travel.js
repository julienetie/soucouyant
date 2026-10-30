// Time travel over a long history
import { bench, run, summary, do_not_optimize as sink } from 'mitata'
import { o, head, chain } from '../../src/soucouyant-temporal.js'

const frames = Number(process.argv[2] ?? 1000000)
o.config({ execution: 'sync', persist: true, mergeFidelity: 0 })
chain.trailLimit(frames)
for (let id = 0; id < 100; id++) o`travel > ${'object' + id}`(0)
const objects = Object.values(o.travel)
for (let i = 0; i < frames; i++) objects[i % 100](i)
const first = chain.meta().firstIndex
const last = chain.meta().lastIndex
const sorted = new Float64Array(frames)
for (let i = 0; i < frames; i++) sorted[i] = i * 1.5

const floorSearch = (target) => {
  let low = 0
  let high = sorted.length - 1
  while (low < high) {
    const middle = (low + high + 1) >> 1
    if (sorted[middle] <= target) low = middle
    else high = middle - 1
  }
  return low
}
let t = 0

summary(() => {
  bench('Soucouyant: seek rev then fwd (one frame each way)', () => {
    head.seek('rev')
    head.seek('fwd')
  })
  bench(`Soucouyant: jump across ${frames.toLocaleString('en')} frames and back (100 stateObjects)`, () => {
    head.seek(first)
    head.seek(last)
  })
  bench(`Soucouyant: jump to a random frame in ${frames.toLocaleString('en')}`, () => {
    head.seek(first + ((t = (t + 7919) % frames)))
  })
  bench('floor: binary search over a Float64Array', () => sink(floorSearch((t = (t + 7919) % frames) * 1.5)))
  bench('Soucouyant: seek by time string', () => head.seek(`${(t = (t + 7919) % 1000)}ms`))
})

await run()
