import { test } from 'node:test'
import assert from 'node:assert/strict'
import { o, pending } from '../../src/soucouyant-core.js'

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

test('sync: every change notifies in order, state only for one-parameter callbacks', () => {
  o.config({ execution: 'sync' })
  o`sync > value`(0)
  const seen = []
  o.sync.value.sub((state, props) => seen.push([state, props]))
  const states = []
  o.sync.value.sub((state) => states.push(state))
  o.sync.value(1)
  o.sync.value(2)
  assert.deepEqual(states, [1, 2])
  assert.equal(seen[1][1].rev, 1)
  assert.equal(seen[1][1].direction, 'fwd')
  assert.equal(seen[1][1].identity, 'sync > value')
})

test('props are built only when a callback declares a second parameter', () => {
  o.config({ execution: 'sync' })
  o`propsCheck > value`(0)
  let received = 'unset'
  o.propsCheck.value.sub((state, props) => { received = props })
  o.propsCheck.value(1)
  assert.equal(typeof received, 'object')
  o`propsCheck > none`(0)
  let none = 'unset'
  o.propsCheck.none.sub(function (state) { none = arguments[1] })
  o.propsCheck.none(1)
  assert.equal(none, undefined)
  o`propsCheck > forced`(0)
  let forced
  o.propsCheck.forced.sub.withProps((...args) => { forced = args[1] })
  o.propsCheck.forced(1)
  assert.equal(forced.state, 1)
})

test('props shape and pending flag', () => {
  o.config({ execution: 'sync' })
  o`propsShape > value`('a', ['a', 'b'])
  let props
  o.propsShape.value.sub((state, p) => { props = p })
  o.propsShape.value('b')
  assert.deepEqual(Object.keys(props), ['state', 'identity', 'timestamp', 'fwd', 'rev', 'states', 'finiteIndex', 'index', 'timeOffset', 'direction', 'pending', 'alias'])
  assert.equal(props.finiteIndex, 1)
  assert.deepEqual(props.states, ['a', 'b'])
  o.propsShape.value(pending)
  assert.equal(props.pending, true)
})

test('async-queue coalesces to the latest state once per batch', async () => {
  o.config({ execution: 'async-queue' })
  o`batched > value`(0)
  const seen = []
  o.batched.value.sub((state, props) => seen.push([state, props.rev]))
  o.batched.value(1)
  o.batched.value(2)
  o.batched.value(3)
  assert.deepEqual(seen, [])
  assert.equal(o.batched.value(), 3)
  await tick()
  assert.deepEqual(seen, [[3, 0]])
})

test('publishes made during a flush go out in the next batch', async () => {
  o.config({ execution: 'async-queue' })
  o`chained > a`(0)`chained > b`(0)
  const order = []
  o.chained.a.sub((state) => {
    order.push(['a', state])
    o.chained.b(state * 10)
  })
  o.chained.b.sub((state) => order.push(['b', state]))
  o.chained.a(1)
  await tick()
  assert.deepEqual(order, [['a', 1], ['b', 10]])
})

test('sync mode runs subscriber publishes to completion without recursion', () => {
  o.config({ execution: 'sync' })
  o`reentry > a`(0)`reentry > b`(0)
  const order = []
  o.reentry.a.sub((state) => {
    order.push(['a start', state])
    o.reentry.b(state + 1)
    order.push(['a end', state])
  })
  o.reentry.b.sub((state) => order.push(['b', state]))
  o.reentry.a(1)
  assert.deepEqual(order, [['a start', 1], ['a end', 1], ['b', 2]])
})

test('a throwing subscriber does not stop the others', (t) => {
  o.config({ execution: 'sync' })
  const errors = t.mock.method(console, 'error', () => {})
  o`throws > value`(0)
  const seen = []
  o.throws.value.sub(() => { throw new Error('boom') })
  o.throws.value.sub((state) => seen.push(state))
  o.throws.value(1)
  assert.deepEqual(seen, [1])
  assert.equal(errors.mock.callCount(), 1)
})

test('refs: generated, explicit, duplicates and unsub', () => {
  o.config({ execution: 'sync' })
  o`refs > value`(0)
  const seen = []
  const generated = o.refs.value.sub((state) => seen.push(['g', state]))
  assert.equal(typeof generated, 'string')
  assert.equal(o.refs.value.sub((state) => seen.push(['e', state]), 'explicit'), 'explicit')
  assert.throws(() => o.refs.value.sub(() => {}, 'explicit'), /already exists/)
  o.refs.value(1)
  assert.equal(o.refs.value.unsub(generated), 1)
  o.refs.value(2)
  assert.deepEqual(seen, [['g', 1], ['e', 1], ['e', 2]])
  assert.equal(o.refs.value.unsub('explicit', 'missing'), 1)
  o.refs.value(3)
  assert.equal(seen.length, 3)
})

test('unsubscribing many keeps order and compacts', () => {
  o.config({ execution: 'sync' })
  o`compact > value`(0)
  const seen = []
  const refs = []
  for (let i = 0; i < 10; i++) refs.push(o.compact.value.sub(() => seen.push(i)))
  o.compact.value.unsub(...refs.slice(0, 7))
  o.compact.value(1)
  assert.deepEqual(seen, [7, 8, 9])
})
