// ===========================================================================
// Turnstile: trajectories, keyframe actions and inverted functions
//
// Forward time: a trajectory steps o.agent.pose through the keyframes of a
// walk cycle. Each keyframe's action moves the agent along, stamps a
// footprint on a heel strike and breaks the vase when he reaches it. Every
// one of those publishes is recorded as a frame.
//
// Inverted time: at the turnstile, the trajectory pauses and the head runs
// back along the chain, frame by frame, at the speed it was recorded.
// Nothing is published. Each stateObject's inverted function undoes its
// proceeding function: footprints lift, the vase reassembles, and the poses
// play backwards so the agent walks back to where he started.
// ===========================================================================

// npm run examples copies the library files into examples/
import { o, head, chain } from '../soucouyant-temporal.js'

// ---------------------------------------------------------------------------
// 1. Configure history
// ---------------------------------------------------------------------------

o.config({
  // Record every publish: the chain is the past the head runs back along
  persist: true,
  // Several publishes to one stateObject within 200ms would merge into one
  // frame by default; every pose is a step in the past, so keep them all
  mergeFidelity: 0
})

// ---------------------------------------------------------------------------
// 2. The walk cycle: eight keyframes
//
// A keyframe is a finite state that's an object: its `state` is what gets
// published, `duration` is how long it holds, and `action` runs as it
// becomes active. Everything else on it is ours: here, joint angles.
//
// Angles are degrees from straight down; positive points the way he walks.
// A knee bends back by `knee` degrees, an elbow forward by `elbow`.
// `front` is the leg nearer to us, `back` the one behind
// ---------------------------------------------------------------------------

const stride = 9 // pixels moved per keyframe

// One half of the cycle, for the front leg leading. The other half mirrors
// it, swapping front and back
const halfCycle = [
  { name: 'contact', hip: [26, -22], knee: [2, 10], shoulder: [-24, 24], elbow: [12, 22], bob: 0, heelStrike: true },
  { name: 'down', hip: [14, -16], knee: [14, 32], shoulder: [-16, 16], elbow: [14, 18], bob: 4, heelStrike: false },
  { name: 'passing', hip: [0, 12], knee: [4, 62], shoulder: [-4, 4], elbow: [12, 12], bob: 1, heelStrike: false },
  { name: 'up', hip: [-14, 24], knee: [6, 30], shoulder: [12, -12], elbow: [16, 12], bob: -3, heelStrike: false }
]

const swap = ([a, b]) => [b, a]

// The action every keyframe runs as it becomes active (defined in section 4)
const keyframeAction = (state, props) => onKeyframe(props.keyframe)

const walkCycle = [
  ...halfCycle.map((pose) => ({ ...pose, side: 'front' })),
  ...halfCycle.map((pose) => ({
    ...pose,
    side: 'back',
    hip: swap(pose.hip),
    knee: swap(pose.knee),
    shoulder: swap(pose.shoulder),
    elbow: swap(pose.elbow)
  }))
].map((pose) => ({
  state: `${pose.name}-${pose.side}`, // what o.agent.pose holds
  duration: 120,
  startDelay: 0,
  endDelay: 0,
  action: keyframeAction,
  ...pose
}))

const keyframeByState = new Map(walkCycle.map((keyframe) => [keyframe.state, keyframe]))

// ---------------------------------------------------------------------------
// 3. Declarations
// ---------------------------------------------------------------------------

const startX = 70
const vaseX = 470
const turnstileX = 820

o`agent > pose`('contact-front', walkCycle) // finite: the keyframes
  `agent > x`(startX)
  `world > footprints`([]) // [{ x, side }]
  `world > vase`('whole', ['whole', 'broken'])

// The trajectory: loop through the keyframes, holding each for its
// duration, running each one's action. Configuring it again resets it to
// the keyframe the pose is on, playing forward
const setUpTrajectory = () => o.agent.pose.trajectory({ continuation: 'loop', keyframeActions: true })
setUpTrajectory()

