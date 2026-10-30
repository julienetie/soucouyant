import { assertEquals, assertInstanceOf } from 'jsr:@std/assert'
import { o, pending, empty } from '../src/index.js'
import { areSetsSimilar, republish } from '../src/helpers.js'

const compareMapKeys = (mapA, mapB) => {
  const keysA = JSON.stringify(Array.from(mapA.keys()).sort())
  const keysB = JSON.stringify(Array.from(mapB.keys()).sort())

  return keysA === keysB
}

const compareSets = (setA, setB) => {
  if (setA.size !== setB.size) return false

  for (const element of setA) {
    if (!setB.has(element)) return false
  }

  return true
}

// Example usage remains the same.
Deno.test('o - Should be a function with expected properties', () => {
  assertInstanceOf(o, Function) // Check if o is a function
  assertInstanceOf(o.createChain, Function) // Check if o is a function
  assertEquals(o.chain.name, 'main')
})

Deno.test('o.`stateObject` - should return undefined for malformed namespaces', () => {
  // Cannot use an empty string
  o``
  o`_stateObject`
  o`StateObject`

  const noNamespace = o['']
  const firstCharUnderscore = o._stateObject
  const firstCharUppercase = o.StateObject

  // Cannot use an empty string
  assertEquals(noNamespace, undefined)

  // The address of the main chain cannot begin with an underscore
  assertEquals(firstCharUnderscore, undefined)

  // The address of the main chain cannot begin with an upper-case letter
  assertEquals(firstCharUppercase, undefined)
})

Deno.test('o.`stateObject()` - should set the undefined created default state to pending', () => {
  o`stateObject`()
  const noArg = o.stateObject()

  assertEquals(noArg, pending)
})

Deno.test('o.stateObject1(...)` - should set string', () => {
  o`stateObject1`()
  const defaultState = o.stateObject1()
  assertEquals(defaultState, pending)
  const state = o.stateObject1('string')
  assertEquals(state, 'string')
})

Deno.test('o.stateObject2(...)` - should set null', () => {
  o`stateObject2`()
  const defaultState = o.stateObject2()
  assertEquals(defaultState, pending)
  const state = o.stateObject2(null)
  assertEquals(state === null, true)
})

Deno.test('o.stateObject3(...)` - should set boolean', () => {
  o`stateObject3`()
  const defaultState = o.stateObject3()
  assertEquals(defaultState, pending)
  const state = o.stateObject3(false)
  assertEquals(state, false)
  const state2 = o.stateObject3(true)
  assertEquals(state2, true)
})

Deno.test('o.stateObject4(...)` - should set number', () => {
  o`stateObject4`()
  const defaultState = o.stateObject4()
  assertEquals(defaultState, pending)
  const state = o.stateObject4(NaN)
  assertEquals(state, NaN)
  const state2 = o.stateObject4(12345)
  assertEquals(state2, 12345)

  const state3 = o.stateObject4(0)
  assertEquals(state3, 0)

  const state4 = o.stateObject4(Infinity)
  assertEquals(state4, Infinity)
})

Deno.test('o.stateObject5(...)` - should set bigint', () => {
  o`stateObject5`()
  const defaultState = o.stateObject5()
  assertEquals(defaultState, pending)
  const state = o.stateObject5(0n)
  assertEquals(state, 0n)
  const state2 = o.stateObject5(1234567891234n)
  assertEquals(state2, 1234567891234n)
})

Deno.test('o.stateObject6(...)` - should set pending', () => {
  o`stateObject6`()
  const defaultState = o.stateObject6('string')
  assertEquals(defaultState, 'string')
  const state = o.stateObject6(pending)
  assertEquals(state, pending)
})

Deno.test('o.stateObject.date(...)` - should set date object clone', () => {
  o`stateObject > date`()
  const defaultState = o.stateObject.date()
  assertEquals(defaultState, pending)

  const date = new Date()
  const state = o.stateObject.date(date)

  // The return of setting state is the exact same value of the state given
  // It does not getState after placing it in the store.
  assertEquals(state === date, true)
  assertEquals(state, date)

  const date2 = new Date()
  o.stateObject.date(date2)
  const state2 = o.stateObject.date()

  assertEquals(state2 === date2, false)
  assertEquals(state2, date2)
})

Deno.test('o.stateObject.error(...)` - should set error object clone', () => {
  o`stateObject > error`()
  const defaultState = o.stateObject.error()
  assertEquals(defaultState, pending)

  const error = new TypeError()
  const state = o.stateObject.error(error)

  // The return of setting state is the exact same value of the state given
  // It does not getState after placing it in the store.
  assertEquals(state === error, true)
  assertEquals(state, error)

  const error2 = new TypeError()
  o.stateObject.error(error2)
  const state2 = o.stateObject.error()

  assertEquals(state2 === error2, false)
  assertEquals(state2, error2)
})

