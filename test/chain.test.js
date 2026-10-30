import { test } from 'node:test'
import assert from 'node:assert/strict'
import { o, head, chain, alias, pending } from '../src/index.js'

o.config({ execution: 'sync', persist: true, mergeFidelity: 0 })

test('expose returns frame copies; find, slice and stateAt read without moving the head', () => {
  o`reading > a`(0)`reading > b`('x')
  o.reading.a(1)
  o.reading.b(alias('b-y', 'y'))
  o.reading.a(2)
  const frames = chain.expose()
  assert.deepEqual(Object.keys(frames[0]), ['index', 'timestamp', 'identity', 'state', 'finiteIndex', 'alias', 'pending', 'ignored'])
  const aliased = chain.find('b-y')
  assert.equal(aliased.state, 'y')
  assert.equal(aliased.alias, 'b-y')
  const onlyA = chain.slice('first', 'present', o.reading.a)
  assert.deepEqual(onlyA.map((frame) => frame.state), [0, 1, 2])
  const before = head.meta().index
  assert.deepEqual(chain.stateAt('b-y', o.reading.a, o.reading.b), { 'reading > a': 1, 'reading > b': 'y' })
  assert.equal(head.meta().index, before)
  assert.equal(chain.find('nope'), undefined)
})

test('validate reports the offending frame', () => {
  const frames = chain.expose()
  chain.validate(frames)
  const broken = frames.map((frame) => ({ ...frame }))
  broken[1].index = broken[0].index
  assert.throws(() => chain.validate(broken), /does not come after/)
  const undeclared = frames.map((frame) => ({ ...frame }))
  undeclared[0].identity = 'nobody > here'
  assert.throws(() => chain.validate(undeclared), /not declared/)
  assert.throws(() => chain.validate([{ index: 0, timestamp: 1, identity: 'reading > a', state: () => 1 }]), /could not be cloned/)
})

test('replace swaps in an edited chain and updates views', () => {
  o`edit > value`(0)
  o.edit.value(1)
  o.edit.value(2)
  const seen = []
  o.edit.value.sub((state) => seen.push(state))
  const edited = chain.expose().map((frame) => frame.identity === 'edit > value' && frame.state === 2 ? { ...frame, state: 20 } : frame)
  chain.replace(edited)
  assert.equal(o.edit.value(), 20)
  assert.deepEqual(seen, [20])
  head.seek('rev')
  assert.equal(o.edit.value(), 1)
  head.seek('present')
})

test('chain.sub streams every recorded frame', () => {
  const batches = []
  const ref = chain.sub((frames) => batches.push(frames.map((frame) => [frame.identity, frame.state])))
  o`stream > value`(0)
  o.stream.value(1)
  o.stream.value(2)
  assert.deepEqual(batches, [[['stream > value', 0]], [['stream > value', 1]], [['stream > value', 2]]])
  assert.equal(chain.unsub(ref), 1)
  o.stream.value(3)
  assert.equal(batches.length, 3)
})

test('tail slices hand over frames before they leave memory', () => {
  const slices = []
  chain.tailSliceSize(2)
  chain.requestTailSlice((slice) => slices.push(slice.map((frame) => frame.state)))
  o`tail > value`(0)
  const previous = chain.trailLimit()
  chain.trailLimit(3)
  for (let i = 1; i <= 6; i++) o.tail.value(i)
  const states = slices.flat()
  assert.ok(states.includes(1) && states.includes(2))
  assert.ok(slices.every((slice) => slice.length === 2))
  chain.trailLimit(previous)
})

test('autoLimitTail stop lets the chain grow past the limit', () => {
  o`grow > value`(0)
  chain.trailLimit(4)
  chain.autoLimitTail('stop')
  for (let i = 0; i < 10; i++) o.grow.value(i)
  assert.ok(chain.meta().framesInMemory > 4)
  chain.autoLimitTail()
  assert.equal(chain.meta().framesInMemory, 4)
  chain.trailLimit(10000)
  assert.throws(() => chain.autoLimitTail('sometimes'), TypeError)
})

test('trailLimit accepts durations', () => {
  chain.trailLimit('30s')
  assert.equal(chain.trailLimit(), '30000ms')
  chain.trailLimit(10000)
  assert.equal(chain.trailLimit(), 10000)
  assert.throws(() => chain.trailLimit('forever'), RangeError)
})

test('meta describes the chain', () => {
  const meta = chain.meta()
  assert.equal(typeof meta.length, 'number')
  assert.equal(meta.lastIndex >= meta.firstIndex, true)
  assert.equal(meta.bufferLength, 0)
  assert.equal(meta.framesInStorage, 0)
})

test('clear keeps current states and drops history', () => {
  o`clearing > value`(pending)
  o.clearing.value('done')
  chain.clear()
  assert.equal(chain.meta().framesInMemory, 0)
  assert.equal(o.clearing.value(), 'done')
  head.seek('rev')
  assert.equal(o.clearing.value(), 'done')
  o.clearing.value('again')
  head.seek('rev')
  assert.equal(o.clearing.value(), 'done')
  head.seek('present')
})

test('stateAt works without persist, for server snapshots', () => {
  o.config({ persist: false })
  o`snapshot > value`(5)
  assert.deepEqual(chain.stateAt('present', o.snapshot.value), { 'snapshot > value': 5 })
  assert.deepEqual(chain.expose(), [])
  assert.throws(() => head.seek('rev'), /persist: true/)
  o.config({ persist: true })
})
