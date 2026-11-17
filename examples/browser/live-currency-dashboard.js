// ===========================================================================
// Scenario desk: Soucouyant polychrony
//
// The live market is the main timeline, `o`. A scenario is made with
// chain.create(name): a new timeline that starts with everything the market
// had (its states and its recorded past) and then moves on its own. Each
// timeline here gets its own ticker, so a scenario keeps trading while you
// watch, with its own drift and volatility.
//
// What's shown, by section:
//   2. declarations shared by every timeline, finite states with
//      transition rules, and adding a stateObject to every timeline later
//   4. reading the newest state with a callback that returns nothing
//   5. chain.create() from main or from any scenario, branching from the
//      past with chain.purge(), alias() across timelines, chain.delete()
//   6. proceeding and inverted subscribers keeping sparklines in step with
//      each timeline's head
//   7. head.seek() by frame index, by time ('12.4s'), by alias, 'present'
//   8. chain.stateAt() to compare a scenario with the live market
//   9. chain.get(), chain.list() and each timeline's chain.meta()
// ===========================================================================

// npm run examples copies the library files into examples/
import { o, chain, head, alias } from '../soucouyant-polychrony.js'

// ---------------------------------------------------------------------------
// 1. Configure the main timeline
// ---------------------------------------------------------------------------

o.config({
  // Timelines always record; the main one records when asked
  persist: true,
  // Record every tick. By default two publishes to one stateObject within
  // 200ms merge into one frame
  mergeFidelity: 0
})

// About 7 ticks a second per timeline: keep roughly the last ten minutes.
// A new timeline inherits its parent's limit
chain.trailLimit(4000)

// ---------------------------------------------------------------------------
// 2. Declarations
//
// Declared once, on o. Every timeline has the same shape, each with its own
// values, including timelines made later
// ---------------------------------------------------------------------------

const pairs = [
  { key: 'eurUsd', label: 'EUR/USD', decimals: 5 },
  { key: 'gbpUsd', label: 'GBP/USD', decimals: 5 },
  { key: 'usdJpy', label: 'USD/JPY', decimals: 3 },
  { key: 'audUsd', label: 'AUD/USD', decimals: 5 },
  { key: 'usdChf', label: 'USD/CHF', decimals: 5 },
  { key: 'usdCad', label: 'USD/CAD', decimals: 5 }
]

const regimes = ['calm', 'volatile', 'crisis']
// Which regime can follow which: the transition rules, also used to
// disable the buttons for moves the rules forbid
const regimeMoves = { calm: ['volatile'], volatile: ['calm', 'crisis'], crisis: ['volatile'] }

o`fx > eurUsd`(1.08421)
  `fx > gbpUsd`(1.27154)
  `fx > usdJpy`(151.322)
  `fx > audUsd`(0.65841)
  `fx > usdChf`(0.88127)
  `fx > usdCad`(1.37118)
  // How wild the market is. Crisis is only reached through volatile, and
  // only left the same way
  `market > regime`('calm', regimes, {
    transitions: regimeMoves
  })
  `market > status`('open', ['open', 'paused'])

const volatility = { calm: 1, volatile: 2.6, crisis: 5.5 }

// ---------------------------------------------------------------------------
// 3. Scenario presets
//
// A preset is how a scenario's ticker leans: a drift per pair per tick (as
// a fraction of the rate), an opening regime, and an optional opening shock
// ---------------------------------------------------------------------------

const presets = {
  'Rate cut in Frankfurt': { regime: 'volatile', drift: { eurUsd: -0.00004 } },
  'Intervention in Tokyo': { regime: 'volatile', drift: { usdJpy: 0.000015 }, shock: { pair: 'usdJpy', percent: -2.2 } },
  'Risk-off': { regime: 'volatile', drift: { audUsd: -0.00005, usdJpy: -0.00003, usdChf: -0.00003 } },
  'Oil spike': { regime: 'calm', drift: { usdCad: -0.00004 } },
  'Quiet week': { regime: 'calm', drift: {} }
}

