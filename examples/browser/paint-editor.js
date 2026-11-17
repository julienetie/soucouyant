// ===========================================================================
// Atelier: Photoshop-style history with Soucouyant temporal
//
// The idea in one paragraph: the picture is never stored. Each thing you do
// (a brush stroke, a rectangle, a fill) is published to one stateObject,
// `o.paint.operation`, and temporal records every publish as a frame on the
// chain. The canvas is whatever you get by replaying those frames up to the
// head. Undo, redo, the history panel, the scrubber and bookmarks are all
// just the head moving along the chain. With IndexedDB storage the frames
// survive a reload, so the history does too.
// ===========================================================================

// npm run examples copies the library files into examples/
import { o, head, chain, alias } from '../soucouyant-temporal.js'
import { indexedDbStorage } from '../storage/indexeddb.js'

// ---------------------------------------------------------------------------
// 1. Configure history
// ---------------------------------------------------------------------------

o.config({
  // Record every publish as a frame. Without this there is no chain
  persist: true,

  // By default, a stateObject that publishes twice within 200ms overwrites
  // its last frame. Two quick strokes are still two steps, so record all
  mergeFidelity: 0,

  // Write every frame to IndexedDB, in batches, and on page hide
  databaseName: 'soucouyant-paint-editor',
  offlineStorage: { mode: 'all', adapter: indexedDbStorage() }
})

// Drawing after an undo throws away the steps ahead of the head, like every
// editor does. Without this, the redo steps would stay on the chain
chain.purge('auto')

// ---------------------------------------------------------------------------
// 2. Declare state
//
// One stateObject. Its state is the most recent operation, and its frames,
// in order, are the document
// ---------------------------------------------------------------------------

o`paint > operation`(null)

// Tool settings live in a plain object on purpose. Everything published to
// `o` is recorded while persist is on, so a stateObject here would put
// "changed brush size" in the history and undo would undo it. Photoshop's
// history holds changes to the document, not to the brush
const brush = { tool: 'brush', colour: '#2346d8', size: 8, solidShapes: false }

// ---------------------------------------------------------------------------
// 3. Painting operations
//
// An operation is a small plain object. Replaying the same operations in the
// same order always gives the same pixels, which is what lets the canvas be
// rebuilt from the chain at any point
// ---------------------------------------------------------------------------

const canvas = document.querySelector('#canvas')
const overlay = document.querySelector('#overlay')
const context = canvas.getContext('2d', { willReadFrequently: true })
const overlayContext = overlay.getContext('2d')
const paper = '#ffffff'

const labels = {
  new: 'New canvas',
  stroke: 'Brush',
  eraser: 'Eraser',
  line: 'Line',
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  fill: 'Fill',
  clear: 'Clear canvas',
  mark: 'Bookmark'
}

const labelOf = (operation) => {
  if (operation.type === 'mark') return operation.name
  if (operation.type === 'stroke' && operation.eraser) return labels.eraser
  return labels[operation.type]
}

// Freehand points are stored flat, [x0, y0, x1, y1, ...], as whole pixels.
// Smaller frames mean less to write to IndexedDB
const drawStroke = (target, { points, colour, size }) => {
  target.lineCap = 'round'
  target.lineJoin = 'round'
  target.strokeStyle = colour
  target.fillStyle = colour
  target.lineWidth = size
  if (points.length === 2) {
    target.beginPath()
    target.arc(points[0], points[1], size / 2, 0, Math.PI * 2)
    target.fill()
    return
  }
  // A curve through the midpoints between samples: smooth, and it still
  // passes near every point the pointer reported
  target.beginPath()
  target.moveTo(points[0], points[1])
  for (let i = 2; i < points.length - 2; i += 2) {
    const middleX = (points[i] + points[i + 2]) / 2
    const middleY = (points[i + 1] + points[i + 3]) / 2
    target.quadraticCurveTo(points[i], points[i + 1], middleX, middleY)
  }
  target.lineTo(points[points.length - 2], points[points.length - 1])
  target.stroke()
}

