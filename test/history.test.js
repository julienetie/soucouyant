import { test } from 'node:test'
import assert from 'node:assert/strict'
import { o, head, chain, alias, pending } from '../src/index.js'

o.config({ execution: 'sync', persist: true, mergeFidelity: 0 })

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

test('seek forms: fwd, rev, steps, index, first, present', () => {
  o`seek > value`(0)
  o.seek.value(1)
  o.seek.value(2)
  o.seek.value(3)
  head.seek('rev')
  assert.equal(o.seek.value(), 2)
  head.seek('<2')
  assert.equal(o.seek.value(), 0)
  head.seek('>2')
  assert.equal(o.seek.value(), 2)
  head.seek('first')
  assert.equal(head.meta().isHeadPresent, false)
  head.seek('present')
  assert.equal(o.seek.value(), 3)
  assert.equal(head.meta().isHeadPresent, true)
  const index = chain.find('present').index
  head.seek(index - 1)
  assert.equal(o.seek.value(), 2)
  head.seek('present')
})

test('seek by alias and time strings', async () => {
  o`timed > value`('start')
  await sleep(30)
  const midway = Date.now() - head.startTime()
  o.timed.value(alias('opened', 'open'))
  await sleep(30)
  o.timed.value('closed')
  head.seek('opened')
  assert.equal(o.timed.value(), 'open')
  head.seek(`${Math.floor(midway)}ms`)
  assert.equal(o.timed.value(), 'start')
  head.seek('present')
  assert.throws(() => head.seek('no-such-alias'), RangeError)
  assert.throws(() => alias('fwd', 1), /cannot be an alias/)
  assert.throws(() => alias('2.5s', 1), /cannot be an alias/)
})

test('recording continues while the head is in the past', () => {
  o`past > value`(0)
  o.past.value(1)
  head.seek('rev')
  const seen = []
  o.past.value.sub((state) => seen.push(state))
  assert.equal(o.past.value(5), 5)
  assert.equal(o.past.value(), 0)
  assert.deepEqual(seen, [])
  // callbacks see the newest recorded state, not the head
  o.past.value((state) => state + 1)
  assert.equal(chain.find('present').state, 6)
  head.seek('present')
  assert.equal(o.past.value(), 6)
  assert.deepEqual(seen, [6])
})

test('chain.purge removes frames ahead of the head', () => {
  o`purge > value`(0)
  o.purge.value(1)
  o.purge.value(2)
  head.seek('<2')
  assert.equal(chain.purge(), 2)
  assert.equal(head.meta().isHeadPresent, true)
  o.purge.value(9)
  assert.equal(o.purge.value(), 9)
  head.seek('rev')
  assert.equal(o.purge.value(), 0)
  head.seek('present')
})

test('purge auto: undo and redo behaviour', () => {
  o`undo > text`('a')
  o.undo.text('ab')
  o.undo.text('abc')
  chain.purge('auto')
  head.seek('rev')
  assert.equal(o.undo.text(), 'ab')
  o.undo.text('abX')
  assert.equal(o.undo.text(), 'abX')
  head.seek('rev')
  assert.equal(o.undo.text(), 'ab')
  chain.purge('auto-stop')
  head.seek('present')
})

test('stateObject.purge removes only its own future frames', () => {
  o`own > a`(0)`own > b`(0)
  o.own.a(1)
  o.own.b(1)
  o.own.a(2)
  head.seek('<2')
  assert.equal(o.own.a.purge(), 1)
  head.seek('present')
  assert.equal(o.own.a(), 1)
  assert.equal(o.own.b(), 1)
})

test('ignoreFrame hides a frame from time travel and can be undone', () => {
  o`ignore > value`(0)
  o.ignore.value(alias('skip-me', 1))
  o.ignore.value(2)
  head.ignoreFrame('skip-me')
  head.seek('rev')
  assert.equal(o.ignore.value(), 0)
  head.ignoreFrame('skip-me', 'stop')
  assert.equal(o.ignore.value(), 0)
  head.seek('fwd')
  assert.equal(o.ignore.value(), 1)
  head.seek('present')
  head.ignoreFrame('present')
  assert.equal(o.ignore.value(), 1)
  head.ignoreFrame('present', 'stop')
  assert.equal(o.ignore.value(), 2)
})

test('mergeFidelity merges consecutive publishes inside the window', () => {
  o.config({ mergeFidelity: 3 })
  o`merge > value`(0)
  const before = chain.meta().lastIndex
  o.merge.value(1)
  o.merge.value(2)
  o.merge.value(3)
  assert.equal(chain.meta().lastIndex, before + 1)
  assert.equal(chain.find('present').state, 3)
  o.config({ mergeFidelity: '1h' })
  o.merge.value(4)
  o.merge.value(5)
  assert.equal(chain.find('present').state, 5)
  o.config({ mergeFidelity: 0 })
})