// Hues for scenario desks and lanes; the live market is ink
const hues = ['#6c55d1', '#0f8b8d', '#c47a10', '#c2417a', '#2f6fd6', '#5b8a1f']

// ---------------------------------------------------------------------------
// 4. Helpers
// ---------------------------------------------------------------------------

const $ = (selector, root = document) => root.querySelector(selector)
const sessionStart = head.startTime()
const secondsSince = (timestamp) => (timestamp - sessionStart) / 1000
const clockText = (seconds) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`
const format = (pair, rate) => rate.toFixed(pair.decimals)

// Normally distributed noise, for a believable random walk
const gaussian = () => Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random())

// The newest recorded state, whatever the head is showing. A publish
// callback receives the newest state; returning undefined publishes nothing
const newest = (stateObject) => {
  let state
  stateObject((current) => { state = current })
  return state
}

// Soucouyant reports through console.warn and console.error with a
// [soucouyant] prefix; show those in the drawer as well
for (const kind of ['warn', 'error']) {
  const original = console[kind].bind(console)
  console[kind] = (...args) => {
    original(...args)
    if (typeof args[0] === 'string' && args[0].startsWith('[soucouyant]')) {
      const item = document.createElement('li')
      item.textContent = args[0]
      $('#messages').prepend(item)
    }
  }
}

// ---------------------------------------------------------------------------
// 5. Desks: one per timeline
//
// A desk is plain JavaScript bookkeeping around a timeline: its hue, where
// it branched, how its ticker leans, and its elements. The timeline itself
// is `desk.timeline`, which acts like o (for the live market, it is o)
// ---------------------------------------------------------------------------

const desks = new Map()
let shockCount = 0

const createDesk = ({ name, timeline, parent, preset, hue }) => {
  const desk = {
    name,
    timeline,
    // A timeline's controls sit on its root: timeline.head, timeline.chain.
    // The main timeline's are the head and chain imports
    head: parent === null ? head : timeline.head,
    chain: parent === null ? chain : timeline.chain,
    parent,
    hue,
    drift: { ...(preset?.drift ?? {}) },
    // Where it branched: the parent's head at that moment
    branchedAt: parent === null ? sessionStart : parent.head.meta().timestamp,
    branchIndex: parent === null ? -1 : parent.head.meta().index,
    calls: { proceeding: 0, inverted: 0 },
    // Alias names that may be on this timeline: its own shocks, and its
    // parent's, whose frames it inherited when it branched
    aliases: parent === null ? [] : [...parent.aliases],
    sparklines: new Map(),
    element: null
  }
  desks.set(name, desk)
  buildDesk(desk)
  for (const pair of pairs) watchPair(desk, pair)
  watchMarket(desk)
  renderComposer()
  return desk
}

// Branch a scenario off a desk, at that desk's head
const branchScenario = (parent, name, presetName) => {
  const preset = presets[presetName]
  const wasPresent = parent.head.meta().isHeadPresent

  // chain.create() on any timeline branches off it. On the live market
  // that's the `chain` import; on a scenario it's scenario.chain
  const timeline = parent.chain.create(name)

  // The new timeline starts where its parent's head was. If that was in the
  // past, the frames after it were copied too; purge() removes them, so the
  // scenario really does begin from that moment
  if (!wasPresent) timeline.chain.purge()

  const desk = createDesk({ name, timeline, parent, preset, hue: hues[(desks.size - 1) % hues.length] })

  // The opening regime. Transition rules apply, so calm reaches crisis
  // through volatile
  if (preset.regime !== newest(timeline.market.regime)) timeline.market.regime(preset.regime)

  // The opening shock, named with alias(). Polychrony's alias() names the
  // next frame on whichever timeline records it: here, the scenario's
  if (preset.shock !== undefined) applyShock(desk, preset.shock.pair, preset.shock.percent)
  return desk
}

const applyShock = (desk, pairKey, percent) => {
  const pair = pairs.find((candidate) => candidate.key === pairKey)
  const label = `${pair.label} ${percent > 0 ? '+' : ''}${percent}% #${++shockCount}`
  desk.aliases.push(label)
  desk.timeline.fx[pairKey](alias(label, Number((newest(desk.timeline.fx[pairKey]) * (1 + percent / 100)).toFixed(pair.decimals))))
}

