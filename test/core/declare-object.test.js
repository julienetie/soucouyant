import { test } from 'node:test'
import assert from 'node:assert/strict'
import { o, freeze, finite, value, pending } from '../../src/soucouyant-core.js'

o.config({ execution: 'sync' })

test('o({ ... }) declares namespaces and stateObjects and returns o', () => {
  const returned = o({
    editor: { text: '', cursor: { line: 1, column: 0 } },
    online: true
  })
  assert.equal(returned, o)
  assert.equal(o.editor.text(), '')
  assert.equal(o.editor.cursor.line(), 1)
  assert.equal(o.online(), true)
  o.editor.text('Hello')
  assert.equal(o.editor.text(), 'Hello')
})

test('object declarations and tagged templates build the same tree', () => {
  o({ mixed: { fromObject: 1 } })
  o`mixed > fromTemplate`(2)
  assert.equal(o.mixed.fromObject(), 1)
  assert.equal(o.mixed.fromTemplate(), 2)
  assert.throws(() => { o.mixed.fromObject = () => 3 }, TypeError)
})

test('leaves: arrays, Maps, Sets, Dates, class instances, null and undefined', () => {
  class Point {
    constructor (x) { this.x = x }
  }
  const point = new Point(3)
  const when = new Date(0)
  o({
    leaves: {
      list: ['a'],
      lookup: new Map([['k', 1]]),
      tags: new Set(['x']),
      when,
      point,
      nothing: null,
      later: undefined
    }
  })
  assert.deepEqual(o.leaves.list(), ['a'])
  assert.equal(o.leaves.lookup().get('k'), 1)
  assert.equal(o.leaves.tags().has('x'), true)
  assert.equal(o.leaves.when(), when)
  assert.equal(o.leaves.point(), point)
  assert.equal(o.leaves.nothing(), null)
  assert.equal(o.leaves.later(), pending)
})

test('value() makes a plain object a state instead of a namespace', () => {
  o({ account: { profile: value({ name: 'Ada' }), settings: { theme: 'dark' } } })
  assert.deepEqual(o.account.profile(), { name: 'Ada' })
  assert.equal(typeof o.account.settings, 'object')
  assert.equal(o.account.settings.theme(), 'dark')
  assert.equal(o.account.profile.sub !== undefined, true)
})

test('value() of null or undefined', () => {
  o({ maybe: { empty: value(null), unknown: value(undefined) } })
  assert.equal(o.maybe.empty(), null)
  assert.equal(o.maybe.unknown(), pending)
})

test('finite() declares finite states with transition rules', () => {
  o({
    traffic: {
      light: finite('red', ['red', 'green', 'amber'], { transitions: { red: ['green'], green: ['amber'], amber: ['red'] } }),
      size: finite(1, new Set([1, 2, 3]))
    }
  })
  assert.equal(o.traffic.light(), 'red')
  o.traffic.light('green')
  assert.throws(() => o.traffic.light('red'), /cannot move from green to red/)
  assert.throws(() => o.traffic.light('blue'), /not one of the finite states/)
  o.traffic.size(3)
  assert.equal(o.traffic.size(), 3)
})

test('finite() without an initial state starts pending', () => {
  o({ waiting: { phase: finite(undefined, ['a', 'b']) } })
  assert.equal(o.waiting.phase(), pending)
})

test('finite() checks its states argument', () => {
  assert.throws(() => finite('a', 'abc'), /Array or a Set/)
})

test('markers are frozen and never read as namespaces', () => {
  assert.equal(Object.isFrozen(value({})), true)
  assert.equal(Object.isFrozen(finite('a', ['a'])), true)
  o({ marked: { empty: value({}) } })
  assert.deepEqual(o.marked.empty(), {})
})

test('null-prototype objects are namespaces too', () => {
  const shape = Object.create(null)
  shape.bare = 1
  o({ nullProto: shape })
  assert.equal(o.nullProto.bare(), 1)
})

test('redeclaring keeps existing state, and new names are added', () => {
  o({ reload: { count: 1 } })
  o.reload.count(5)
  o({ reload: { count: 1, added: 'new' } })
  assert.equal(o.reload.count(), 5)
  assert.equal(o.reload.added(), 'new')
})

// A failed declaration must leave nothing half-declared
const assertNothingDeclared = (name) => assert.equal(Object.hasOwn(o, name), false)

test('empty objects throw', () => {
  assert.throws(() => o({}), /at least one stateObject/)
  assert.throws(() => o({ hollow: { inner: {} } }), /hollow > inner is an empty namespace/)
  assertNothingDeclared('hollow')
})

test('invalid and reserved names throw before anything is declared', () => {
  assert.throws(() => o({ badNames: { ok: 1, 'not valid': 2 } }), /not a valid address/)
  assertNothingDeclared('badNames')
  assert.throws(() => o({ config: 1 }), /reserved/)
  assert.throws(() => o({ reservedInside: { ok: 1, scope: 2 } }), /reserved/)
  assertNothingDeclared('reservedInside')
})

test('invalid leaves throw before anything is declared', () => {
  assert.throws(() => o({ withFunction: { ok: 1, handler: () => {} } }), /cannot be a function/)
  assertNothingDeclared('withFunction')
  assert.throws(() => o({ withNaN: { ok: 1, bad: NaN } }), /cannot be NaN/)
  assertNothingDeclared('withNaN')
  assert.throws(() => o({ withFinite: { ok: 1, light: finite('blue', ['red']) } }), /not one of its finite states/)
  assertNothingDeclared('withFinite')
})

test('clashes with existing state throw before anything is declared', () => {
  o`existing > leaf`(1)
  assert.throws(() => o({ existing: { other: 1, leaf: { deeper: 1 } } }), /existing > leaf is a stateObject, not a namespace/)
  assert.equal(Object.hasOwn(o.existing, 'other'), false)
  assert.throws(() => o({ existing: 1 }), /existing is a namespace, not a stateObject/)
})

test('the namespace depth limit applies', () => {
  assert.throws(() => o({ a1: { a2: { a3: { a4: { a5: { leaf: 1 } } } } } }), /namespaces deep/)
  assertNothingDeclared('a1')
  o({ b1: { b2: { b3: { b4: { leaf: 1 } } } } })
  assert.equal(o.b1.b2.b3.b4.leaf(), 1)
})

test('frozen namespaces reject new names', () => {
  o({ sealed: { kept: 1 } })
  freeze(o.sealed)
  assert.throws(() => o({ sealed: { kept: 1, extra: 2 } }), /frozen/)
  o({ sealed: { kept: 1 } })
  assert.equal(o.sealed.kept(), 1)
})

test('o() rejects anything but a tag call or a plain object', () => {
  assert.throws(() => o('text'), /o is a tag/)
  assert.throws(() => o([1]), /o is a tag/)
})
