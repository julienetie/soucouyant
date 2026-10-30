import { test } from 'node:test'
import assert from 'node:assert/strict'
import { o, freeze, pending } from '../../src/soucouyant-core.js'

o.config({ execution: 'sync' })

test('declares namespaces and stateObjects, chainable', () => {
  o`images > trees > showBaobab`(false)`images > trees > dragonBloodUrl`()
  assert.equal(typeof o.images, 'object')
  assert.equal(typeof o.images.trees.showBaobab, 'function')
  assert.equal(o.images.trees.showBaobab(), false)
  assert.equal(o.images.trees.dragonBloodUrl(), pending)
})

test('interpolated addresses', () => {
  const name = 'colour'
  o`octopodes > caribbeanReef > ${name}`('aquamarine')
  assert.equal(o.octopodes.caribbeanReef.colour(), 'aquamarine')
})

test('namespace properties are read-only and non-configurable', () => {
  o`locked > value`(1)
  assert.throws(() => { o.locked.value = () => 2 }, TypeError)
  assert.throws(() => { delete o.locked.value }, TypeError)
  assert.throws(() => { o.locked = {} }, TypeError)
})

test('redeclaring keeps the existing state', () => {
  o`hot > reload`(1)
  o.hot.reload(5)
  o`hot > reload`(1)
  assert.equal(o.hot.reload(), 5)
})

test('namespace and stateObject clashes throw', () => {
  o`clash > leaf`(1)
  assert.throws(() => o`clash > leaf > deeper`(1), /stateObject, not a namespace/)
  assert.throws(() => o`clash`(1), /namespace, not a stateObject/)
})

test('reserved and invalid names throw', () => {
  assert.throws(() => o`config`(1), /reserved/)
  assert.throws(() => o`a1 > toString`(1), /reserved/)
  assert.throws(() => o`a2 > scope`(1), /reserved/)
  assert.throws(() => o`bad name`(1), /not a valid address/)
  assert.throws(() => o`a3 > `(1), /not a valid address/)
})

test('depth limit and override', () => {
  assert.throws(() => o`d1 > d2 > d3 > d4 > d5 > leaf`(1), /namespaces deep/)
  o.config({ namespaceDepth: 5 })
  o`d1 > d2 > d3 > d4 > d5 > leaf`(1)
  assert.equal(o.d1.d2.d3.d4.d5.leaf(), 1)
  o.config({ namespaceDepth: 4 })
})

test('invalid initial states throw', () => {
  assert.throws(() => o`init > nan`(NaN), /NaN/)
  assert.throws(() => o`init > fn`(() => 1), /function/)
  assert.throws(() => o`init > sym`(Symbol('x')), /Symbols/)
})

test('freeze stops new children on the target and its ancestors, not o', () => {
  o`one > two > three > four > greeting`('hi')
  freeze(o.one.two.three)
  assert.throws(() => o`one > two > three > other`(1), /frozen/)
  assert.throws(() => o`one > extra`(1), /frozen/)
  o`one > two > three > four > farewell`('bye')
  assert.equal(o.one.two.three.four.farewell(), 'bye')
  o`notFrozen`(1)
  assert.equal(o.notFrozen(), 1)
})

test('stateObjects share one property layout', () => {
  o`shape > a`(1)`shape > b`('x')
  assert.deepEqual(Object.keys(o.shape.a), Object.keys(o.shape.b))
  const methods = ['sub', 'unsub', 'scope', 'startTime']
  const expected = process.env.SOUCOUYANT_WITH_TEMPORAL === '1' ? [...methods, 'purge', 'trailLimit'] : methods
  assert.deepEqual(Object.keys(o.shape.a), expected)
  assert.equal(typeof o.shape.a.startTime(), 'number')
})

test('scope is only enforced in development', () => {
  o`scoped > secret`(1)
  o.scoped.scope('/somewhere-else.js')
  assert.equal(o.scoped.secret(), 1)
  o.config({ development: true })
  assert.throws(() => o.scoped.secret(), /is scoped to \/somewhere-else\.js/)
  o.scoped.secret.scope('/declare.test.js')
  assert.equal(o.scoped.secret(), 1)
  assert.throws(() => o.scoped.scope('no-slash.js'), /start with '\/'/)
  o.config({ development: false })
})

test('freeze o last: no more top-level namespaces', () => {
  freeze(o)
  assert.throws(() => o`brandNew`(1), /frozen/)
  o`images > trees > newTree`(1)
  assert.equal(o.images.trees.newTree(), 1)
})