const deleteScenario = (desk) => {
  // Stops it sharing declarations, pauses its trajectories and closes its
  // storage. Scenarios branched from it carry on
  desk.chain.delete()
  desks.delete(desk.name)
  desk.element.remove()
  renderComposer()
}

// ---------------------------------------------------------------------------
// 6. Sparklines: a proceeding and an inverted subscriber per pair, per desk
//
// A sparkline keeps the frames it draws as { index, rate }. Going forward,
// the proceeding function appends the frames since its last point. Going
// back, the inverted function drops the points past the head. Neither
// redraws from scratch unless it has to
// ---------------------------------------------------------------------------

const sparkWidth = 160
const sparkLength = 90 // points drawn
const lookBack = 1400 // frames searched when (re)loading a sparkline

const watchPair = (desk, pair) => {
  const { timeline } = desk
  const stateObject = timeline.fx[pair.key]
  const tile = buildTile(desk, pair)
  const points = []

  // Fill from the chain: the newest points at or before the head
  const load = () => {
    const headIndex = desk.head.meta().index
    const from = Math.max(desk.chain.meta().firstIndex, headIndex - lookBack)
    const frames = headIndex < from ? [] : desk.chain.slice(from, headIndex, stateObject)
    points.length = 0
    for (const frame of frames.slice(-sparkLength)) points.push({ index: frame.index, rate: frame.state })
  }

  stateObject.sub(
    // Proceeding: a tick was published, or the head moved forward
    (rate, props) => {
      desk.calls.proceeding++
      const last = points.length === 0 ? -1 : points[points.length - 1].index
      if (props.index < 0 || props.index < last) {
        load() // a rebuild, or the oldest frames left memory
      } else {
        for (const frame of desk.chain.slice(last + 1, props.index, stateObject)) {
          points.push({ index: frame.index, rate: frame.state })
        }
        if (points.length > sparkLength) points.splice(0, points.length - sparkLength)
      }
      drawTile(pair, tile, rate, points)
    },
    // Inverted: the head moved back. Drop what's now in the future, and
    // top up from the chain if too little is left to draw
    (rate, props) => {
      desk.calls.inverted++
      while (points.length > 0 && points[points.length - 1].index > props.index) points.pop()
      if (points.length < sparkLength / 3) load()
      drawTile(pair, tile, rate, points)
    }
  )

  load()
  drawTile(pair, tile, stateObject(), points)
  desk.sparklines.set(pair.key, { tile, points })
}

// The regime and status controls follow whatever the head shows
const watchMarket = (desk) => {
  desk.timeline.market.regime.sub(() => renderControls(desk))
  desk.timeline.market.status.sub(() => renderControls(desk))
  renderControls(desk)
}

// ---------------------------------------------------------------------------
// 7. Drawing a desk
// ---------------------------------------------------------------------------