const drawShape = (target, { type, x1, y1, x2, y2, colour, size, solid }) => {
  target.lineCap = 'round'
  target.lineJoin = 'round'
  target.strokeStyle = colour
  target.fillStyle = colour
  target.lineWidth = size
  target.beginPath()
  if (type === 'line') {
    target.moveTo(x1, y1)
    target.lineTo(x2, y2)
    target.stroke()
    return
  }
  if (type === 'rect') {
    target.rect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1))
  } else {
    target.ellipse((x1 + x2) / 2, (y1 + y2) / 2, Math.abs(x2 - x1) / 2, Math.abs(y2 - y1) / 2, 0, 0, Math.PI * 2)
  }
  if (solid) target.fill()
  else target.stroke()
}

// Bucket fill: a scanline flood fill over the pixels. It reads the canvas as
// it is when the fill replays, so it fills the same region every time
const hexToPixel = (hex) => {
  const value = parseInt(hex.slice(1), 16)
  // ImageData is RGBA in memory; read as a little-endian Uint32 that's ABGR
  return (255 << 24 | (value & 0xff) << 16 | (value >> 8 & 0xff) << 8 | value >> 16) >>> 0
}

const floodFill = (target, { x, y, colour }) => {
  const { width, height } = target.canvas
  const image = target.getImageData(0, 0, width, height)
  const pixels = new Uint32Array(image.data.buffer)
  const start = pixels[y * width + x]
  const replacement = hexToPixel(colour)
  if (start === replacement) return

  // Antialiased edges differ slightly from the colour they border, so match
  // within a small tolerance per channel
  const tolerance = 48
  const matches = (pixel) =>
    Math.abs((pixel & 0xff) - (start & 0xff)) <= tolerance &&
    Math.abs((pixel >> 8 & 0xff) - (start >> 8 & 0xff)) <= tolerance &&
    Math.abs((pixel >> 16 & 0xff) - (start >> 16 & 0xff)) <= tolerance &&
    Math.abs((pixel >>> 24) - (start >>> 24)) <= tolerance

  const filled = new Uint8Array(width * height)
  const stack = [x, y]
  while (stack.length > 0) {
    const row = stack.pop()
    let column = stack.pop()
    // Walk left to the edge of the region, then fill rightwards
    while (column > 0 && !filled[row * width + column - 1] && matches(pixels[row * width + column - 1])) column--
    let above = false
    let below = false
    for (; column < width; column++) {
      const at = row * width + column
      if (filled[at] || !matches(pixels[at])) break
      pixels[at] = replacement
      filled[at] = 1
      // Queue the first matching pixel of each run above and below
      if (row > 0) {
        const up = at - width
        const open = !filled[up] && matches(pixels[up])
        if (open && !above) stack.push(column, row - 1)
        above = open
      }
      if (row < height - 1) {
        const down = at + width
        const open = !filled[down] && matches(pixels[down])
        if (open && !below) stack.push(column, row + 1)
        below = open
      }
    }
  }
  target.putImageData(image, 0, 0)
}

const drawOperation = (target, operation) => {
  switch (operation.type) {
    case 'new':
    case 'clear':
      target.fillStyle = paper
      target.fillRect(0, 0, target.canvas.width, target.canvas.height)
      break
    case 'stroke':
      // The eraser is a brush that paints with the paper colour
      drawStroke(target, operation.eraser ? { ...operation, colour: paper } : operation)
      break
    case 'line':
    case 'rect':
    case 'ellipse':
      drawShape(target, operation)
      break
    case 'fill':
      floodFill(target, operation)
      break
    // 'mark' is a bookmark: it changes nothing on the canvas
  }
}

// ---------------------------------------------------------------------------
// 4. The canvas follows the head
//
// `paintedUpTo` is the frame index of the last operation on the canvas.
// Moving forward only needs the new operations drawn on top. Moving back
// can't un-draw pixels, so it repaints from the start up to the head
// ---------------------------------------------------------------------------

let paintedUpTo = -1

// The operations between two frame indices, in order. Frames hidden in the
// history panel are marked ignored on the chain, and are left out here too
const operationsBetween = (from, to) =>
  chain.slice(from, to, o.paint.operation).filter((frame) => !frame.ignored && frame.state !== null)

