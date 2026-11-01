// Temporal: history settings, the head, the chain, aliases, per-stateObject
// history methods, trajectories and keyframes.
import { o, head, chain, alias, finite, mutex, pending } from 'soucouyant/temporal'
import type { Frame, HeadMeta, ChainMeta, Settings, StoredFrameSlice, TrajectoryDescription, FiniteStateObject, Keyframe, BufferedEntry } from 'soucouyant/temporal'
import { assert, type Equal } from '../expect.js'

// ---------------------------------------------------------------------------
// History settings exist once temporal is imported
// ---------------------------------------------------------------------------

const settings = o.config({ persist: true, mergeFidelity: '200ms', seekTime: 'epoch', databaseName: 'app', objectStoreName: 'state' })
assert<Equal<typeof settings, Settings>>()
assert<Equal<typeof settings.persist, boolean>>()
assert<Equal<typeof settings.offlineStorage.mode, 'disabled' | 'all' | 'excess'>>()
o.config({ mergeFidelity: 0 })
o.config({ mergeFidelity: 5 })
o.config({ offlineStorage: { mode: 'excess', excessLimit: '7d' as `${number}h` } })
o.config({ offlineStorage: { excessLimit: 50000 } })
// @ts-expect-error a duration needs a unit
o.config({ mergeFidelity: '200' })
// @ts-expect-error not a storage mode
o.config({ offlineStorage: { mode: 'sometimes' } })
// @ts-expect-error seekTime is 'session' or 'epoch'
o.config({ seekTime: 'now' })

// ---------------------------------------------------------------------------
// Declaring, with trajectories on finite stateObjects
// ---------------------------------------------------------------------------

const walk = (state: 'up' | 'down', props: { keyframe: Keyframe<'up' | 'down'> }): void => { void state; void props }

const state = o({
  editor: { text: '' },
  player: { direction: finite('up', ['up', 'down', 'left', 'right']) },
  sprite: {
    frame: finite('up', [
      { state: 'up', duration: 100, startDelay: 0, endDelay: 0, action: walk },
      { state: 'down', duration: 120, startDelay: 0, endDelay: 10, action: walk }
    ])
  },
  slides: { current: finite({ src: 'a.png', hold: 3000 }, [{ src: 'a.png', hold: 3000 }, { src: 'b.png', hold: 5000 }]) }
})

// Keyframe actions written inline are typed from the keyframes' states
const inline = o({
  walker: {
    step: finite('left', [
      { state: 'left', duration: 80, startDelay: 0, endDelay: 0, sound: 'tap', action: (current, props) => {
        assert<Equal<typeof current, 'left' | 'right'>>()
        assert<Equal<typeof props.keyframe.state, 'left' | 'right'>>()
        void props.keyframe.sound
      } },
      { state: 'right', duration: 80, startDelay: 0, endDelay: 0, action: (current) => { void current } }
    ])
  }
})
inline.walker.step.trajectory({ intervals: 'duration', keyframeActions: true })
o`walker > hop`('up', [{ state: 'up', action: (current) => { assert<Equal<typeof current, 'up' | 'down'>>() } }, { state: 'down', action: () => {} }])

const frame = state.sprite.frame()
assert<Equal<typeof frame, 'up' | 'down'>>()
state.sprite.frame('down')
// @ts-expect-error publish the keyframe's state, not the keyframe
state.sprite.frame({ state: 'up', duration: 100, startDelay: 0, endDelay: 0, action: walk })

// ---------------------------------------------------------------------------
// Per-stateObject history methods
// ---------------------------------------------------------------------------

const purged = state.editor.text.purge()
assert<Equal<typeof purged, number>>()
state.editor.text.purge('auto')
// @ts-expect-error not a purge mode
state.editor.text.purge('sometimes')
const ownLimit = state.editor.text.trailLimit()
assert<Equal<typeof ownLimit, number | `${number}ms`>>()
state.editor.text.trailLimit(500)
state.editor.text.trailLimit('30s')
state.editor.text.trailLimit(null)
// @ts-expect-error durations need a unit
state.editor.text.trailLimit('30 seconds')

// ---------------------------------------------------------------------------
// Trajectories
// ---------------------------------------------------------------------------