// The frame the run starts from. Inversion stops here: before it are only
// the declarations
let origin = head.meta().index

// Moonwalking is trajectory.reverse() instead of trajectory.play()
let moonwalking = false

// ---------------------------------------------------------------------------
// 4. Keyframe actions: what happens in forward time
//
// These publish, so they only run forward. Everything they do is recorded,
// and inverted time plays it back the other way
// ---------------------------------------------------------------------------

// Where the leading foot lands, relative to the hips
const footReach = (keyframe, leg) =>
  Math.sin(rad(keyframe.hip[leg])) * thigh + Math.sin(rad(keyframe.hip[leg] - keyframe.knee[leg])) * shin

const onKeyframe = (keyframe) => {
  o.agent.x((current) => current + stride)
  const position = o.agent.x()

  if (keyframe.heelStrike) {
    const leg = keyframe.side === 'front' ? 0 : 1
    o.world.footprints((prints) => [...prints, { x: Math.round(position + footReach(keyframe, leg)), side: keyframe.side }])
  }

  if (position >= vaseX - 34 && o.world.vase() === 'whole') o.world.vase('broken')

  if (position >= turnstileX - 40) {
    // He's in the turnstile: stop walking, and turn time round
    o.agent.pose.trajectory.pause()
    story('He steps into the turnstile. Time turns round.')
    setTimeout(() => runThroughTime('rev'), 500)
  }
}

// ---------------------------------------------------------------------------
// 5. Drawing the agent
//
// The subscribers below set a target pose and position; this loop eases the
// limbs towards them each animation frame
// ---------------------------------------------------------------------------

const thigh = 36
const shin = 36
const upperArm = 27
const forearm = 25
const groundY = 300
const rad = (degrees) => degrees * Math.PI / 180
const $ = (selector) => document.querySelector(selector)

const shown = { hip: [26, -22], knee: [2, 10], shoulder: [-24, 24], elbow: [12, 22], bob: 0, x: startX }
const target = { ...shown }
const blend = (from, to, amount) => from + (to - from) * amount
const blendPair = (from, to, amount) => [blend(from[0], to[0], amount), blend(from[1], to[1], amount)]

const setLine = (id, x1, y1, x2, y2) => {
  const line = document.getElementById(id)
  line.setAttribute('x1', x1.toFixed(1))
  line.setAttribute('y1', y1.toFixed(1))
  line.setAttribute('x2', x2.toFixed(1))
  line.setAttribute('y2', y2.toFixed(1))
}

const drawAgent = () => {
  const hipY = groundY - thigh - shin + shown.bob
  const shoulderY = hipY - 50
  const { x } = shown
  for (const [leg, name] of [[1, 'back'], [0, 'front']]) {
    const kneeX = x + Math.sin(rad(shown.hip[leg])) * thigh
    const kneeY = hipY + Math.cos(rad(shown.hip[leg])) * thigh
    const shinAngle = rad(shown.hip[leg] - shown.knee[leg])
    setLine(`leg-${name}-upper`, x, hipY, kneeX, kneeY)
    setLine(`leg-${name}-lower`, kneeX, kneeY, kneeX + Math.sin(shinAngle) * shin, kneeY + Math.cos(shinAngle) * shin)

    const elbowX = x + Math.sin(rad(shown.shoulder[leg])) * upperArm
    const elbowY = shoulderY + Math.cos(rad(shown.shoulder[leg])) * upperArm
    const forearmAngle = rad(shown.shoulder[leg] + shown.elbow[leg])
    setLine(`arm-${name}-upper`, x, shoulderY, elbowX, elbowY)
    setLine(`arm-${name}-lower`, elbowX, elbowY, elbowX + Math.sin(forearmAngle) * forearm, elbowY + Math.cos(forearmAngle) * forearm)
  }
  setLine('torso', x, hipY, x, shoulderY - 4)
  const headElement = $('#head')
  headElement.setAttribute('cx', x.toFixed(1))
  headElement.setAttribute('cy', (shoulderY - 24).toFixed(1))
  // The scarf trails behind him, whichever way time is going
  $('#scarf').setAttribute('d', `M${x - 7},${shoulderY - 6} h14 l-4,10 l-22,${8 + shown.bob} l4,-8 z`)
}

