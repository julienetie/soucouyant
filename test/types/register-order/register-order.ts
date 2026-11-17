// A registered shape declared after o is already in use in the same file:
// configured first, as history must be, then a shape holding finite()
// states and references to other constants. TypeScript once reported this
// as a circular type, because o.config() as a statement made it resolve
// the whole of o, including the shape below it.
import { o, chain, head, finite, value, pending } from 'soucouyant/polychrony'
import type { Pending, Timeline } from 'soucouyant/polychrony'
import { assert, type Equal } from '../expect.js'

o.config({ persist: true, mergeFidelity: 0 })
chain.trailLimit(4000)
head.seek('present')

const regimes = ['calm', 'volatile', 'crisis'] as const
const opening = 1.08421

const shape = {
  fx: { eurUsd: opening },
  market: {
    regime: finite('calm', regimes, { transitions: { calm: ['volatile'], volatile: ['calm', 'crisis'], crisis: ['volatile'] } }),
    status: finite('open', ['open', 'paused'])
  },
  feed: { quote: value<number | Pending>(pending) }
}

o(shape)

declare module 'soucouyant' {
  interface Register {
    shape: typeof shape
  }
}

const rate = o.fx.eurUsd()
assert<Equal<typeof rate, number>>()
const regime = o.market.regime()
assert<Equal<typeof regime, 'calm' | 'volatile' | 'crisis'>>()
o.market.status('paused')
// @ts-expect-error not one of the states
o.market.status('closed')
// @ts-expect-error not declared
o.fx.missing()

// Timelines take the registered type too
const scenario: Timeline = chain.create('scenario')
const scenarioRate = scenario.fx.eurUsd()
assert<Equal<typeof scenarioRate, number>>()
scenario.config({ mergeFidelity: 0 })
scenario.head.seek('present')