const described = state.player.direction.trajectory({ order: ['up', 'right', 'down', 'left'], continuation: 'loop', intervals: 250 })
assert<Equal<typeof described, TrajectoryDescription<'up' | 'down' | 'left' | 'right'>>>()
const stepped = state.player.direction.trajectory.fwd()
assert<Equal<typeof stepped, 'up' | 'down' | 'left' | 'right'>>()
state.player.direction.trajectory.play()
state.player.direction.trajectory.seek(2)
const current = state.player.direction.trajectory()
assert<Equal<typeof current, TrajectoryDescription<'up' | 'down' | 'left' | 'right'> | null>>()
// @ts-expect-error 'jump' is not one of the finite states
state.player.direction.trajectory({ order: ['up', 'jump'] })
// @ts-expect-error not a continuation
state.player.direction.trajectory({ continuation: 'forever' })

// Interval property names must be numeric properties of the entries
state.sprite.frame.trajectory({ intervals: 'duration', keyframeActions: true })
state.slides.current.trajectory({ intervals: 'hold' })
// @ts-expect-error src is not numeric
state.slides.current.trajectory({ intervals: 'src' })
// @ts-expect-error a non-finite stateObject has no trajectory
void state.editor.text.trajectory

const typedFinite: FiniteStateObject<'up' | 'down' | 'left' | 'right'> = state.player.direction
void typedFinite

// ---------------------------------------------------------------------------
// The head
// ---------------------------------------------------------------------------

const index = head.seek('rev')
assert<Equal<typeof index, number>>()
head.seek('fwd')
head.seek('>3')
head.seek('<2')
head.seek(42)
head.seek('2.5s')
head.seek('first')
head.seek('present')
head.seek('opened')
// @ts-expect-error not a position
head.seek(true)
head.ignoreFrame('opened')
head.ignoreFrame(12, 'stop')
// @ts-expect-error only 'stop'
head.ignoreFrame(12, 'start')
const meta = head.meta()
assert<Equal<typeof meta, HeadMeta>>()
const shown = meta.getCurrentFrame()
assert<Equal<typeof shown, Frame | null>>()
const sessionStart: number = head.startTime()
void sessionStart

// ---------------------------------------------------------------------------
// The chain
// ---------------------------------------------------------------------------

chain.purge('auto')
const removed = chain.purge()
assert<Equal<typeof removed, number>>()
chain.trailLimit(10000)
chain.trailLimit('30s')
chain.autoLimitTail()
chain.autoLimitTail('idb')
chain.tailSliceSize(100)
chain.requestTailSlice((frames) => { assert<Equal<typeof frames, Frame[]>>() })
chain.IDBTailSliceSize(10)
chain.IDBRequestTailSlice((frames) => { assert<Equal<typeof frames, StoredFrameSlice[]>>() }, state.editor.text)

const exposed = chain.expose()
assert<Equal<typeof exposed, Frame[]>>()
chain.validate(exposed)
chain.replace(exposed.map((entry) => ({ ...entry, ignored: false })))
chain.replace([{ index: 1, timestamp: 10, identity: 'editor > text', state: 'Hi' }])
// @ts-expect-error a frame needs an index
chain.replace([{ timestamp: 10, identity: 'editor > text' }])

const found = chain.find('present')
assert<Equal<typeof found, Frame | undefined>>()
const sliced = chain.slice('first', 'present', state.editor.text, state.player.direction)
assert<Equal<typeof sliced, Frame[]>>()
const states = chain.stateAt('5s', state.editor.text)
assert<Equal<typeof states, Record<string, unknown>>>()

const chainMeta = chain.meta()
assert<Equal<typeof chainMeta, ChainMeta>>()

const subscription = chain.sub((frames) => { void frames.length })
assert<Equal<typeof subscription, string>>()
chain.unsub(subscription)

const restored = chain.restore()
assert<Equal<typeof restored, Promise<number>>>()
chain.restore(0, 500)
const flushed = chain.flush()
assert<Equal<typeof flushed, Promise<void>>>()
const cleared = chain.clear()
assert<Equal<typeof cleared, undefined>>()
const clearedStorage = chain.clear({ storage: true })
assert<Equal<typeof clearedStorage, Promise<void>>>()

// chain is another name for the lock on everything
const releaseAll = mutex.lock(chain)
releaseAll(state.editor.text, 'saved')
mutex.unlock(chain)
const waiting = chain.buffer
assert<Equal<typeof waiting, BufferedEntry[]>>()

// ---------------------------------------------------------------------------
// Aliases
// ---------------------------------------------------------------------------

const opened = alias('opened', 'Hello')
assert<Equal<typeof opened, 'Hello'>>()
state.editor.text(alias('saved', 'Hello, world'))

// Core exports come through temporal too
state.editor.text(pending as unknown as string)
