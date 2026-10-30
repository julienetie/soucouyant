import { test } from 'node:test'
import assert from 'node:assert/strict'
import { o } from '../../src/soucouyant-core.js'

o.config({ execution: 'sync' })
o`request > user`('anonymous')`request > items`([])`request > step`('start', ['start', 'end'], { transitions: { start: ['end'], end: [] } })

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

test('each isolated request has its own values, seeded from initial states', async () => {
  const handle = (name, delay) => o.isolate(async () => {
    assert.equal(o.request.user(), 'anonymous')
    o.request.user(name)
    await sleep(delay)
    return o.request.user()
  })
  const results = await Promise.all([handle('ada', 20), handle('grace', 5)])
  assert.deepEqual(results, ['ada', 'grace'])
  assert.equal(o.request.user(), 'anonymous')
})

test('isolated subscribers, validation and async locks', async () => {
  await o.isolate(async () => {
    const seen = []
    const ref = o.request.items.sub((items, props) => seen.push([items.length, props.rev.length]))
    o.request.items((items) => [...items, 1])
    const pendingAdd = o.request.items(async (items) => {
      await sleep(5)
      return [...items, 2]
    })
    o.request.items((items) => [...items, 3])
    await pendingAdd
    assert.deepEqual(o.request.items(), [1, 2, 3])
    assert.deepEqual(seen, [[1, 0], [2, 1], [3, 2]])
    assert.equal(o.request.items.unsub(ref), 1)
    o.request.step('end')
    assert.throws(() => o.request.step('start'), /cannot move/)
  })
  assert.deepEqual(o.request.items(), [])
  assert.equal(o.request.step(), 'start')
})

test('isolate returns the handler result', () => {
  assert.equal(o.isolate(() => 42), 42)
  assert.throws(() => o.isolate(1), TypeError)
})