const deskTemplate = (desk) => `
  <div class="desk-head">
    <div>
      <h2>${desk.parent === null ? 'Live market' : desk.name}</h2>
      <div class="origin">${desk.parent === null
        ? 'The main timeline: o'
        : `Branched off ${desk.parent.parent === null ? 'the live market' : desk.parent.name} at ${clockText(secondsSince(desk.branchedAt))}`}</div>
    </div>
    <div class="desk-head-controls">
      <span class="regime" role="group" aria-label="Market regime">${regimes.map((regime) => `<button data-regime="${regime}">${regime[0].toUpperCase() + regime.slice(1)}</button>`).join('')}</span>
      <button data-action="pause"></button>
    </div>
  </div>
  <div class="tiles"></div>
  <div class="travel">
    <div class="track">
      <input type="range" aria-label="Move ${desk.name}'s head through its history">
      ${desk.parent === null ? '' : '<span class="branch-tick" title="Where this scenario branched"></span>'}
    </div>
    <button data-action="live">Back to live</button>
    <span class="where"></span>
  </div>
  <div class="marks"></div>
  <div class="desk-actions">
    <span class="shock">
      <select aria-label="Pair to shock">${pairs.map((pair) => `<option value="${pair.key}">${pair.label}</option>`).join('')}</select>
      <input type="number" step="0.1" value="-1.5" aria-label="Shock size in percent">
      <button data-action="shock">Shock</button>
    </span>
    <span class="past-note" hidden>Viewing the past: back to live to trade</span>
    <span class="spacer"></span>
    <button data-action="branch">Branch from here</button>
    ${desk.parent === null ? '' : '<button data-action="delete">Delete</button>'}
  </div>`

const buildDesk = (desk) => {
  const element = document.createElement('section')
  element.className = 'desk'
  element.style.setProperty('--hue', desk.hue)
  element.innerHTML = deskTemplate(desk)
  desk.element = element
  $('#desks').append(element)

  const { timeline } = desk
  const scrubber = $('input[type="range"]', element)

  element.addEventListener('click', (event) => {
    const regime = event.target.closest('[data-regime]')?.dataset.regime
    if (regime !== undefined) {
      // A finite state: an illegal move would throw, but the buttons for
      // illegal moves are disabled (see renderControls)
      timeline.market.regime(regime)
      return
    }
    const action = event.target.closest('[data-action]')?.dataset.action
    if (action === 'pause') timeline.market.status((status) => status === 'open' ? 'paused' : 'open')
    if (action === 'live') desk.head.seek('present')
    if (action === 'shock') applyShock(desk, $('.shock select', element).value, Number($('.shock input', element).value))
    if (action === 'delete') deleteScenario(desk)
    if (action === 'branch') {
      const name = uniqueName(`${desk.parent === null ? '' : `${desk.name} › `}What if`)
      branchScenario(desk, name, 'Quiet week')
    }
    const mark = event.target.closest('[data-alias]')?.dataset.alias
    // Seek by alias: the frame the shock recorded
    if (mark !== undefined) desk.head.seek(mark)
  })

  // The scrubber works in frame indices. Seeking a frame index moves the
  // head there; subscribers then run, inverted if it moved back
  scrubber.addEventListener('input', () => desk.head.seek(Number(scrubber.value)))
}

const buildTile = (desk, pair) => {
  const tile = document.createElement('div')
  tile.className = 'tile'
  tile.innerHTML = `
    <span class="pair">${pair.label}</span><span class="change"></span>
    <span class="rate"></span>
    <svg viewBox="0 0 ${sparkWidth} 34" preserveAspectRatio="none" aria-hidden="true">
      <path fill="none" stroke-width="1.5" vector-effect="non-scaling-stroke" stroke-linejoin="round"></path>
    </svg>
    <span class="vs-live"></span>`
  $('.tiles', desk.element).append(tile)
  return tile
}

const drawTile = (pair, tile, rate, points) => {
  $('.rate', tile).textContent = format(pair, rate)
  const first = points[0]?.rate ?? rate
  const change = (rate - first) / first * 100
  const changeElement = $('.change', tile)
  changeElement.textContent = `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`
  changeElement.className = `change ${change >= 0 ? 'up' : 'down'}`
  changeElement.title = `Change over the last ${points.length} ticks`

  let low = Infinity
  let high = -Infinity
  for (const point of points) {
    if (point.rate < low) low = point.rate
    if (point.rate > high) high = point.rate
  }
  const span = high - low || 1
  const step = sparkWidth / Math.max(1, sparkLength - 1)
  const offset = sparkLength - points.length
  const path = points.map((point, at) =>
    `${at === 0 ? 'M' : 'L'}${((offset + at) * step).toFixed(1)},${(31 - (point.rate - low) / span * 28).toFixed(1)}`).join('')
  const line = $('path', tile)
  line.setAttribute('d', path)
  line.setAttribute('stroke', change >= 0 ? 'var(--up)' : 'var(--down)')
}

