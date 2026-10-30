import { test } from 'node:test'
import assert from 'node:assert/strict'
import { o, pending } from '../src/index.js'

o.config({ execution: 'sync' })

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

test('fwd and rwd step through the order with loop continuation', () => {
  o`player > direction`('up', ['up', 'right', 'down', 'left'])
  const trajectory = o.player.direction.trajectory
  trajectory({ order: ['up', 'right', 'down', 'left'], continuation: 'loop', intervals: 1000 })
  assert.equal(trajectory.fwd(), 'right')
  assert.equal(trajectory.rwd(), 'up')
  assert.equal(trajectory.rwd(), 'left')
  assert.equal(trajectory.seek(2), 'down')
  assert.throws(() => trajectory.seek(9), RangeError)
  assert.deepEqual(trajectory().order, ['up', 'right', 'down', 'left'])
})

test('rebound and end continuations', () => {
  o`bounce > value`(1, [1, 2, 3])
  o.bounce.value.trajectory({ continuation: 'rebound' })
  const states = []
  for (let i = 0; i < 5; i++) states.push(o.bounce.value.trajectory.fwd())
  assert.deepEqual(states, [2, 3, 2, 3, 2])
  o`ending > value`(1, [1, 2])
  o.ending.value.trajectory({ continuation: 'end' })
  assert.equal(o.ending.value.trajectory.fwd(), 2)
  assert.equal(o.ending.value.trajectory.fwd(), 2)
})

test('random-unique visits every state before repeating', () => {
  o`dice > face`(1, [1, 2, 3, 4, 5, 6])
  o.dice.face.trajectory({ continuation: 'random-unique' })
  const seen = new Set()
  for (let i = 0; i < 5; i++) seen.add(o.dice.face.trajectory.fwd())
  assert.equal(seen.size, 5)
  assert.ok(!seen.has(1) || seen.size === 5)
})

test('play advances on its interval; pause and stop', async () => {
  o`blink > state`('off', ['off', 'on'])
  const seen = []
  o.blink.state.sub((state) => seen.push(state))
  o.blink.state.trajectory({ intervals: 15 })
  o.blink.state.trajectory.play()
  await sleep(70)
  o.blink.state.trajectory.pause()
  const count = seen.length
  assert.ok(count >= 3, `played ${count} steps`)
  await sleep(40)
  assert.equal(seen.length, count)
  o.blink.state.trajectory.stop()
  assert.equal(o.blink.state(), 'off')
})

test('per-state interval property', async () => {
  const short = { name: 'short', ms: 5 }
  const long = { name: 'long', ms: 1000 }
  o`phases > current`(short, [short, long])
  o.phases.current.trajectory({ intervals: 'ms' })
  o.phases.current.trajectory.play()
  await sleep(40)
  assert.equal(o.phases.current(), long)
  o.phases.current.trajectory.pause()
  assert.throws(() => o.phases.current.trajectory({ intervals: 'missing' }), /numeric "missing"/)
})

test('keyframe actions run with their keyframe in props', async () => {
  const calls = []
  const frame = (state, duration) => ({
    state,
    duration,
    startDelay: 0,
    endDelay: 0,
    custom1: `${state}-custom`,
    action: (current, props) => calls.push([current, props.keyframe.custom1])
  })
  o`sprite > pose`('stand', [frame('stand', 10), frame('walk', 10), frame('jump', 10)])
  assert.equal(o.sprite.pose(), 'stand')
  o.sprite.pose('walk')
  assert.throws(() => o.sprite.pose('fly'), TypeError)
  o.sprite.pose.trajectory({ keyframeActions: true, continuation: 'end' })
  o.sprite.pose.trajectory.play()
  await sleep(80)
  assert.deepEqual(calls.map((call) => call[0]), ['walk', 'jump'])
  assert.equal(calls[1][1], 'jump-custom')
})

test('trajectory order must respect transition rules', () => {
  o`gated > value`('a', ['a', 'b', 'c'], { transitions: { a: ['b'], b: ['c'], c: ['a'] } })
  assert.throws(() => o.gated.value.trajectory({ order: ['a', 'c', 'b'] }), /forbid/)
  o.gated.value.trajectory({ order: ['a', 'b', 'c'], continuation: 'loop' })
  assert.equal(o.gated.value.trajectory.fwd(), 'b')
})

test('non-finite stateObjects have no trajectory; unconfigured controls throw', () => {
  o`plain > value`(0)
  assert.equal(o.plain.value.trajectory, undefined)
  o`unset > value`(pending, ['x', 'y'])
  assert.throws(() => o.unset.value.trajectory.fwd(), /no trajectory/)
})
