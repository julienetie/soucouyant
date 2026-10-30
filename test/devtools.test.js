import { test } from 'node:test'
import assert from 'node:assert/strict'
import { o, chain } from '../src/index.js'
import { tree, table } from '../src/devtools.js'

// Devtools is not part of ./dist yet
const skip = process.env.SOUCOUYANT_DIST === '1' && 'devtools is not built into dist'

test('observe logs by level', { skip }, (t) => {
  const logs = t.mock.method(console, 'log', () => {})
  o.config({ execution: 'sync', persist: true, observe: 'minimal' })
  o`watched > value`(0)
  o.watched.value(1)
  assert.ok(logs.mock.calls.some((call) => call.arguments.includes('stateChange')))
  const before = logs.mock.callCount()
  o.watched.value(undefined)
  assert.equal(logs.mock.callCount(), before)
  o.config({ observe: false })
  o.watched.value(2)
  assert.equal(logs.mock.callCount(), before)
})

test('tree and table print o, namespaces, stateObjects, trajectories and chain', { skip }, (t) => {
  const groups = t.mock.method(console, 'group', () => {})
  t.mock.method(console, 'groupEnd', () => {})
  t.mock.method(console, 'log', () => {})
  const tables = t.mock.method(console, 'table', () => {})
  o`printed > colour`('red', ['red', 'blue'])
  o.printed.colour.trajectory({})
  tree(o)
  tree(o.printed)
  tree(o.printed.colour)
  tree(o.printed.colour.trajectory)
  tree(chain)
  table(o)
  table(o.printed.colour)
  table(o.printed.colour.trajectory)
  table(chain)
  assert.ok(groups.mock.callCount() >= 5)
  assert.equal(tables.mock.callCount(), 4)
  assert.throws(() => tree({}), TypeError)
})
