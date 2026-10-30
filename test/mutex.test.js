import { test } from 'node:test'
import assert from 'node:assert/strict'
import { o, chain, mutex, republish } from '../src/index.js'

o.config({ execution: 'sync' })

const deferred = () => {
  const handle = {}
  handle.promise = new Promise((resolve, reject) => {
    handle.resolve = resolve
    handle.reject = reject
  })
  return handle
}

test('only the release function publishes through a lock; others buffer and replay in order', () => {
  o`profile > name`('ada')
  const release = mutex.lock(o.profile.name)
  assert.equal(o.profile.name('grace'), undefined)
  o.profile.name((name) => name + '!')
  assert.equal(o.profile.name(), 'ada')
  assert.equal(chain.buffer.length, 2)
  assert.deepEqual(chain.buffer.map((entry) => entry.kind), ['value', 'callback'])
  assert.equal(release('hopper'), 'hopper')
  assert.equal(o.profile.name(), 'grace!')
  assert.equal(chain.buffer.length, 0)
  assert.equal(release('late'), undefined)
})

test('locking twice throws; unlock frees a lock without its release function', () => {
  o`locks > value`(0)
  mutex.lock(o.locks.value)
  assert.throws(() => mutex.lock(o.locks.value), /already locked/)
  o.locks.value(1)
  assert.equal(mutex.unlock(o.locks.value), true)
  assert.equal(o.locks.value(), 1)
})

test('release(republish) notifies without recording; release() only unlocks', () => {
  o`again > value`(1)
  const seen = []
  o.again.value.sub((state) => seen.push(state))
  mutex.lock(o.again.value)(republish)
  assert.deepEqual(seen, [1])
  const release = mutex.lock(o.again.value)
  o.again.value(2)
  release()
  assert.deepEqual(seen, [1, 2])
})

test('locking the chain buffers every publish; its release names the target', () => {
  o`whole > a`(0)`whole > b`(0)
  const release = mutex.lock(chain)
  o.whole.a(1)
  o.whole.b(1)
  assert.equal(o.whole.a(), 0)
  release(o.whole.b, 5)
  assert.equal(o.whole.a(), 1)
  assert.equal(o.whole.b(), 1)
  const second = mutex.lock(chain)
  o.whole.a(2)
  second()
  assert.equal(o.whole.a(), 2)
})

test('async callbacks lock until they settle, then publish and drain the buffer', async () => {
  o`cart > items`([])
  const response = deferred()
  const done = o.cart.items(async (items) => [...items, await response.promise])
  o.cart.items((items) => [...items, 'buffered'])
  assert.deepEqual(o.cart.items(), [])
  response.resolve('fetched')
  assert.deepEqual(await done, ['fetched'])
  assert.deepEqual(o.cart.items(), ['fetched', 'buffered'])
})

test('concurrent async read-modify-write loses no updates', async () => {
  o`counter > clicks`(0)
  const increments = []
  for (let i = 0; i < 5; i++) {
    increments.push(o.counter.clicks(async (count) => {
      await new Promise((resolve) => setTimeout(resolve, 1))
      return count + 1
    }))
  }
  await Promise.all(increments)
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(o.counter.clicks(), 5)
})

test('a rejected async callback releases the lock and rejects', async () => {
  o`failing > value`(1)
  const failure = deferred()
  const done = o.failing.value(async () => { await failure.promise })
  o.failing.value(2)
  failure.reject(new Error('network'))
  await assert.rejects(done, /network/)
  assert.equal(o.failing.value(), 2)
})

test('asyncLockTimeout releases a hung lock and discards the late result', async (t) => {
  t.mock.method(console, 'warn', () => {})
  o.config({ asyncLockTimeout: 20 })
  o`slow > value`(0)
  const hung = deferred()
  const done = o.slow.value(async () => hung.promise)
  o.slow.value(1)
  await new Promise((resolve) => setTimeout(resolve, 40))
  assert.equal(o.slow.value(), 1)
  hung.resolve(99)
  assert.equal(await done, undefined)
  assert.equal(o.slow.value(), 1)
  o.config({ asyncLockTimeout: 10000 })
})

test('sync-only rejects async callbacks', () => {
  o.config({ asyncCallbacks: 'sync-only' })
  o`strict > value`(0)
  assert.throws(() => o.strict.value(async () => 1), /sync-only/)
  o.config({ asyncCallbacks: 'lock' })
})