const repaintToHead = () => {
  const started = performance.now()
  const to = head.meta().index
  const operations = operationsBetween(chain.meta().firstIndex, to)
  context.clearRect(0, 0, canvas.width, canvas.height)
  for (const frame of operations) drawOperation(context, frame.state)
  paintedUpTo = to
  return { count: operations.length, time: performance.now() - started }
}

const drawNewOperations = () => {
  const to = head.meta().index
  // A rebuild (restore, clear) can land behind what's painted: repaint
  if (to < paintedUpTo) return repaintToHead()
  const started = performance.now()
  const operations = operationsBetween(paintedUpTo + 1, to)
  for (const frame of operations) drawOperation(context, frame.state)
  paintedUpTo = to
  return { count: operations.length, time: performance.now() - started }
}

// ---------------------------------------------------------------------------
// 5. Subscribe: the proceeding function and the inverted function
//
// Notifications are batched to the next animation frame (the browser
// default, `execution: 'async-frame'`), and a seek of many steps is one call
// with the destination state. So neither function assumes "one step": each
// brings the canvas to wherever the head now is
// ---------------------------------------------------------------------------

const lastCall = document.querySelector('#last-call')
const describeCall = (name, { count, time }, verb) => {
  lastCall.innerHTML = `<b>${name}</b> ${verb} ${count} operation${count === 1 ? '' : 's'} in ${time.toFixed(1)} ms`
}

o.paint.operation.sub(
  // Proceeding: a new operation was published, or the head moved forward
  () => {
    describeCall('Proceeding', drawNewOperations(), 'drew')
    render()
  },
  // Inverted: the head moved back (undo, a click on an earlier step, the
  // scrubber dragged left), so repaint up to the head
  () => {
    describeCall('Inverted', repaintToHead(), 'repainted')
    render()
  }
)

// The chain's own subscription: every recorded frame, in batches. Here it
// feeds the list of recorded frames in the drawer
const feed = document.querySelector('#feed')
chain.sub((frames) => {
  for (const frame of frames) {
    if (frame.identity !== 'paint > operation' || frame.state === null) continue
    const item = document.createElement('li')
    const size = JSON.stringify(frame.state).length
    item.textContent = `Frame ${frame.index} recorded: ${labelOf(frame.state)}, ${size} bytes`
    feed.prepend(item)
  }
  while (feed.children.length > 40) feed.lastElementChild.remove()
}, 'recorded-feed')

// ---------------------------------------------------------------------------
// 6. Publishing operations from the pointer
//
// While the pointer is down, the stroke is drawn on the overlay only. On
// release it's published once, becoming one frame and one history step
// ---------------------------------------------------------------------------

let drawing = null

const toCanvasPoint = (event) => {
  const box = overlay.getBoundingClientRect()
  return [
    Math.round((event.clientX - box.left) * overlay.width / box.width),
    Math.round((event.clientY - box.top) * overlay.height / box.height)
  ]
}

const previewOperation = () => {
  overlayContext.clearRect(0, 0, overlay.width, overlay.height)
  if (drawing === null) return
  // The eraser previews in a light grey so you can see where it went
  const operation = drawing.type === 'stroke' && drawing.eraser
    ? { ...drawing, colour: '#c9cedb' }
    : drawing
  if (operation.type === 'stroke') drawStroke(overlayContext, operation)
  else drawShape(overlayContext, operation)
}

overlay.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return
  const [x, y] = toCanvasPoint(event)
  const { tool, colour, size, solidShapes } = brush

  // A fill is complete on click: publish it straight away
  if (tool === 'fill') {
    o.paint.operation({ type: 'fill', x, y, colour })
    return
  }

  overlay.setPointerCapture(event.pointerId)
  drawing = tool === 'brush' || tool === 'eraser'
    ? { type: 'stroke', eraser: tool === 'eraser', colour, size, points: [x, y] }
    : { type: tool, x1: x, y1: y, x2: x, y2: y, colour, size, solid: solidShapes }
  previewOperation()
})

