import { test } from 'node:test'
import assert from 'node:assert/strict'
import { o, chain, head, mutex, freeze, alias, pending } from '../../src/soucouyant-polychrony.js'

o.config({ execution: 'sync', persist: true, mergeFidelity: 0 })

o`rates > usdJpy`(150)`rates > eurUsd`(1.08)
o`traffic > light`('red', ['red', 'green', 'amber'], { transitions: { red: ['green'], green: ['amber'], amber: ['red'] } })
o.rates.usdJpy(151)
o.rates.usdJpy(152)

// Each test uses its own timeline names, so tests stay independent
let counter = 0
const fresh = (options) => chain.create(`timeline-${counter++}`, options)

test('a timeline starts with the parent\'s states and acts like o', () => {
  const timeline = fresh()
  assert.equal(timeline.rates.usdJpy(), 152)
  assert.equal(timeline.rates.eurUsd(), 1.08)
  assert.equal(typeof timeline.rates.usdJpy.sub, 'function')
  assert.equal(typeof timeline.config, 'function')
  assert.equal(timeline.head.meta().isHeadPresent, true)
  assert.notEqual(timeline, o)
  assert.notEqual(timeline.rates.usdJpy, o.rates.usdJpy)
})

test('timelines move independently', () => {
  const timeline = fresh()
  timeline.rates.usdJpy(149)
  assert.equal(timeline.rates.usdJpy(), 149)
  assert.equal(o.rates.usdJpy(), 152)
  o.rates.eurUsd(1.1)
  assert.equal(timeline.rates.eurUsd(), 1.08)
  o.rates.eurUsd(1.08)
})

test('subscribers hear only their own timeline', () => {
  const timeline = fresh()
  const heardOnTimeline = []
  const heardOnMain = []
  timeline.rates.usdJpy.sub((state) => heardOnTimeline.push(state))
  const ref = o.rates.usdJpy.sub((state) => heardOnMain.push(state))
  timeline.rates.usdJpy(140)
  o.rates.usdJpy(153)
  assert.deepEqual(heardOnTimeline, [140])
  assert.deepEqual(heardOnMain, [153])
  o.rates.usdJpy.unsub(ref)
  o.rates.usdJpy(152)
})

test('each timeline has its own head, and reaches back into the shared past', () => {
  const timeline = fresh()
  timeline.rates.usdJpy(148)
  timeline.head.seek('rev')
  assert.equal(timeline.rates.usdJpy(), 152)
  assert.equal(head.meta().isHeadPresent, true)
  timeline.head.seek('first')
  assert.equal(timeline.rates.usdJpy(), 150)
  assert.equal(o.rates.usdJpy(), 152)
  timeline.head.seek('present')
  assert.equal(timeline.rates.usdJpy(), 148)
})

test('frames before the branch are shared: same indices, same states', () => {
  const timeline = fresh()
  const mainFrames = chain.expose()
  const timelineFrames = timeline.chain.expose()
  assert.equal(timelineFrames.length >= mainFrames.length, true)
  for (const frame of mainFrames) {
    const copy = timeline.chain.find(frame.index)
    assert.equal(copy.identity, frame.identity)
    assert.equal(copy.state, frame.state)
  }
  timeline.rates.usdJpy(1)
  const branchFrame = timeline.chain.find('present')
  assert.equal(branchFrame.index > mainFrames.at(-1).index, true)
})

test('time strings mean the same moment on every timeline', () => {
  const timeline = fresh()
  assert.equal(timeline.head.startTime(), head.startTime())
})

test('a timeline branched while the head is in the past starts there', () => {
  o.rates.usdJpy(161)
  o.rates.usdJpy(162)
  head.seek('rev')
  const shown = o.rates.usdJpy()
  const index = head.meta().index
  const timeline = fresh()
  head.seek('present')
  assert.equal(shown, 161)
  assert.equal(timeline.rates.usdJpy(), 161)
  assert.equal(timeline.head.meta().index, index)
  assert.equal(timeline.head.meta().isHeadPresent, false)
  timeline.head.seek('present')
  assert.equal(timeline.rates.usdJpy(), 162)
  o.rates.usdJpy(152)
})

