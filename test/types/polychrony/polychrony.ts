// Timelines: chain.create(), get(), list(), a timeline's own head and chain,
// typed from the registered shape, and alias() across timelines.
import { o, chain, head, mutex, freeze, alias, finite, value, pending } from 'soucouyant/polychrony'
import type { Timeline, TimelineChain, Pending, Frame, Head } from 'soucouyant/polychrony'
import { assert, type Equal } from '../expect.js'

interface Trade { side: 'buy' | 'sell', amount: number }

const shape = {
  rates: { usdJpy: 150, eurUsd: 1.08 },
  desk: { mode: finite('open', ['open', 'closed']), lastTrade: value<Trade | Pending>(pending) }
}
export const state = o(shape)

declare module 'soucouyant' {
  interface Register {
    shape: typeof shape
  }
}

o.config({ persist: true })

// chain.create() returns a timeline that acts like o
const draft = chain.create('draft', { mergeFidelity: 0 })
assert<Equal<typeof draft, Timeline>>()
const rate = draft.rates.usdJpy()
assert<Equal<typeof rate, number>>()
draft.rates.usdJpy(151)
draft.desk.mode('closed')
draft.desk.lastTrade({ side: 'buy', amount: 10 })
// @ts-expect-error not a number
draft.rates.usdJpy('high')
// @ts-expect-error not a finite state
draft.desk.mode('paused')
// @ts-expect-error not declared
void draft.missing

// Its own head and chain
assert<Equal<typeof draft.head, Head>>()
assert<Equal<typeof draft.chain, TimelineChain>>()
draft.head.seek('rev')
draft.head.seek('first')
const name = draft.chain.name
assert<Equal<typeof name, string>>()
const frames = draft.chain.slice('first', 'present', draft.rates.usdJpy)
assert<Equal<typeof frames, Frame[]>>()
draft.chain.purge('auto')
draft.config({ seekTime: 'epoch' })

// Branching off a branch, finding and listing
const variant = draft.chain.create('variant')
assert<Equal<typeof variant, Timeline>>()
const found = chain.get('draft')
assert<Equal<typeof found, Timeline | undefined>>()
const names = chain.list()
assert<Equal<typeof names, string[]>>()
const deleted = variant.chain.delete()
assert<Equal<typeof deleted, boolean>>()
// @ts-expect-error the main chain can't be deleted
chain.delete()
// @ts-expect-error a name is required
chain.create()
// @ts-expect-error options are o.config() options
chain.create('bad', { colour: 'red' })

// mutex and freeze accept any timeline's stateObjects
const release = mutex.lock(draft.rates.usdJpy)
release(152)
// @ts-expect-error the release function publishes numbers
release('152')
mutex.lock(draft)()
mutex.lock(draft.chain)()
freeze(draft.rates)

// The same stateObject type on every timeline
assert<Equal<typeof draft.rates.usdJpy, typeof o.rates.usdJpy>>()

// alias() from polychrony works on any timeline
draft.rates.usdJpy(alias('checkpoint', 153))
const kept = alias('kept', 'value')
assert<Equal<typeof kept, 'value'>>()

// head and chain are reserved on o
// @ts-expect-error reserved
o({ head: 1 })
// @ts-expect-error reserved
o({ chain: { x: 1 } })

void head