test('trail limit evicts old frames and keeps their state as the base', () => {
  o`trail > value`(0)
  const limitBefore = chain.trailLimit()
  chain.trailLimit(5)
  for (let i = 1; i <= 20; i++) o.trail.value(i)
  assert.equal(chain.meta().framesInMemory, 5)
  head.seek('first')
  assert.equal(o.trail.value(), 16)
  head.seek(chain.meta().firstIndex - 1)
  assert.equal(o.trail.value(), 15)
  head.seek('present')
  chain.trailLimit(limitBefore)
})

test('a head parked behind evicted frames is pulled forward', () => {
  o`parked > value`(0)
  chain.trailLimit(1000)
  o.parked.value(1)
  head.seek('rev')
  const seen = []
  o.parked.value.sub((state) => seen.push(state))
  chain.trailLimit(3)
  for (let i = 0; i < 5; i++) o.parked.value(100 + i)
  try {
    assert.equal(chain.meta().framesInMemory, 3)
    // The head sits just before the oldest frame in memory and shows the
    // state that frame replaced; every pull forward notified in order
    assert.equal(head.meta().index, chain.meta().firstIndex - 1)
    assert.equal(o.parked.value(), seen.at(-1))
    assert.deepEqual(seen, [...seen].sort((a, b) => a - b))
    assert.equal(seen[0], 1)
  } finally {
    chain.trailLimit(10000)
    head.seek('present')
  }
})

test('stateObject.trailLimit keeps only its own newest frames', () => {
  o`ownTrail > value`(0)
  o.ownTrail.value.trailLimit(2)
  for (let i = 1; i <= 6; i++) o.ownTrail.value(i)
  const frames = chain.expose().filter((frame) => frame.identity === 'ownTrail > value')
  assert.deepEqual(frames.map((frame) => frame.state), [5, 6])
  assert.equal(o.ownTrail.value.trailLimit(), 2)
})

test('pending is recorded as a frame', () => {
  o`load > user`()
  o.load.user({ name: 'Ada' })
  o.load.user(pending)
  const frames = chain.expose().filter((frame) => frame.identity === 'load > user')
  assert.deepEqual(frames.map((frame) => frame.pending), [true, false, true])
})

test('head.meta and getCurrentFrame', () => {
  o`metaCheck > value`(1)
  const meta = head.meta()
  assert.equal(meta.isHeadPresent, true)
  assert.equal(meta.getCurrentFrame().identity, 'metaCheck > value')
  assert.equal(typeof meta.timestamp, 'number')
})

test('randomized: every view matches a brute-force model through seeks, ignores, purges and eviction', () => {
  let seed = 42
  const random = () => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0
    return seed / 4294967296
  }
  const objectTotal = 40
  const names = []
  const history = []
  for (let i = 0; i < objectTotal; i++) {
    const name = `object${i}`
    o`random > ${name}`(-1 - i)
    names.push(name)
  }
  const initial = names.map((_, i) => -1 - i)
  const firstModelIndex = chain.meta().lastIndex - objectTotal + 1
  for (let i = 0; i < objectTotal; i++) history.push({ index: firstModelIndex + i, id: i, value: initial[i], ignored: false, purged: false })
  chain.trailLimit(3000)
  const idOfIdentity = new Map(names.map((name, i) => [`random > ${name}`, i]))
  const modelState = (id, headIndex) => {
    for (let i = history.length - 1; i >= 0; i--) {
      const frame = history[i]
      if (frame.index > headIndex || frame.id !== id || frame.ignored || frame.purged) continue
      return frame.value
    }
    return initial[id]
  }
  let counter = 0
  for (let step = 0; step < 12000; step++) {
    const roll = random()
    if (roll < 0.7) {
      const id = Math.floor(random() * objectTotal)
      const value = counter++
      o.random[names[id]](value)
      history.push({ index: chain.meta().lastIndex, id, value, ignored: false, purged: false })
    } else if (roll < 0.85) {
      const meta = chain.meta()
      const target = meta.firstIndex - 1 + Math.floor(random() * (meta.lastIndex - meta.firstIndex + 2))
      head.seek(target)
    } else if (roll < 0.9) {
      head.seek(random() < 0.5 ? 'rev' : 'fwd')
    } else if (roll < 0.97) {
      const meta = chain.meta()
      const index = meta.firstIndex + Math.floor(random() * (meta.lastIndex - meta.firstIndex + 1))
      const frame = history.find((entry) => entry.index === index)
      if (frame !== undefined && !frame.purged && idOfIdentity.has(chain.find(index)?.identity)) {
        frame.ignored = !frame.ignored
        head.ignoreFrame(index, frame.ignored ? undefined : 'stop')
      }
    } else if (roll < 0.985) {
      const headIndex = head.meta().index
      chain.purge()
      for (const frame of history) if (frame.index > headIndex) frame.purged = true
    } else {
      head.seek('present')
    }
    if (step % 97 === 0 || step > 11900) {
      const headIndex = head.meta().index
      for (let id = 0; id < objectTotal; id++) {
        assert.equal(o.random[names[id]](), modelState(id, headIndex), `step ${step}, ${names[id]} at head ${headIndex}`)
      }
    }
  }
  chain.trailLimit(10000)
})