test('a declaration in any timeline appears in every timeline', () => {
  const first = fresh()
  const second = fresh()
  o`markets > open`(true)
  assert.equal(first.markets.open(), true)
  assert.equal(second.markets.open(), true)
  first`news > headline`('Calm')
  assert.equal(o.news.headline(), 'Calm')
  assert.equal(second.news.headline(), 'Calm')
  second({ desk: { trader: 'Ada' } })
  assert.equal(o.desk.trader(), 'Ada')
  assert.equal(first.desk.trader(), 'Ada')
  // Values stay per timeline
  first.news.headline('Storm')
  assert.equal(o.news.headline(), 'Calm')
})

test('a timeline made later has everything declared before it', () => {
  o`late > flag`(1)
  const timeline = fresh()
  assert.equal(timeline.late.flag(), 1)
  assert.equal(timeline.news.headline(), 'Calm')
})

test('finite states and transition rules carry over', () => {
  const timeline = fresh()
  assert.equal(timeline.traffic.light(), 'red')
  timeline.traffic.light('green')
  assert.throws(() => timeline.traffic.light('red'), /cannot move from green to red/)
  assert.equal(o.traffic.light(), 'red')
})

test('freezing is shared, like the shape', () => {
  o`frozenGroup > kept`(1)
  const timeline = fresh()
  freeze(o.frozenGroup)
  assert.throws(() => timeline`frozenGroup > added`(2), /frozen/)
  timeline`otherGroup > kept`(1)
  timeline.chain.create(`timeline-${counter++}`)
  freeze(timeline.otherGroup)
  assert.throws(() => o`otherGroup > added`(2), /frozen/)
  // A timeline made after a freeze inherits it
  const later = fresh()
  assert.throws(() => later`frozenGroup > another`(3), /frozen/)
})

test('mutex locks any timeline\'s stateObjects, on that timeline only', () => {
  const timeline = fresh()
  const release = mutex.lock(timeline.rates.usdJpy)
  timeline.rates.usdJpy(1)
  assert.equal(timeline.rates.usdJpy(), 152)
  o.rates.usdJpy(152)
  assert.equal(mutex.buffer.length, 0)
  assert.equal(timeline.chain.buffer.length, 1)
  release(147)
  assert.equal(timeline.rates.usdJpy(), 1)

  const releaseAll = mutex.lock(timeline)
  timeline.rates.eurUsd(2)
  assert.equal(timeline.rates.eurUsd(), 1.08)
  o.rates.eurUsd(1.08)
  releaseAll()
  assert.equal(timeline.rates.eurUsd(), 2)

  const releaseChain = mutex.lock(timeline.chain)
  timeline.rates.eurUsd(3)
  assert.equal(mutex.unlock(timeline.chain), true)
  assert.equal(timeline.rates.eurUsd(), 3)
  releaseChain()
})

test('freeze() accepts any timeline\'s namespaces', () => {
  const timeline = fresh()
  timeline`routedFreeze > kept`(1)
  freeze(timeline.routedFreeze)
  assert.throws(() => o`routedFreeze > added`(2), /frozen/)
})

test('chain.get(), chain.list() and each timeline\'s name', () => {
  const name = `named-${counter++}`
  const timeline = chain.create(name)
  assert.equal(chain.get(name), timeline)
  assert.equal(timeline.chain.get(name), timeline)
  assert.equal(chain.list().includes(name), true)
  assert.equal(timeline.chain.name, name)
  assert.equal(chain.get('nothing-here'), undefined)
})

test('names are checked', () => {
  assert.throws(() => chain.create(''), /non-empty name/)
  assert.throws(() => chain.create(7), /non-empty name/)
  const name = `taken-${counter++}`
  chain.create(name)
  assert.throws(() => chain.create(name), /already exists/)
  assert.throws(() => chain.create(`options-${counter++}`, 'sync'), /options object/)
})

