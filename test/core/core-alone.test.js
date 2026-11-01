// What core does without soucouyant-temporal.js loaded
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as core from '../../src/soucouyant-core.js'

const { o } = core
const skip = process.env.SOUCOUYANT_WITH_TEMPORAL === '1' && 'temporal is preloaded'

o.config({ execution: 'sync' })

// The built core file also exports the internal bindings temporal imports,
// so check for the public API and the absence of the history API
test('core exports the public API and no history API', { skip }, () => {
  for (const name of ['finite', 'freeze', 'mutex', 'o', 'pending', 'republish', 'value']) assert.ok(name in core, name)
  for (const name of ['head', 'chain', 'alias']) assert.ok(!(name in core), name)
})

test('history settings explain that temporal is needed', { skip }, () => {
  for (const key of ['persist', 'mergeFidelity', 'offlineStorage', 'seekTime', 'databaseName', 'objectStoreName']) {
    assert.throws(() => o.config({ [key]: true }), /import soucouyant-temporal\.js/)
  }
  assert.throws(() => o.config({ nonsense: 1 }), /Unknown configuration option/)
})

test('stateObjects carry only core methods; finite ones have no trajectory', { skip }, () => {
  o`alone > value`(0)`alone > finite`('a', ['a', 'b'])
  assert.deepEqual(Object.keys(o.alone.value), ['sub', 'unsub', 'scope', 'startTime'])
  assert.equal(o.alone.finite.trajectory, undefined)
})

test('props without history: index -1, no fwd, no alias, publish time', () => {
  o`alone > props`(0)
  let props
  o.alone.props.sub((state, received) => { props = received })
  const before = Date.now()
  o.alone.props(1)
  if (skip) return
  assert.equal(props.index, -1)
  assert.equal(props.fwd, undefined)
  assert.equal(props.alias, null)
  assert.equal(props.rev, 0)
  assert.ok(Math.abs(props.timestamp - before) < 1000)
})