const animate = () => {
  // Close a quarter of the gap each frame: smooth, and it keeps up
  shown.hip = blendPair(shown.hip, target.hip, 0.35)
  shown.knee = blendPair(shown.knee, target.knee, 0.35)
  shown.shoulder = blendPair(shown.shoulder, target.shoulder, 0.35)
  shown.elbow = blendPair(shown.elbow, target.elbow, 0.35)
  shown.bob = blend(shown.bob, target.bob, 0.35)
  shown.x = blend(shown.x, target.x, 0.35)
  drawAgent()
  requestAnimationFrame(animate)
}

// ---------------------------------------------------------------------------
// 6. Subscriptions: proceeding and inverted functions
//
// For the pose and position, both directions do the same thing: show the
// state the head is on. The footprints and the vase are where the inverted
// functions earn their keep: each does the opposite of its proceeding
// function, as an animation of its own
// ---------------------------------------------------------------------------

const calls = {}
const count = (address, kind) => {
  calls[address] ??= { proceeding: 0, inverted: 0 }
  calls[address][kind]++
}

const showPose = (state) => {
  const keyframe = keyframeByState.get(state)
  if (keyframe === undefined) return
  Object.assign(target, { hip: keyframe.hip, knee: keyframe.knee, shoulder: keyframe.shoulder, elbow: keyframe.elbow, bob: keyframe.bob })
}

o.agent.pose.sub(
  (state) => { count('agent > pose', 'proceeding'); showPose(state) },
  (state) => { count('agent > pose', 'inverted'); showPose(state) }
)

o.agent.x.sub(
  (x) => { count('agent > x', 'proceeding'); target.x = x },
  (x) => { count('agent > x', 'inverted'); target.x = x }
)

// Footprints. Proceeding stamps the new ones; inverted lifts the ones that
// are no longer in the past. One call can cover several frames, so both
// work from the list they're given rather than assuming one step
const footprintLayer = $('#footprints')
const footprintElement = ({ x, side }) => {
  const print = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse')
  print.setAttribute('class', 'footprint stamp')
  print.setAttribute('cx', x)
  print.setAttribute('cy', groundY + (side === 'front' ? 9 : 4))
  print.setAttribute('rx', 11)
  print.setAttribute('ry', 3.5)
  return print
}

// Elements still on screen, oldest first, excluding ones being lifted
const standingPrints = () => [...footprintLayer.children].filter((print) => !print.classList.contains('lift'))

o.world.footprints.sub(
  // Proceeding: stamp whatever is new
  (prints) => {
    count('world > footprints', 'proceeding')
    const standing = standingPrints()
    // A rebuild (Start over) can shrink the list in forward time
    for (const print of standing.slice(prints.length)) print.remove()
    for (const print of prints.slice(standing.length)) footprintLayer.append(footprintElement(print))
  },
  // Inverted: lift the newest prints until only `prints.length` remain
  (prints) => {
    count('world > footprints', 'inverted')
    for (const print of standingPrints().slice(prints.length)) {
      print.classList.replace('stamp', 'lift')
      // The lift animation is the stamp played the other way. With reduced
      // motion there's no animation, so the print goes straight away
      if (getComputedStyle(print).animationName === 'none') print.remove()
      else setTimeout(() => print.remove(), 260)
    }
  }
)

// The vase: five shards. Breaking sends each to a resting place on the
// ground; mending brings each back along the same path
const shards = [
  { points: '-14,-46 14,-46 10,-36 -10,-36', to: [-56, 40, -80] },
  { points: '-10,-36 10,-36 22,-14 0,-14 -22,-14', to: [44, 30, 120] },
  { points: '-22,-14 0,-14 -4,10 -24,4', to: [-34, 18, -150] },
  { points: '0,-14 22,-14 24,4 -4,10', to: [70, 18, 200] },
  { points: '-24,4 -4,10 24,4 14,20 -14,20', to: [10, 6, 30] }
]
const vaseLayer = $('#vase')
vaseLayer.setAttribute('transform', `translate(${vaseX} ${groundY - 20})`)
for (const shard of shards) {
  const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon')
  polygon.setAttribute('class', 'shard')
  polygon.setAttribute('points', shard.points)
  shard.element = polygon
  vaseLayer.append(polygon)
}