// Compare each scenario with the live market's newest rates. stateAt()
// reads states at a position without moving the head
const renderVersusLive = () => {
  const live = chain.stateAt('present', ...pairs.map((pair) => o.fx[pair.key]))
  for (const desk of desks.values()) {
    for (const pair of pairs) {
      const sparkline = desk.sparklines.get(pair.key)
      if (sparkline === undefined) continue
      const element = $('.vs-live', sparkline.tile)
      if (desk.parent === null) {
        element.textContent = desk.head.meta().isHeadPresent ? '' : 'Looking back'
        continue
      }
      const liveRate = live[`fx > ${pair.key}`]
      const difference = (desk.timeline.fx[pair.key]() - liveRate) / liveRate * 100
      element.innerHTML = `<span class="${difference >= 0 ? 'up' : 'down'}">${difference >= 0 ? '+' : ''}${difference.toFixed(2)}%</span> vs live`
    }
  }
}

const renderControls = (desk) => {
  const { timeline, element } = desk
  const regime = timeline.market.regime()
  const paused = timeline.market.status() === 'paused'
  const atPresent = desk.head.meta().isHeadPresent
  const allowed = regimeMoves[regime]
  for (const button of element.querySelectorAll('[data-regime]')) {
    button.setAttribute('aria-pressed', String(button.dataset.regime === regime))
    // Only legal moves, and only at the present
    button.disabled = !atPresent || (button.dataset.regime !== regime && !allowed.includes(button.dataset.regime))
  }
  const pause = $('[data-action="pause"]', element)
  pause.textContent = paused ? 'Resume' : 'Pause'
  pause.disabled = !atPresent
  $('[data-action="shock"]', element).disabled = !atPresent
  $('.past-note', element).hidden = atPresent
  element.classList.toggle('in-the-past', !atPresent)
}

// The scrubber, the "where" line and the alias chips of every desk
const renderTravel = () => {
  for (const desk of desks.values()) {
    const { element } = desk
    const meta = desk.chain.meta()
    const headMeta = desk.head.meta()
    const scrubber = $('input[type="range"]', element)
    scrubber.min = meta.firstIndex
    scrubber.max = meta.lastIndex
    if (document.activeElement !== scrubber) scrubber.value = headMeta.index
    const tick = $('.branch-tick', element)
    if (tick !== null) {
      const at = (desk.branchIndex - meta.firstIndex) / Math.max(1, meta.lastIndex - meta.firstIndex)
      tick.hidden = at < 0
      tick.style.left = `calc(${(at * 100).toFixed(2)}% - 1px)`
    }
    const seconds = secondsSince(Date.now())
    $('.where', element).textContent = headMeta.isHeadPresent
      ? `Live: frame ${headMeta.index}`
      : `Showing ${clockText(secondsSince(headMeta.timestamp))}, ${(seconds - secondsSince(headMeta.timestamp)).toFixed(1)}s ago (frame ${headMeta.index})`
    $('[data-action="live"]', element).disabled = headMeta.isHeadPresent

    // Shocks are aliased frames. chain.find(alias) is undefined once the
    // frame has gone (purged, or out of memory), so its chip goes too
    const aliases = desk.aliases.filter((name) => desk.chain.find(name) !== undefined)
    const marks = $('.marks', element)
    if (marks.dataset.aliases !== aliases.join('|')) {
      marks.dataset.aliases = aliases.join('|')
      marks.replaceChildren(...aliases.map((name) => {
        const button = document.createElement('button')
        button.dataset.alias = name
        button.textContent = name
        button.title = `head.seek('${name}')`
        return button
      }))
    }
  }
}

// ---------------------------------------------------------------------------
// 8. The branch map
//
// x is session time. Each timeline is a lane; a scenario's lane starts with
// a curve from its parent's lane at the moment it branched. The dot is the
// head. Clicking a lane seeks that timeline to the time clicked, with a time
// string: head.seek('42.5s')
// ---------------------------------------------------------------------------

