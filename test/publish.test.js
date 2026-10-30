import { test } from 'node:test'
import assert from 'node:assert/strict'
import { o, pending, republish } from '../src/index.js'

o.config({ execution: 'sync' })

test('get and publish values and callbacks', () => {
  o`counter > value`(0)
  assert.equal(o.counter.value(1), 1)
  assert.equal(o.counter.value(), 1)
  assert.equal(o.counter.value((state) => state + 10), 11)
  assert.equal(o.counter.value(), 11)
})

test('callbacks returning undefined do not publish', () => {
  o`voidCall > value`(3)
  let seen
  assert.equal(o.voidCall.value((state) => { seen = state }), undefined)
  assert.equal(seen, 3)
  assert.equal(o.voidCall.value(), 3)
})

test('undefined is ignored; so(undefined) reads', () => {
  o`ignored > value`(4)
  assert.equal(o.ignored.value(undefined), 4)
  assert.equal(o.ignored.value(), 4)
})

test('NaN is ignored and reported unless allowNaN', (t) => {
  o`nan > value`(1)
  const errors = t.mock.method(console, 'error', () => {})
  assert.equal(o.nan.value(NaN), undefined)
  assert.equal(o.nan.value(), 1)
  assert.equal(errors.mock.callCount(), 1)
  o.config({ allowNaN: true })
  assert.ok(Number.isNaN(o.nan.value(NaN)))
  o.config({ allowNaN: false })
})

test('symbols: pending publishes, republish and others throw', () => {
  o`symbols > value`(1)
  assert.equal(o.symbols.value(pending), pending)
  assert.throws(() => o.symbols.value(republish), /mutex release/)
  assert.throws(() => o.symbols.value(Symbol('x')), /Symbols/)
})

test('finite states from arrays and sets', () => {
  o`colourPallet > choices`('green', ['red', 'green', 'blue'])
  o`colourPallet > fromSet`('lime', new Set(['peachpuff', 'crimson', 'lime']))
  o`colourPallet > later`(pending, ['a', 'b'])
  o.colourPallet.choices('blue')
  assert.throws(() => o.colourPallet.choices('purple'), TypeError)
  assert.equal(o.colourPallet.choices(), 'blue')
  assert.equal(o.colourPallet.fromSet(), 'lime')
  assert.equal(o.colourPallet.later(), pending)
  o.colourPallet.later('b')
  assert.equal(o.colourPallet.later(), 'b')
  assert.throws(() => o`colourPallet > bad`('x', ['a']), /not one of its finite states/)
  assert.throws(() => o`colourPallet > dup`('a', ['a', 'a']), /duplicate/)
  assert.throws(() => o`colourPallet > weak`({}, new WeakSet()), /WeakSet/)
})

test('finite object states match by identity and keep the set reference', () => {
  const small = { size: 1 }
  const large = { size: 2 }
  o`sizes > current`(small, [small, large])
  o.sizes.current(large)
  assert.equal(o.sizes.current(), large)
  assert.throws(() => o.sizes.current({ size: 2 }), TypeError)
})

test('transition rules', () => {
  o`traffic > light`('red', ['red', 'green', 'amber'], {
    transitions: { red: ['green'], green: ['amber'], amber: ['red'] }
  })
  assert.throws(() => o.traffic.light('amber'), /cannot move from red to amber/)
  o.traffic.light('red')
  o.traffic.light('green')
  o.traffic.light('amber')
  o.traffic.light('red')
  assert.equal(o.traffic.light(), 'red')
})

test('terminal and unlisted transition states', () => {
  o`job > status`('idle', ['idle', 'running', 'done', 'failed'], {
    transitions: new Map([['running', ['done', 'failed']], ['done', []]])
  })
  o.job.status('running')
  o.job.status('done')
  assert.throws(() => o.job.status('idle'), /cannot move/)
  o`numbers > step`(1, [1, 2, 3], { transitions: { 1: [2], 2: [3] } })
  o.numbers.step(2)
  assert.throws(() => o.numbers.step(1), /cannot move/)
})

test('development mode validates structure; clone mode copies', () => {
  o`objects > plain`({ a: 1 })
  o.config({ development: true })
  assert.throws(() => o.objects.plain({ fn: () => 1 }), /could not be cloned/)
  o.config({ development: false, clone: true })
  const input = { a: 2 }
  o.objects.plain(input)
  assert.notEqual(o.objects.plain(), input)
  assert.deepEqual(o.objects.plain(), input)
  o.config({ clone: false })
  const owned = { a: 3 }
  o.objects.plain(owned)
  assert.equal(o.objects.plain(), owned)
})

test('development freeze mode deep-freezes objects', () => {
  o`objects > frozen`({ a: { b: 1 } })
  o.config({ development: 'freeze' })
  const value = { a: { b: 2 } }
  o.objects.frozen(value)
  assert.ok(Object.isFrozen(value.a))
  o.config({ development: false })
})

test('unknown config options throw', () => {
  assert.throws(() => o.config({ nope: 1 }), /Unknown configuration option/)
  assert.throws(() => o.config({ execution: 'later' }), /execution must be/)
  assert.throws(() => o.config({ mergeFidelity: 'soon' }), /mergeFidelity/)
})