const breakVase = () => {
  for (const { element, to: [dx, dy, turn] } of shards) element.style.transform = `translate(${dx}px, ${dy}px) rotate(${turn}deg)`
}
const mendVase = () => {
  for (const { element } of shards) element.style.transform = ''
}

o.world.vase.sub(
  // Proceeding: it breaks (or, after a rebuild, is simply whole)
  (state) => {
    count('world > vase', 'proceeding')
    if (state === 'broken') breakVase()
    else mendVase()
  },
  // Inverted: the opposite. Going back past the moment it broke, it mends
  (state) => {
    count('world > vase', 'inverted')
    if (state === 'whole') {
      mendVase()
      story('The vase gathers itself up off the floor.')
    } else {
      breakVase()
    }
  }
)

// ---------------------------------------------------------------------------
// 7. Inversion: run the head along the chain
//
// 'rev' steps the head back one frame; 'fwd' steps it forward. Each step
// waits as long as the gap between the two frames when they were recorded,
// so the past plays back at the speed it happened
// ---------------------------------------------------------------------------

let runner = null

const setDirection = (next) => {
  document.body.classList.toggle('inverted', next === 'inverted')
  $('#direction-arrow').textContent = next === 'inverted' ? '◀ Inverted' : '▶ Forward'
  $('#direction-note').textContent = next === 'inverted' ? 'Time runs backward' : 'Time runs forward'
}

const stopRunner = () => {
  clearTimeout(runner)
  runner = null
  document.body.classList.remove('turning')
}

const runThroughTime = (step) => {
  stopRunner()
  o.agent.pose.trajectory.pause()
  setDirection(step === 'rev' ? 'inverted' : 'forward')
  document.body.classList.add('turning')
  setTimeout(() => document.body.classList.remove('turning'), 900)
  if (step === 'rev') story('Inverted. Everything he did comes undone, newest first.')
  else story('Forward again, through the same past. Nothing he did changes.')

  const next = () => {
    const before = head.meta()
    if (step === 'fwd' && before.isHeadPresent) return finish(step)
    if (step === 'rev' && before.index <= origin) return finish(step)
    const index = head.seek(step)
    if (index === before.index) return finish(step)
    const after = head.meta()
    runner = setTimeout(next, Math.min(250, Math.abs(after.timestamp - before.timestamp)))
  }
  next()
}

const finish = (step) => {
  stopRunner()
  if (step === 'rev') story('Back where he started, before any of it happened. The past is still recorded: run it forward again.')
  else story('The present. Press Start over for a new run.')
  render()
}

// ---------------------------------------------------------------------------
// 8. Controls
// ---------------------------------------------------------------------------

const story = (text) => { $('#story').textContent = text }

const walkStory = () => moonwalking
  ? 'Moonwalking: the keyframes run backwards, but time still runs forward. Footprints still appear.'
  : 'Walking. Each keyframe publishes a pose, and its action moves him on.'

$('#walk').addEventListener('click', () => {
  const trajectory = o.agent.pose.trajectory
  if (trajectory().playing) {
    trajectory.pause()
    story('Paused.')
  } else {
    setDirection('forward')
    // play() runs through the keyframes in order; reverse() in reverse
    if (moonwalking) trajectory.reverse()
    else trajectory.play()
    story(walkStory())
  }
  render()
})