const map = $('#map')
const laneHeight = 30
// Room for lane names: less on a narrow screen
const mapLeftFor = (width) => Math.min(190, Math.round(width * 0.3))
const mapRight = 18

const shorten = (text, length) => text.length > length ? `${text.slice(0, length - 1)}…` : text

const renderMap = () => {
  const all = [...desks.values()]
  const width = map.clientWidth || 1000
  const mapLeft = mapLeftFor(width)
  const height = all.length * laneHeight + 24
  map.setAttribute('viewBox', `0 0 ${width} ${height}`)
  map.setAttribute('height', height)
  const now = secondsSince(Date.now())
  const span = Math.max(60, now)
  const x = (seconds) => mapLeft + Math.max(0, seconds) / span * (width - mapLeft - mapRight)
  const laneOf = new Map(all.map((desk, at) => [desk, at * laneHeight + 16]))

  let svg = ''
  // A grid line every 30 seconds
  for (let second = 0; second <= span; second += span > 600 ? 120 : 30) {
    svg += `<line x1="${x(second)}" x2="${x(second)}" y1="0" y2="${height - 14}" stroke="var(--rule)"/>`
    svg += `<text class="axis" x="${x(second)}" y="${height - 2}" text-anchor="middle">${clockText(second)}</text>`
  }
  for (const desk of all) {
    const y = laneOf.get(desk)
    const start = secondsSince(desk.branchedAt)
    const headMeta = desk.head.meta()
    const headSeconds = headMeta.isHeadPresent ? now : secondsSince(headMeta.timestamp)
    svg += `<text class="lane-label" x="0" y="${y + 4}" fill="${desk.hue}">${shorten(desk.parent === null ? 'Live market' : desk.name, Math.floor(mapLeft / 7.2))}</text>`
    if (desk.parent !== null && desks.has(desk.parent.name)) {
      const parentY = laneOf.get(desk.parent)
      const bend = Math.min(40, x(now) - x(start))
      svg += `<path d="M${x(start)},${parentY} C${x(start) + bend / 2},${parentY} ${x(start) + bend / 2},${y} ${x(start) + bend},${y}" fill="none" stroke="${desk.hue}" stroke-width="2"/>`
      svg += `<line x1="${x(start) + bend}" x2="${x(now)}" y1="${y}" y2="${y}" stroke="${desk.hue}" stroke-width="2"/>`
    } else {
      svg += `<line x1="${x(start)}" x2="${x(now)}" y1="${y}" y2="${y}" stroke="${desk.hue}" stroke-width="2"/>`
    }
    svg += `<circle cx="${x(headSeconds)}" cy="${y}" r="${headMeta.isHeadPresent ? 4 : 6}" fill="${headMeta.isHeadPresent ? desk.hue : '#fff'}" stroke="${desk.hue}" stroke-width="2" pointer-events="none"/>`
  }
  map.innerHTML = svg
  $('#map-status').textContent = `${desks.size} timeline${desks.size === 1 ? '' : 's'}`
}

// The map redraws four times a second, so work out the lane and the time
// from where the pointer went down rather than from the element under it
map.addEventListener('pointerdown', (event) => {
  const box = map.getBoundingClientRect()
  const scale = map.clientWidth / box.width
  const lane = Math.round(((event.clientY - box.top) * scale - 16) / laneHeight)
  const desk = [...desks.values()][lane]
  if (desk === undefined) return
  const width = map.clientWidth
  const mapLeft = mapLeftFor(width)
  const span = Math.max(60, secondsSince(Date.now()))
  const seconds = ((event.clientX - box.left) * scale - mapLeft) / (width - mapLeft - mapRight) * span
  if (seconds < 0) return
  // A time string counts from the session start (seekTime: 'session'),
  // the same on every timeline
  desk.head.seek(`${seconds.toFixed(1)}s`)
})