overlay.addEventListener('pointermove', (event) => {
  if (drawing === null) return
  if (drawing.type === 'stroke') {
    // Coalesced events are every sample since the last frame, so fast
    // strokes stay smooth
    const samples = event.getCoalescedEvents ? event.getCoalescedEvents() : [event]
    for (const sample of samples) drawing.points.push(...toCanvasPoint(sample))
  } else {
    [drawing.x2, drawing.y2] = toCanvasPoint(event)
  }
  previewOperation()
})

const finishDrawing = () => {
  if (drawing === null) return
  const operation = drawing
  drawing = null
  previewOperation()
  // This publish is the whole undo step. If the head is in the past,
  // chain.purge('auto') removes the steps ahead first
  o.paint.operation(operation)
}

overlay.addEventListener('pointerup', finishDrawing)
overlay.addEventListener('pointercancel', finishDrawing)

// ---------------------------------------------------------------------------
// 7. History: undo, redo, the panel, the scrubber and bookmarks
//
// All of these move the same head. None of them touch the canvas directly:
// the subscription above does that
// ---------------------------------------------------------------------------

// Every operation step currently on the chain, oldest first, including the
// ones ahead of the head that redo would bring back
const steps = () => chain.slice(chain.meta().firstIndex, 'present', o.paint.operation)
  .filter((frame) => frame.state !== null)

// The step the head is on: the newest step at or before the head
const currentStepIndex = (all, headIndex) => {
  let current = 0
  for (let i = 0; i < all.length; i++) {
    if (all[i].index <= headIndex) current = i
  }
  return current
}

const undo = () => {
  const all = steps()
  // The first step is the blank canvas; there's nothing before it to show
  if (all.length === 0 || head.meta().index <= all[0].index) return
  head.seek('rev')
}

const redo = () => {
  if (!head.meta().isHeadPresent) head.seek('fwd')
}

document.querySelector('#undo').addEventListener('click', undo)
document.querySelector('#redo').addEventListener('click', redo)
document.querySelector('#first').addEventListener('click', () => {
  const all = steps()
  if (all.length > 0) head.seek(all[0].index)
})
document.querySelector('#present').addEventListener('click', () => head.seek('present'))

// The scrubber works in steps, not frame indices: purged frames leave gaps
// in the numbering, and a step is what a person counts
const scrub = document.querySelector('#scrub')
scrub.addEventListener('input', () => {
  const step = steps()[Number(scrub.value)]
  if (step !== undefined) head.seek(step.index)
})

// Bookmarks are aliases. The bookmark is a step of its own that draws
// nothing, published with alias(name), so head.seek(name) finds it
document.querySelector('#bookmark-form').addEventListener('submit', (event) => {
  event.preventDefault()
  const input = document.querySelector('#bookmark-name')
  let name = input.value.trim() || `Bookmark ${bookmarkFrames().length + 1}`
  // An alias names one frame; pick a free name, and avoid the words the head
  // understands ('first', 'present', '>3', '2.5s' and so on)
  while (chain.find(name) !== undefined || /^(fwd|rev|first|present|[<>]\d+|-?\d+(\.\d+)?(ms|s|m|h)?)$/.test(name)) name += ' ·'
  o.paint.operation(alias(name, { type: 'mark', name }))
  input.value = ''
})

const bookmarkFrames = () => steps().filter((frame) => frame.alias !== null)

// Keyboard shortcuts, as in any editor
const toolKeys = { b: 'brush', e: 'eraser', l: 'line', r: 'rect', o: 'ellipse', f: 'fill' }
document.addEventListener('keydown', (event) => {
  if (event.target instanceof HTMLInputElement && event.target.type === 'text') return
  const key = event.key.toLowerCase()
  if ((event.ctrlKey || event.metaKey) && key === 'z') {
    event.preventDefault()
    if (event.shiftKey) redo()
    else undo()
  } else if ((event.ctrlKey || event.metaKey) && key === 'y') {
    event.preventDefault()
    redo()
  } else if (!event.ctrlKey && !event.metaKey && toolKeys[key] !== undefined) {
    selectTool(toolKeys[key])
  }
})

// ---------------------------------------------------------------------------
// 8. Rendering the panel, scrubber and stats from the chain
// ---------------------------------------------------------------------------