// trajectory.reverse() plays the keyframes in the opposite order. His legs
// move backwards, yet time still runs forward: footprints still appear and
// the vase still breaks. That's the difference from inversion
$('#moonwalk').addEventListener('click', () => {
  moonwalking = !moonwalking
  const trajectory = o.agent.pose.trajectory
  if (trajectory().playing) {
    if (moonwalking) trajectory.reverse()
    else trajectory.play()
    story(walkStory())
  } else {
    story(moonwalking ? 'Moonwalk is on. Press Walk.' : 'Moonwalk is off. Press Walk.')
  }
  render()
})

$('#invert').addEventListener('click', () => runThroughTime('rev'))
$('#replay').addEventListener('click', () => runThroughTime('fwd'))

$('#reset').addEventListener('click', () => {
  stopRunner()
  o.agent.pose.trajectory.pause()
  head.seek('present')
  // Put the world back, then make that the starting point: clear() drops
  // every frame and keeps the current states as the base
  o.agent.pose('contact-front')
  o.agent.x(startX)
  o.world.footprints([])
  o.world.vase('whole')
  chain.clear()
  setUpTrajectory()
  origin = head.meta().index
  setDirection('forward')
  story('Press Walk.')
})

// Dragging the scrubber moves the head by hand. Dragging left runs the
// inverted functions, dragging right the proceeding ones
const scrub = $('#scrub')
scrub.addEventListener('input', () => {
  stopRunner()
  o.agent.pose.trajectory.pause()
  const index = Number(scrub.value)
  setDirection(index < head.meta().index ? 'inverted' : 'forward')
  head.seek(index)
})

// ---------------------------------------------------------------------------
// 9. Readouts: the clock, the scrubber, and the drawer
// ---------------------------------------------------------------------------

const render = () => {
  const headMeta = head.meta()
  const meta = chain.meta()
  const empty = meta.lastIndex < meta.firstIndex
  const first = chain.find(origin + 1)
  const seconds = empty || first === undefined || headMeta.index <= origin ? 0 : (headMeta.timestamp - first.timestamp) / 1000
  $('#clock').textContent = `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(1).padStart(4, '0')}`

  scrub.min = origin
  scrub.max = Math.max(origin, meta.lastIndex)
  if (document.activeElement !== scrub) scrub.value = headMeta.index
  $('#scrub-label').textContent = `Frame ${headMeta.index} of ${meta.lastIndex}`

  const trajectory = o.agent.pose.trajectory()
  const running = runner !== null
  const atTurnstile = o.agent.x() >= turnstileX - 40
  $('#walk').textContent = trajectory.playing ? 'Pause' : 'Walk'
  $('#walk').disabled = running || !headMeta.isHeadPresent || atTurnstile
  $('#moonwalk').textContent = moonwalking ? 'Walk normally' : 'Moonwalk'
  $('#moonwalk').setAttribute('aria-pressed', String(moonwalking))
  $('#invert').disabled = running || headMeta.index <= origin
  $('#replay').disabled = running || headMeta.isHeadPresent

  $('#calls').innerHTML = ['agent > pose', 'agent > x', 'world > footprints', 'world > vase'].map((address) => {
    const [namespace, name] = address.split(' > ')
    const state = o[namespace][name]()
    const shownState = Array.isArray(state) ? `${state.length} prints` : String(state)
    const counts = calls[address] ?? { proceeding: 0, inverted: 0 }
    return `<tr><td>${address}</td><td>${shownState}</td><td>${counts.proceeding}</td><td><span class="inverted-count">${counts.inverted}</span></td></tr>`
  }).join('')

  $('#stats').innerHTML = `
    <dt>Frames recorded</dt><dd>${meta.length}</dd>
    <dt>Head at frame</dt><dd>${headMeta.index}${headMeta.isHeadPresent ? ' (the present)' : ''}</dd>
    <dt>Trajectory</dt><dd>${trajectory.playing ? 'playing' : 'paused'}, ${trajectory.direction === 'rev' ? 'reversed' : 'forward'}, keyframe ${trajectory.position + 1} of ${trajectory.order.length}</dd>`
}

setInterval(render, 100)
render()
requestAnimationFrame(animate)

// For poking at from the console
Object.assign(globalThis, { o, head, chain })