test('a timeline can branch off a timeline', () => {
  const parent = fresh()
  parent.rates.usdJpy(120)
  const child = parent.chain.create(`child-${counter++}`)
  assert.equal(child.rates.usdJpy(), 120)
  child.head.seek('first')
  assert.equal(child.rates.usdJpy(), 150)
})

test('deleting a timeline', () => {
  const name = `deleted-${counter++}`
  const timeline = chain.create(name)
  const child = timeline.chain.create(`survivor-${counter++}`)
  assert.equal(timeline.chain.delete(), true)
  assert.equal(timeline.chain.delete(), false)
  assert.equal(chain.get(name), undefined)
  assert.equal(chain.list().includes(name), false)
  // It no longer shares declarations; its branches carry on
  o`afterDelete > value`(1)
  assert.equal(Object.hasOwn(timeline, 'afterDelete'), false)
  assert.equal(child.afterDelete.value(), 1)
  // The name is free again
  chain.create(name)
})

test('options set the new timeline\'s configuration', () => {
  const timeline = fresh({ mergeFidelity: '1s', asyncLockTimeout: 50 })
  const settings = timeline.config({})
  assert.equal(settings.mergeFidelity, '1s')
  assert.equal(settings.asyncLockTimeout, 50)
  assert.equal(settings.persist, true)
  assert.equal(settings.execution, 'sync')
  assert.equal(settings.databaseName.endsWith(timeline.chain.name), true)
  assert.equal(o.config({}).asyncLockTimeout, 10000)
})

test('history features work per timeline', () => {
  const timeline = fresh()
  const frames = []
  timeline.chain.sub((recorded) => frames.push(...recorded.map((frame) => frame.state)))
  timeline.rates.usdJpy(alias('checkpoint', 133))
  timeline.rates.usdJpy(134)
  assert.deepEqual(frames, [133, 134])
  timeline.head.seek('checkpoint')
  assert.equal(timeline.rates.usdJpy(), 133)
  // The alias went to the timeline that recorded the frame, not main
  assert.throws(() => head.seek('checkpoint'), /No frame matches/)
  o.rates.eurUsd(alias('mainCheckpoint', 1.2))
  timeline.rates.eurUsd(1.3)
  assert.equal(chain.find('mainCheckpoint').state, 1.2)
  assert.equal(timeline.chain.find('mainCheckpoint'), undefined)
  o.rates.eurUsd(1.08)
  timeline.chain.purge('auto')
  timeline.rates.usdJpy(135)
  assert.equal(timeline.head.meta().isHeadPresent, true)
  assert.equal(timeline.chain.find('present').state, 135)
  assert.equal(timeline.rates.usdJpy.purge(), 0)
})

test('trajectories play per timeline', async () => {
  const timeline = fresh()
  timeline.traffic.light.trajectory({ continuation: 'loop', intervals: 1000 })
  timeline.traffic.light.trajectory.fwd()
  assert.equal(timeline.traffic.light(), 'green')
  assert.equal(o.traffic.light(), 'red')
})

test('a parent that doesn\'t record hands over its current states', async () => {
  const { o: isolatedRoot } = await import('../../src/soucouyant-polychrony.js')
  assert.equal(isolatedRoot, o)
  o.config({ persist: false })
  o.rates.usdJpy(170)
  const timeline = fresh()
  o.config({ persist: true })
  assert.equal(timeline.rates.usdJpy(), 170)
  timeline.rates.usdJpy(171)
  timeline.head.seek('rev')
  assert.equal(timeline.rates.usdJpy(), 170)
})

test('head and chain are reserved names on o', () => {
  assert.throws(() => o`head > x`(1), /reserved/)
  assert.throws(() => o`chain`(1), /reserved/)
  assert.equal(pending, Symbol.for('soucouyant.pending'))
})