const historyList = document.querySelector('#history')
const historyCount = document.querySelector('#history-count')
const scrubPosition = document.querySelector('#scrub-position')
const sheet = document.querySelector('#sheet')
const undoButton = document.querySelector('#undo')
const redoButton = document.querySelector('#redo')
const bookmarkList = document.querySelector('#bookmark-list')

const swatchColourOf = (operation) => {
  if (operation.type === 'new' || operation.type === 'clear' || operation.eraser) return paper
  if (operation.type === 'mark') return 'transparent'
  return operation.colour
}

const render = () => {
  const all = steps()
  const { index: headIndex, isHeadPresent } = head.meta()
  const current = currentStepIndex(all, headIndex)

  // The history list, rebuilt each time. It's at most a few hundred rows,
  // and keeping it in step with purges is simpler this way
  const rows = all.map((frame, position) => {
    const row = document.createElement('li')
    row.className = 'step'
    if (position === current) row.classList.add('current')
    if (position > current) row.classList.add('ahead')
    if (frame.ignored) row.classList.add('hidden-step')
    if (frame.state.type === 'mark') row.classList.add('bookmark')
    row.tabIndex = 0
    row.dataset.frame = frame.index

    const dot = document.createElement('span')
    dot.className = 'dot'
    dot.style.background = swatchColourOf(frame.state)
    const name = document.createElement('span')
    name.className = 'name'
    name.textContent = labelOf(frame.state)
    const number = document.createElement('span')
    number.className = 'number'
    number.textContent = position + 1
    row.append(dot, name, number)

    // Every step but the blank canvas can be hidden: the frame stays on the
    // chain, marked ignored, and undo, redo and the repaint skip it
    if (frame.state.type !== 'new' && frame.state.type !== 'mark') {
      const eye = document.createElement('button')
      eye.className = 'eye'
      eye.dataset.toggle = frame.index
      eye.textContent = frame.ignored ? 'Show' : 'Hide'
      eye.setAttribute('aria-label', `${frame.ignored ? 'Show' : 'Hide'} step ${position + 1}`)
      row.append(eye)
    } else {
      row.append(document.createElement('span'))
    }
    return row
  })
  historyList.replaceChildren(...rows)
  historyList.querySelector('.current')?.scrollIntoView({ block: 'nearest' })
  historyCount.textContent = `${all.length} step${all.length === 1 ? '' : 's'}`

  scrub.max = Math.max(0, all.length - 1)
  scrub.value = current
  scrubPosition.textContent = `Step ${current + 1} of ${all.length}`
  sheet.classList.toggle('in-the-past', !isHeadPresent)
  undoButton.disabled = current === 0
  redoButton.disabled = isHeadPresent

  bookmarkList.replaceChildren(...bookmarkFrames().map((frame) => {
    const button = document.createElement('button')
    button.textContent = frame.alias
    button.title = `Go to the bookmark "${frame.alias}"`
    button.addEventListener('click', () => head.seek(frame.alias))
    return button
  }))

  renderStats()
}

const renderStats = () => {
  const meta = chain.meta()
  document.querySelector('#stat-head').textContent = head.meta().index
  document.querySelector('#stat-present').textContent = meta.lastIndex
  document.querySelector('#stat-memory').textContent = meta.framesInMemory
  document.querySelector('#stat-storage').textContent = meta.framesInStorage
}

// One listener for the whole list: a click on a row seeks the head to that
// step's frame; a click on Hide or Show toggles whether the frame is ignored
historyList.addEventListener('click', (event) => {
  const toggle = event.target.closest('[data-toggle]')
  if (toggle !== null) {
    const index = Number(toggle.dataset.toggle)
    const frame = chain.find(index)
    head.ignoreFrame(index, frame.ignored ? 'stop' : undefined)
    // Hiding a step changes the picture without moving the head, so no
    // subscriber runs; repaint here
    if (index <= head.meta().index) describeCall('Hide/Show', repaintToHead(), 'repainted')
    render()
    return
  }
  const row = event.target.closest('[data-frame]')
  if (row !== null) head.seek(Number(row.dataset.frame))
})