// ---------------------------------------------------------------------------
// 9. The ticker
//
// Every 140ms, each open timeline moves one random pair. Publishing a
// callback builds the next rate from the newest recorded rate, so a timeline
// keeps trading while its head is parked in the past
// ---------------------------------------------------------------------------

const tick = () => {
  for (const desk of desks.values()) {
    const { timeline } = desk
    if (newest(timeline.market.status) !== 'open') continue
    const pair = pairs[Math.floor(Math.random() * pairs.length)]
    const sigma = 0.00009 * volatility[newest(timeline.market.regime)]
    const drift = desk.drift[pair.key] ?? 0
    timeline.fx[pair.key]((rate) => Number((rate * (1 + drift + sigma * gaussian())).toFixed(pair.decimals)))
  }
}
setInterval(tick, 140)

// ---------------------------------------------------------------------------
// 10. Composer, adding a pair, and the drawer
// ---------------------------------------------------------------------------

const uniqueName = (base) => {
  let name = base
  // chain.get() finds a timeline by name
  for (let n = 2; chain.get(name) !== undefined || desks.has(name); n++) name = `${base} ${n}`
  return name
}

const presetSelect = $('#preset')
presetSelect.innerHTML = Object.keys(presets).map((name) => `<option>${name}</option>`).join('')

const renderComposer = () => {
  const parentSelect = $('#parent')
  const chosen = parentSelect.value
  parentSelect.innerHTML = [...desks.values()].map((desk) =>
    `<option value="${desk.name}">${desk.parent === null ? 'the live market' : desk.name}</option>`).join('')
  if (desks.has(chosen)) parentSelect.value = chosen
}

$('#composer').addEventListener('submit', (event) => {
  event.preventDefault()
  const parent = desks.get($('#parent').value)
  const name = uniqueName($('#scenario-name').value.trim() || presetSelect.value)
  branchScenario(parent, name, presetSelect.value)
  $('#scenario-name').value = ''
})

// Declaring on o adds the stateObject to every timeline: one shape
$('#add-pair').addEventListener('click', (event) => {
  const pair = { key: 'nzdUsd', label: 'NZD/USD', decimals: 5 }
  o`fx > nzdUsd`(0.60125)
  pairs.push(pair)
  for (const desk of desks.values()) {
    watchPair(desk, pair)
    $('.shock select', desk.element).append(new Option(pair.label, pair.key))
  }
  event.target.disabled = true
})

const renderHood = () => {
  $('#hood-rows').innerHTML = [...desks.values()].map((desk) => {
    const meta = desk.chain.meta()
    const headMeta = desk.head.meta()
    return `<tr>
      <td style="color: ${desk.hue}">${desk.parent === null ? 'o (main)' : desk.name}</td>
      <td>${desk.parent === null ? '–' : desk.parent.parent === null ? 'o' : desk.parent.name}</td>
      <td>${meta.framesInMemory}</td>
      <td>${headMeta.index} / ${meta.lastIndex}</td>
      <td>${desk.calls.proceeding}</td>
      <td>${desk.calls.inverted}</td>
    </tr>`
  }).join('')
  $('#list-result').textContent = JSON.stringify(chain.list())
}

// ---------------------------------------------------------------------------
// 11. Start: the live market's desk, one scenario to show the idea, and a
// redraw loop for the parts that change with the clock
// ---------------------------------------------------------------------------

createDesk({ name: 'main', timeline: o, parent: null, preset: null, hue: 'var(--ink)' })

// Let the market run a few seconds first, so the scenario has a past
setTimeout(() => branchScenario(desks.get('main'), 'Rate cut in Frankfurt', 'Rate cut in Frankfurt'), 4000)

const redraw = () => {
  $('#session-clock').textContent = clockText(secondsSince(Date.now()))
  renderTravel()
  renderVersusLive()
  renderMap()
  renderHood()
}
setInterval(redraw, 250)
redraw()

// For poking at from the console
Object.assign(globalThis, { o, chain, head, desks })