Deno.test('o.stateObject.regexp(...)` - should set regexp object clone', () => {
  o`stateObject > regexp`()
  const defaultState = o.stateObject.regexp()
  assertEquals(defaultState, pending)

  const regexp = /test123/
  const state = o.stateObject.regexp(regexp)

  // The return of setting state is the exact same value of the state given
  // It does not getState after placing it in the store.
  assertEquals(state === regexp, true)
  assertEquals(state, regexp)

  const regexp2 = /test123/
  o.stateObject.regexp(regexp2)
  const state2 = o.stateObject.regexp()

  assertEquals(state2 === regexp2, false)
  assertEquals(state2, regexp2)
})

Deno.test('o.stateObject.object(...)` - should set plain object clone', () => {
  o`stateObject > object`()
  const defaultState = o.stateObject.object()
  assertEquals(defaultState, pending)

  const object = { greeting: 'hello world' }
  const state = o.stateObject.object(object)

  // The return of setting state is the exact same value of the state given
  // It does not getState after placing it in the store.
  assertEquals(state === object, true)
  assertEquals(state, object)

  const object2 = { greeting: 'hello world' }
  o.stateObject.object(object2)
  const state2 = o.stateObject.object()

  assertEquals(state2 === object2, false)
  assertEquals(state2, object2)
})

Deno.test('o.stateObject.array(...)` - should set array clone', () => {
  o`stateObject > array`()
  const defaultState = o.stateObject.array()
  assertEquals(defaultState, pending)

  const array = [1, 2, 3, 4]
  const state = o.stateObject.array(array)

  // The return of setting state is the exact same value of the state given
  // It does not getState after placing it in the store.
  assertEquals(state === array, true)
  assertEquals(state, array)

  const array2 = [1, 2, 3, 4]
  o.stateObject.array(array2)
  const state2 = o.stateObject.array()

  assertEquals(state2 === array2, false)
  assertEquals(state2.every((value, i) => value === array2[i]), true)
})
/*
Deno.test('o.stateObject.map(...)` - should set map clone', () => {
  o`stateObject > map`()
  const defaultState = o.stateObject.map()
  assertEquals(defaultState, pending)

  const map = new Map([['a', 1], ['b', 2], [3, 'zap']])
  const state = o.stateObject.map(map)

  // The return of setting state is the exact same value of the state given
  // It does not getState after placing it in the store.
  assertEquals(state === map, true)
  assertEquals(state, map)

  const map2 = new Map([['a', 1], ['c', 2], [3, 'zazzzp']])
  o.stateObject.map(map2)
  const state2 = o.stateObject.map()

  assertEquals(state2 === map2, false)
  assertEquals(compareMapKeys(state2, map2), true)
}) */

/*
Deno.test('o.stateObject.set(...)` - should set clone', () => {
  o`stateObject > set`()
  const defaultState = o.stateObject.set()
  assertEquals(defaultState, pending)

  const set = new Set(['one', 2, 'three', 4])
  const state = o.stateObject.set(set)

  // The return of setting state is the exact same value of the state given
  // It does not getState after placing it in the store.
  assertEquals(state === set, true)
  assertEquals(state, set)

  const set2 = new Set(['onse', 2, 'three', 4])
  o.stateObject.set(set2)
  const state2 = o.stateObject.set()

  assertEquals(state2 === set2, false)
  const areSetsEqual = areSetsSimilar(state2, set2)
  assertEquals(areSetsEqual, true)
}) */

Deno.test('ostateObject.subscription.sub(...) - should subscrbe and action on changes', () => {
  o`stateObject > subscription`()

  o.stateObject.subscription.sub(({ state, idenitity, timestamp, direction }) => {
    assertEquals(state, 'test')
    assertEquals(typeof idenitity, 'number')
    assertEquals(typeof timestamp, 'number')
    assertEquals(direction, 'forward')
  }, 'sub-1')

  o.stateObject.subscription('test')
})

Deno.test('o.stateObject.republish(...) - should republish the last state without changing history', () => {
  o`stateObject > republish`()
  const defaultState = o.stateObject.republish()
  assertEquals(defaultState, pending)

  o.stateObject.republish('Hello World!')
  const state = o.stateObject.republish()
  assertEquals(state, 'Hello World!')

  o.stateObject.republish(republish)
  const state2 = o.stateObject.republish()
  assertEquals(state2, 'Hello World!')

  // Missing subscribe action
})