historyList.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && event.target.dataset.frame !== undefined) head.seek(Number(event.target.dataset.frame))
})

// ---------------------------------------------------------------------------
// 9. Tools
// ---------------------------------------------------------------------------

const toolButtons = document.querySelectorAll('[data-tool]')
const selectTool = (tool) => {
  brush.tool = tool
  for (const button of toolButtons) button.setAttribute('aria-pressed', String(button.dataset.tool === tool))
}
for (const button of toolButtons) button.addEventListener('click', () => selectTool(button.dataset.tool))

const palette = ['#171a21', '#ffffff', '#2346d8', '#16a3c7', '#1f9d55', '#a3c93a', '#f2c230', '#ef7d22', '#d93a3a', '#d6418f', '#7a4fd6', '#8a5a3b']
const swatches = document.querySelector('#swatches')
const customColour = document.querySelector('#custom-colour')
const selectColour = (colour) => {
  brush.colour = colour
  customColour.value = colour
  for (const swatch of swatches.children) swatch.setAttribute('aria-pressed', String(swatch.dataset.colour === colour))
}
for (const colour of palette) {
  const swatch = document.createElement('button')
  swatch.className = 'swatch'
  swatch.style.background = colour
  swatch.dataset.colour = colour
  swatch.title = colour
  swatch.addEventListener('click', () => selectColour(colour))
  swatches.append(swatch)
}
customColour.addEventListener('input', () => selectColour(customColour.value))
selectColour(brush.colour)

const sizeInput = document.querySelector('#size')
sizeInput.addEventListener('input', () => {
  brush.size = Number(sizeInput.value)
  document.querySelector('#size-value').textContent = brush.size
})
document.querySelector('#fill-shapes').addEventListener('change', (event) => {
  brush.solidShapes = event.target.checked
})

// ---------------------------------------------------------------------------
// 10. New canvas: drop the history, in memory and in IndexedDB
// ---------------------------------------------------------------------------

const newCanvasButton = document.querySelector('#new-canvas')
let confirmTimer = null
newCanvasButton.addEventListener('click', async () => {
  // A second click within three seconds confirms: this can't be undone
  if (confirmTimer === null) {
    newCanvasButton.textContent = 'Discard all history?'
    confirmTimer = setTimeout(() => {
      confirmTimer = null
      newCanvasButton.textContent = 'New canvas'
    }, 3000)
    return
  }
  clearTimeout(confirmTimer)
  confirmTimer = null
  newCanvasButton.textContent = 'New canvas'
  // clear() makes the current states the base and drops every frame;
  // storage: true empties IndexedDB too
  await chain.clear({ storage: true })
  o.paint.operation({ type: 'new' })
})

// ---------------------------------------------------------------------------
// 11. Start: load history from IndexedDB, or begin a blank canvas
// ---------------------------------------------------------------------------

const saveState = document.querySelector('#save-state')

// Remembers the head between visits, so a reload after three undos comes
// back three steps back. A per-browser convenience, so localStorage is fine
const headKey = 'soucouyant-paint-editor:head'
const rememberHead = () => {
  try { localStorage.setItem(headKey, String(head.meta().index)) } catch {}
}
addEventListener('pagehide', rememberHead)

// restore() loads the newest frames from IndexedDB into memory and moves the
// head to the present. The subscription above then repaints everything
const restored = await chain.restore()

if (steps().length === 0) {
  o.paint.operation({ type: 'new' })
  saveState.textContent = 'New canvas: your steps are saved as you go'
} else {
  let remembered = NaN
  try { remembered = Number(localStorage.getItem(headKey) ?? NaN) } catch {}
  if (Number.isInteger(remembered) && remembered < head.meta().index) head.seek(remembered)
  saveState.textContent = `Restored ${restored} frames from IndexedDB`
}

// Keep the head remembered and the stats fresh. Frames reach IndexedDB in
// batches about once a second, so the storage count lags a moment behind
setInterval(() => {
  rememberHead()
  renderStats()
}, 1000)

// For poking at from the console
Object.assign(globalThis, { o, head, chain })
