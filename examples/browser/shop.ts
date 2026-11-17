// ===========================================================================
// Pepperpot Pantry: the Soucouyant core, used as fully as a shop allows
//
// The TypeScript version of shop.js. No page loads this file: shop.html runs
// shop.js. It's here to show the same app written in TypeScript, and
// `npm run test:types` checks it compiles.
//
// Only `soucouyant-core.js` is loaded: no history. Everything the page shows
// is drawn by subscriptions, and every user action is a publish.
//
// What's here, by section:
//   2. a typed object declaration; finite states with transition rules;
//      freeze(o)
//   4. pending, and an async callback publish that loads the catalogue
//   5. subscriptions with and without props, props.rev, sub.withProps,
//      named references and unsub
//   7. an async callback lock and asyncLockTimeout (discount codes)
//   8. NaN being ignored (the tip field)
//   9. mutex.lock(), mutex.buffer, release(value) and release(republish)
//      (payment)
//  11. development: 'freeze', and the errors each rule throws. TypeScript
//      catches most of them before the code runs
// ===========================================================================

import { o, mutex, freeze, finite, value, pending, republish } from '../soucouyant-core.js'
import type { AnyStateObject, Pending, Props } from '../soucouyant-core.js'

// ---------------------------------------------------------------------------
// 1. Configuration
// ---------------------------------------------------------------------------

const lockTimeout = 3000

o.config({
  // 'freeze' checks that published values can be cloned and deep-freezes
  // them, so a stray `lines.x = 2` throws instead of silently changing state
  // nobody was notified about. Turn it off in production
  development: 'freeze',

  // Notifications are coalesced to the next animation frame: a burst of
  // publishes renders once. This is the browser default, set here to show it
  execution: 'async-frame',

  // An async callback holds its stateObject's lock until it settles, or for
  // this long at most (see the SLOWPOKE discount code)
  asyncLockTimeout: lockTimeout
})

// ---------------------------------------------------------------------------
// 2. Types and declarations
//
// shop.js declares with tagged templates. TypeScript can't read the address
// or the state's type from inside a template, so here the same stateObjects
// are declared with one object. Every state's type comes from it, and o()
// returns the tree typed: `state.cart.tip` is a StateObject<number>
// ---------------------------------------------------------------------------

// `as const` keeps the shelf names as literals, so finite() can type the
// shelf as one of them
const shelves = ['all', 'sauces', 'preserves', 'spices', 'drinks'] as const
type Shelf = typeof shelves[number]

type Shape = 'jar' | 'bottle' | 'tin' | 'tall'

interface Product {
  readonly id: string
  readonly name: string
  readonly shelf: Exclude<Shelf, 'all'>
  readonly origin: string
  readonly price: number // pence
  readonly shape: Shape
  readonly colour: string
  readonly label: string
}

// Published objects are deep-frozen in development, so the types say so too:
// TypeScript then rejects the mutations Soucouyant would throw on
type Lines = Readonly<Record<string, number>> // { productId: quantity }

interface Discount {
  readonly code: string
  readonly percent: number
}

interface Details {
  readonly name: string
  readonly email: string
  readonly card: string
}

interface Order {
  readonly number: string
  readonly name: string
  readonly email: string
  readonly total: number
  readonly lines: ReadonlyArray<{ readonly name: string, readonly quantity: number, readonly total: number }>
}

const state = o({
  catalog: {
    // Starts pending; value<T>() gives it the type it will have once loaded
    products: value<readonly Product[] | Pending>(pending),
    shelf: finite('all', shelves), // one of the shelves
    search: ''
  },
  cart: {
    // value() makes a plain object a state rather than a namespace
    lines: value<Lines>({}),
    discount: value<Discount | null>(null),
    tip: 0
  },
  checkout: {
    step: finite('browsing', ['browsing', 'details', 'paying', 'paid', 'failed'], {
      // Transition rules: any move not listed here throws. TypeScript checks
      // every state named here is one of the five
      transitions: {
        browsing: ['details'],
        details: ['browsing', 'paying'],
        paying: ['paid', 'failed'],
        paid: ['browsing'],
        failed: ['details', 'browsing']
      }
    }),
    details: value<Details>({ name: '', email: '', card: '' }),
    order: value<Order | null>(null) // the receipt, once paid
  },
  ui: { toast: value<string | null>(null) }
})

// The checkout's states as a type: 'browsing' | 'details' | ...
type CheckoutStep = ReturnType<typeof state.checkout.step>

// No new top-level namespaces from here on. Each namespace can still be
// frozen on its own: freeze(state.cart) would stop new stateObjects in cart
freeze(o)

// ---------------------------------------------------------------------------
// 3. Helpers and the fake back end
// ---------------------------------------------------------------------------

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
const money = (pence: number) => `£${(pence / 100).toFixed(2)}`

// Finds an element the page is known to contain. The `!` says so: a missing
// element is a broken page, not a case to handle
const $ = <T extends Element = HTMLElement>(selector: string) => document.querySelector<T>(selector)!

// The catalogue, as a server would send it. Prices are in pence
const catalogue: readonly Product[] = [
  { id: 'scotch-bonnet', name: 'Scotch bonnet pepper sauce', shelf: 'sauces', origin: 'Jamaica', price: 650, shape: 'bottle', colour: '#e8482c', label: '#fff4d6' },
  { id: 'green-seasoning', name: 'Green seasoning', shelf: 'sauces', origin: 'Trinidad', price: 500, shape: 'jar', colour: '#5d9b3a', label: '#ffffff' },
  { id: 'tamarind-ketchup', name: 'Tamarind ketchup', shelf: 'sauces', origin: 'Barbados', price: 475, shape: 'bottle', colour: '#7a3b1d', label: '#f2a33a' },
  { id: 'mango-chutney', name: 'Mango chutney', shelf: 'preserves', origin: 'Guyana', price: 550, shape: 'jar', colour: '#f2a33a', label: '#1d2b26' },
  { id: 'guava-jam', name: 'Guava jam', shelf: 'preserves', origin: 'St Lucia', price: 480, shape: 'jar', colour: '#e5677d', label: '#ffffff' },
  { id: 'sorrel-jelly', name: 'Sorrel jelly', shelf: 'preserves', origin: 'Grenada', price: 520, shape: 'jar', colour: '#9b1b3f', label: '#f6d2dc' },
  { id: 'jerk-rub', name: 'Jerk spice rub', shelf: 'spices', origin: 'Jamaica', price: 420, shape: 'tin', colour: '#3b2a20', label: '#f2a33a' },
  { id: 'curry-powder', name: 'Trinidad curry powder', shelf: 'spices', origin: 'Trinidad', price: 390, shape: 'tin', colour: '#d9a21b', label: '#1d2b26' },
  { id: 'pimento', name: 'Pimento berries', shelf: 'spices', origin: 'Jamaica', price: 350, shape: 'tin', colour: '#6b4a35', label: '#eef6f3' },
  { id: 'sorrel-cordial', name: 'Sorrel cordial', shelf: 'drinks', origin: 'Jamaica', price: 700, shape: 'tall', colour: '#a3123a', label: '#ffffff' },
  { id: 'ginger-syrup', name: 'Ginger beer syrup', shelf: 'drinks', origin: 'Antigua', price: 620, shape: 'tall', colour: '#d8b04a', label: '#1d2b26' },
  { id: 'mauby', name: 'Mauby bark syrup', shelf: 'drinks', origin: 'Trinidad', price: 680, shape: 'tall', colour: '#4b2a1a', label: '#f2a33a' }
]

const productById = new Map(catalogue.map((product) => [product.id, product]))

// Every id in the basket came from the catalogue, so a miss is a bug
const productOf = (id: string): Product => {
  const product = productById.get(id)
  if (product === undefined) throw new Error(`No product with the id ${id}`)
  return product
}

// Discount codes, checked "on the server". SLOWPOKE never answers in time
const codes: Readonly<Record<string, number | undefined>> = { MANGO: 10, SOUCOUYANT: 20 }
const checkCode = async (code: string): Promise<Discount | null> => {
  await wait(code === 'SLOWPOKE' ? 6000 : 700)
  const percent = codes[code]
  return percent === undefined ? null : { code, percent }
}

// A card ending in 0002 is declined; anything else is approved
const chargeCard = async (card: string) => {
  await wait(2500)
  return !card.replace(/\s/g, '').endsWith('0002')
}

// Product art: a little jar, bottle, tin or tall bottle drawn in SVG
const art = ({ shape, colour, label }: Product) => {
  const bodies: Record<Shape, string> = {
    jar: `<rect x="22" y="30" width="56" height="70" rx="10" fill="${colour}"/><rect x="26" y="18" width="48" height="14" rx="3" fill="#1d2b26"/><rect x="28" y="52" width="44" height="26" rx="3" fill="${label}"/>`,
    bottle: `<path d="M42 6h16v20c10 6 14 14 14 24v50a6 6 0 01-6 6H34a6 6 0 01-6-6V50c0-10 4-18 14-24z" fill="${colour}"/><rect x="40" y="2" width="20" height="9" rx="2" fill="#1d2b26"/><rect x="31" y="58" width="38" height="24" rx="3" fill="${label}"/>`,
    tin: `<rect x="20" y="28" width="60" height="72" rx="6" fill="${colour}"/><rect x="18" y="22" width="64" height="10" rx="3" fill="#9aa8a2"/><circle cx="50" cy="64" r="17" fill="${label}"/>`,
    tall: `<path d="M44 2h12v26c8 4 12 10 12 18v54a6 6 0 01-6 6H38a6 6 0 01-6-6V46c0-8 4-14 12-18z" fill="${colour}"/><rect x="42" y="0" width="16" height="7" rx="2" fill="#1d2b26"/><rect x="35" y="56" width="30" height="30" rx="3" fill="${label}"/>`
  }
  return `<svg viewBox="0 0 100 108" aria-hidden="true">${bodies[shape]}</svg>`
}

// ---------------------------------------------------------------------------
// 4. Load the catalogue: pending, then an async callback publish
//
// `state.catalog.products` was declared pending. Publishing an async
// function runs it and publishes what it resolves to. Until then the
// stateObject is locked, so nothing else can publish a half-loaded catalogue
// over it. The promise must resolve to the state's type: readonly Product[]
// ---------------------------------------------------------------------------

state.catalog.products(async () => {
  await wait(1100)
  return catalogue
})

// ---------------------------------------------------------------------------
// 5. Subscriptions: every part of the page draws itself from state
// ---------------------------------------------------------------------------

// Counts notifications, to show batching in the drawer
const notifications = { shelves: 0, basket: 0, totals: 0 }

// --- Filters and shelves --------------------------------------------------

const filters = $('#filters')
filters.replaceChildren(...shelves.map((shelf) => {
  const button = document.createElement('button')
  button.textContent = shelf === 'all' ? 'Everything' : shelf[0]?.toUpperCase() + shelf.slice(1)
  button.dataset.shelf = shelf
  // `shelf` is typed Shelf, so this publish is checked: only the five
  // finite states fit
  button.addEventListener('click', () => state.catalog.shelf(shelf))
  return button
}))

const renderShelves = () => {
  notifications.shelves++
  const products = state.catalog.products()
  const shelf = state.catalog.shelf()
  const search = state.catalog.search().trim().toLowerCase()

  for (const button of filters.children) button.setAttribute('aria-pressed', String(button instanceof HTMLElement && button.dataset.shelf === shelf))

  const grid = $('#shelves')
  // Comparing with `pending` narrows the type: below this, products is
  // readonly Product[]
  if (products === pending) {
    // Still loading: skeleton cards
    grid.innerHTML = '<article class="product loading"><div class="art"></div><div class="bar"></div><div class="bar short"></div></article>'.repeat(8)
    return
  }

  const shown = products.filter((product) =>
    (shelf === 'all' || product.shelf === shelf) &&
    (search === '' || product.name.toLowerCase().includes(search) || product.origin.toLowerCase().includes(search)))

  if (shown.length === 0) {
    grid.innerHTML = '<p class="empty">Nothing on these shelves matches. Clear the search or choose Everything.</p>'
    return
  }

  grid.innerHTML = shown.map((product) => `
    <article class="product">
      <div class="art" style="background: color-mix(in srgb, ${product.colour} 12%, #ffffff)">${art(product)}</div>
      <h3>${product.name}</h3>
      <span class="origin">${product.origin}</span>
      <div class="buy">
        <span class="price">${money(product.price)}</span>
        <button data-add="${product.id}" aria-label="Add ${product.name} to the basket">Add</button>
      </div>
    </article>`).join('')
}

// A one-parameter subscriber receives the state only: no props object is
// built, which is the fastest kind. Three stateObjects share one renderer
state.catalog.products.sub(renderShelves)
state.catalog.shelf.sub(renderShelves)
state.catalog.search.sub(renderShelves)

$<HTMLInputElement>('#search').addEventListener('input', (event) => {
  if (event.target instanceof HTMLInputElement) state.catalog.search(event.target.value)
})

// --- Basket ---------------------------------------------------------------

// Publishing a function publishes what it returns, given the newest state.
// Published objects are frozen in development, so build a new one
const changeQuantity = (id: string, change: number) => state.cart.lines((lines) => {
  const quantity = (lines[id] ?? 0) + change
  const next = { ...lines }
  if (quantity <= 0) delete next[id]
  else next[id] = quantity
  return next
})

// The element a click landed on, or inside, that matches a selector
const clicked = <T extends Element = HTMLElement>(event: Event, selector: string) =>
  event.target instanceof Element ? event.target.closest<T>(selector) : null

$('#shelves').addEventListener('click', (event) => {
  const id = clicked(event, '[data-add]')?.dataset.add
  if (id === undefined) return
  changeQuantity(id, 1)
  state.ui.toast(`Added ${productOf(id).name}`)
  showWaiting()
})

// A two-parameter subscriber also receives props. props.rev is the state the
// subscribers had before, so the basket can tell which lines changed and
// flash only those. Both parameters are typed from the stateObject
state.cart.lines.sub((lines, props) => {
  notifications.basket++
  const before = props.rev ?? {}
  const ids = Object.keys(lines)
  const count = ids.reduce((sum, id) => sum + (lines[id] ?? 0), 0)
  $('#basket-count').textContent = count === 0 ? 'Empty' : `${count} item${count === 1 ? '' : 's'}`
  $<HTMLButtonElement>('#checkout-button').disabled = count === 0 || state.checkout.step() !== 'browsing'

  $('#lines').replaceChildren(...ids.map((id) => {
    const product = productOf(id)
    const quantity = lines[id] ?? 0
    const row = document.createElement('li')
    row.className = 'line'
    if (before[id] !== quantity) row.classList.add('changed')
    row.innerHTML = `
      <span class="name">${product.name}</span>
      <span class="stepper">
        <button data-change="-1" data-id="${id}" aria-label="One fewer ${product.name}">−</button>
        <output>${quantity}</output>
        <button data-change="1" data-id="${id}" aria-label="One more ${product.name}">+</button>
      </span>
      <span class="price">${money(product.price * quantity)}</span>`
    return row
  }))
})

$('#lines').addEventListener('click', (event) => {
  const button = clicked(event, '[data-change]')
  if (button === null || button.dataset.id === undefined) return
  changeQuantity(button.dataset.id, Number(button.dataset.change))
  showWaiting()
})

// --- Totals ---------------------------------------------------------------

const renderTotals = () => {
  notifications.totals++
  const lines = state.cart.lines()
  const discount = state.cart.discount()
  const tip = state.cart.tip()
  const subtotal = Object.keys(lines).reduce((sum, id) => sum + productOf(id).price * (lines[id] ?? 0), 0)
  const saving = discount === null ? 0 : Math.round(subtotal * discount.percent / 100)
  const delivery = subtotal === 0 || subtotal - saving >= 3000 ? 0 : 395
  const total = subtotal - saving + delivery + Math.round(tip * 100)
  $('#totals').innerHTML = `
    <span>Subtotal</span><span>${money(subtotal)}</span>
    ${discount === null ? '' : `<span>${discount.code} (${discount.percent}% off)</span><span>−${money(saving)}</span>`}
    <span>Delivery${delivery === 0 && subtotal > 0 ? ' (free over £30)' : ''}</span><span>${money(delivery)}</span>
    ${tip > 0 ? `<span>Tip for the growers</span><span>${money(Math.round(tip * 100))}</span>` : ''}
    <span class="grand">Total</span><span class="grand">${money(total)}</span>`
  return total
}

// sub.withProps forces props even though this subscriber declares no
// parameters, because it reads its arguments through `...args`.
// args[1] is props; props.identity is the address that changed. One
// subscriber serves three stateObjects of different types, so it takes the
// state as unknown
const totalsSubscriber = (...args: [state: unknown, props: Props<unknown>]) => {
  renderTotals()
  showActivity(`totals redrawn because ${args[1].identity} changed`)
}
state.cart.lines.sub.withProps(totalsSubscriber)
state.cart.discount.sub.withProps(totalsSubscriber)
state.cart.tip.sub.withProps(totalsSubscriber)

// --- Toast ----------------------------------------------------------------

let toastTimer: ReturnType<typeof setTimeout> | undefined
state.ui.toast.sub((message) => {
  const toast = $('#toast')
  toast.hidden = message === null
  toast.textContent = message ?? ''
  clearTimeout(toastTimer)
  if (message !== null) toastTimer = setTimeout(() => state.ui.toast(null), 2200)
})

// ---------------------------------------------------------------------------
// 6. Named subscriptions: switched on and off by reference
//
// A subscription can be given a name. unsub(name) removes it, and returns
// how many subscriptions it removed
// ---------------------------------------------------------------------------

const activity = $('#activity')
const showActivity = (text: string) => {
  if (activity.hidden) return
  activity.textContent = `${new Date().toLocaleTimeString()}  ${text}\n${activity.textContent}`.slice(0, 4000)
}

$<HTMLInputElement>('#activity-switch').addEventListener('change', (event) => {
  const checked = event.target instanceof HTMLInputElement && event.target.checked
  activity.hidden = !checked
  if (checked) {
    // The reference is typed as the literal 'basket-activity'
    state.cart.lines.sub((lines, props) => {
      const changed = Object.keys({ ...lines, ...props.rev }).filter((id) => lines[id] !== props.rev?.[id])
      showActivity(`basket: ${changed.map((id) => `${id} ${props.rev?.[id] ?? 0} → ${lines[id] ?? 0}`).join(', ')}`)
    }, 'basket-activity')
    showActivity('subscribed as "basket-activity"')
  } else {
    const removed = state.cart.lines.unsub('basket-activity')
    activity.hidden = false
    showActivity(`unsub('basket-activity') removed ${removed}`)
    activity.hidden = true
  }
})

// ---------------------------------------------------------------------------
// 7. Discount codes: an async callback that locks while it checks
//
// While the check is running, state.cart.discount is locked. Apply a second
// code during the check and its publish waits in the buffer, then runs
// against whatever the first one published. SLOWPOKE takes longer than
// asyncLockTimeout: the lock is released and its late answer is thrown away
// ---------------------------------------------------------------------------

const discountNote = $('#discount-note')

$('#discount-form').addEventListener('submit', (event) => {
  event.preventDefault()
  const code = $<HTMLInputElement>('#discount-code').value.trim().toUpperCase()
  if (code === '') return
  discountNote.className = 'field-note'
  discountNote.textContent = `Checking ${code}…`

  const started = performance.now()
  // `current` is typed Discount | null from the declaration
  state.cart.discount(async (current) => {
    const found = await checkCode(code)
    // Past asyncLockTimeout the lock was released and this result will be
    // discarded, whatever it is
    if (performance.now() - started > lockTimeout) {
      discountNote.className = 'field-note bad'
      discountNote.textContent = `${code} took too long to check, so the answer was ignored.`
      return found ?? undefined
    }
    discountNote.className = `field-note ${found === null ? 'bad' : 'good'}`
    discountNote.textContent = found === null ? `${code} isn't a code we know.` : `${code} applied.`
    // Returning undefined publishes nothing: keep the current discount
    return found ?? current ?? undefined
  })
})

// ---------------------------------------------------------------------------
// 8. The tip: NaN is ignored
//
// Typing something that isn't a number publishes NaN. Soucouyant ignores it
// and reports it (see Messages), so the total never shows NaN. NaN is a
// number, so this is one rule TypeScript can't check. Clear the field to tip
// nothing
// ---------------------------------------------------------------------------

$<HTMLInputElement>('#tip').addEventListener('input', (event) => {
  if (!(event.target instanceof HTMLInputElement)) return
  const text = event.target.value.trim()
  const amount = text === '' ? 0 : Number(text.replace(/^£/, ''))
  $('#tip-note').textContent = Number.isNaN(amount) ? `"${text}" isn't an amount: the tip stays at ${money(state.cart.tip() * 100)}.` : ''
  state.cart.tip(amount)
})

// ---------------------------------------------------------------------------
// 9. Checkout: a finite state, and the basket locked during payment
// ---------------------------------------------------------------------------

const card = $('#checkout-card')
const steps: readonly CheckoutStep[] = ['details', 'paying', 'paid']

const progress = (step: CheckoutStep) => `<div class="progress">${steps.map((name, at) =>
  `<span class="${steps.indexOf(step === 'failed' ? 'paying' : step) >= at ? 'done' : ''}"></span>`).join('')}</div>`

// The details form's fields are exactly the keys of Details
const isDetailsField = (name: string): name is keyof Details => name === 'name' || name === 'email' || name === 'card'

// Every screen of the checkout is one value of state.checkout.step. `step`
// is the union of the five states, so a misspelt one here is a type error
state.checkout.step.sub((step) => {
  $('#aisle').classList.toggle('checking-out', step !== 'browsing')
  card.hidden = step === 'browsing'
  $<HTMLButtonElement>('#checkout-button').disabled = step !== 'browsing' || Object.keys(state.cart.lines()).length === 0
  const details = state.checkout.details()

  if (step === 'details') {
    card.innerHTML = `${progress(step)}
      <h2 id="checkout-title">Where should it go?</h2>
      <form id="details-form">
        <label>Name <input type="text" name="name" required autocomplete="name"></label>
        <label>Email <input type="email" name="email" required autocomplete="email"></label>
        <label>Test card number. One ending 0002 is declined <input type="text" name="card" required inputmode="numeric" placeholder="4242 4242 4242 4242"></label>
        <div class="actions">
          <button type="button" id="back">Back to the shop</button>
          <button class="primary">Pay ${money(renderTotals())}</button>
        </div>
      </form>`
    const form = $<HTMLFormElement>('#details-form')
    for (const input of form.querySelectorAll('input')) {
      if (isDetailsField(input.name)) input.value = details[input.name]
    }
    // Each keystroke publishes a new details object
    form.addEventListener('input', (event) => {
      if (!(event.target instanceof HTMLInputElement)) return
      const { name, value: text } = event.target
      if (isDetailsField(name)) state.checkout.details((current) => ({ ...current, [name]: text }))
    })
    form.addEventListener('submit', (event) => {
      event.preventDefault()
      pay()
    })
    $('#back').addEventListener('click', () => state.checkout.step('browsing'))
    form.querySelector<HTMLInputElement>('[name="name"]')?.focus()
  } else if (step === 'paying') {
    card.innerHTML = `${progress(step)}
      <h2 id="checkout-title">Paying…</h2>
      <p>Your basket is locked while the payment goes through. Change it now and
      the changes wait in the mutex buffer, then apply once payment finishes.</p>`
  } else if (step === 'paid') {
    const order = state.checkout.order()
    if (order === null) return
    // Changes made during payment were replayed after the basket emptied
    const carried = Object.values(state.cart.lines()).reduce((sum, quantity) => sum + quantity, 0)
    card.innerHTML = `${progress(step)}
      <h2 id="checkout-title">Thank you, ${order.name.split(' ')[0] || 'friend'}</h2>
      <p>Order ${order.number} is paid. A receipt is on its way to ${order.email}.</p>
      <ul class="receipt">${order.lines.map((line) => `<li><span>${line.quantity} × ${line.name}</span><span>${money(line.total)}</span></li>`).join('')}</ul>
      <p><b>Paid ${money(order.total)}</b></p>
      ${carried === 0 ? '' : `<p>The ${carried} item${carried === 1 ? '' : 's'} you added during payment ${carried === 1 ? 'is' : 'are'} in a new basket.</p>`}
      <div class="actions"><span></span><button class="primary" id="done">Back to the shop</button></div>`
    $('#done').addEventListener('click', () => state.checkout.step('browsing'))
  } else if (step === 'failed') {
    card.innerHTML = `${progress(step)}
      <h2 id="checkout-title">The card was declined</h2>
      <p>Nothing was charged and your basket is as you left it.</p>
      <div class="actions">
        <button id="back">Back to the shop</button>
        <button class="primary" id="retry">Try another card</button>
      </div>`
    $('#back').addEventListener('click', () => state.checkout.step('browsing'))
    $('#retry').addEventListener('click', () => state.checkout.step('details'))
  }
})

$('#checkout-button').addEventListener('click', () => state.checkout.step('details'))

// The basket shows what's waiting behind the lock
const showWaiting = () => {
  const waiting = mutex.buffer.filter((entry) => entry.identity === 'cart > lines').length
  $('#waiting').hidden = waiting === 0
  $('#waiting').textContent = `${waiting} basket change${waiting === 1 ? '' : 's'} waiting until payment finishes.`
}

const pay = async () => {
  state.checkout.step('paying')

  // Lock the basket. From now on only `releaseBasket` can publish to it;
  // every other publish to state.cart.lines waits in mutex.buffer. The
  // release function is typed by the stateObject: it takes Lines
  const releaseBasket = mutex.lock(state.cart.lines)
  $('#basket').classList.add('locked')

  const approved = await chargeCard(state.checkout.details().card)
  $('#basket').classList.remove('locked')

  if (approved) {
    const lines = state.cart.lines()
    state.checkout.order({
      number: `PP-${Math.floor(Math.random() * 90000 + 10000)}`,
      name: state.checkout.details().name,
      email: state.checkout.details().email,
      total: renderTotals(),
      lines: Object.keys(lines).map((id) => {
        const quantity = lines[id] ?? 0
        return { name: productOf(id).name, quantity, total: productOf(id).price * quantity }
      })
    })
    // release(value) publishes as the lock holder, then unlocks, then
    // replays the buffered changes in order. So the basket empties, and
    // anything added during payment becomes the next basket
    releaseBasket({})
    state.cart.discount(null)
    state.checkout.step('paid')
  } else {
    // release(republish) unlocks without changing the basket, but notifies
    // its subscribers again so the basket redraws now that it's unlocked
    releaseBasket(republish)
    state.checkout.step('failed')
  }
  showWaiting()
}

// ---------------------------------------------------------------------------
// 10. The drawer: the state tree and notification counts
//
// One subscriber on every stateObject redraws the tree. Batching means a
// burst of publishes redraws it once
// ---------------------------------------------------------------------------

const stateView = $('#state-view')

// AnyStateObject is any stateObject, whatever its state type
const addresses: ReadonlyArray<readonly [string, AnyStateObject]> = [
  ['catalog > products', state.catalog.products],
  ['catalog > shelf', state.catalog.shelf],
  ['catalog > search', state.catalog.search],
  ['cart > lines', state.cart.lines],
  ['cart > discount', state.cart.discount],
  ['cart > tip', state.cart.tip],
  ['checkout > step', state.checkout.step],
  ['checkout > details', state.checkout.details],
  ['checkout > order', state.checkout.order],
  ['ui > toast', state.ui.toast]
]

const describe = (current: unknown) => {
  if (current === pending) return 'pending'
  if (Array.isArray(current)) return `[ ${current.length} products ]`
  return JSON.stringify(current)
}

const renderState = () => {
  stateView.textContent = addresses
    .map(([address, stateObject]) => `${address.padEnd(19)} ${describe(stateObject())}`)
    .join('\n')
  $('#counters').innerHTML = `
    <dt>Shelves redrawn</dt><dd>${notifications.shelves}</dd>
    <dt>Basket redrawn</dt><dd>${notifications.basket}</dd>
    <dt>Totals redrawn</dt><dd>${notifications.totals}</dd>
    <dt>Basket declared at</dt><dd>${new Date(state.cart.lines.startTime()).toLocaleTimeString()}</dd>`
}

for (const [, stateObject] of addresses) stateObject.sub(renderState)

// ---------------------------------------------------------------------------
// 11. Try it: each button breaks a rule, and shows what Soucouyant does
//
// Most of these don't compile in TypeScript: the types reject them before
// they can run. Each is kept, marked @ts-expect-error, so the button still
// shows what happens at runtime
// ---------------------------------------------------------------------------

type MessageKind = 'warn' | 'error'

const messages = $('#messages')
const report = (text: string, kind: MessageKind = 'warn') => {
  if (messages.firstElementChild?.textContent === 'None yet.') messages.replaceChildren()
  const item = document.createElement('li')
  item.className = kind
  item.textContent = text
  messages.prepend(item)
  $<HTMLDetailsElement>('#hood').open = true
}

// Soucouyant reports through console.error and console.warn, with a
// [soucouyant] prefix. Copy those into the drawer too
for (const kind of ['warn', 'error'] as const) {
  const original = console[kind].bind(console)
  console[kind] = (...args: unknown[]) => {
    original(...args)
    if (typeof args[0] === 'string' && args[0].startsWith('[soucouyant]')) report(args[0], kind)
  }
}

const attempt = (action: () => void) => {
  try {
    action()
    report('No error.')
  } catch (error) {
    report(error instanceof Error ? `${error.name}: ${error.message}` : String(error), 'error')
  }
}

$('#try-add-ten').addEventListener('click', () => {
  const before = notifications.basket
  // Ten publishes in one task: ten new states, one notification
  for (let i = 0; i < 10; i++) changeQuantity('scotch-bonnet', 1)
  requestAnimationFrame(() => requestAnimationFrame(() => {
    report(`10 publishes, ${notifications.basket - before} basket redraw: notifications were batched to one frame.`)
  }))
})

$('#try-mutate').addEventListener('click', () => attempt(() => {
  // development: 'freeze' deep-froze the published object. Lines is
  // Readonly, so TypeScript rejects the assignment too
  // @ts-expect-error: an index signature in Readonly<Record> only permits reading
  state.cart.lines()['scotch-bonnet'] = 99
}))

$('#try-illegal').addEventListener('click', () => attempt(() => {
  // From 'browsing' the only legal move is to 'details'. 'paid' is one of the
  // states, so this compiles: transition rules are checked when it runs
  state.checkout.step('paid')
}))

$('#try-declare').addEventListener('click', () => attempt(() => {
  // freeze(o) stops new top-level names. A tagged declaration compiles,
  // because TypeScript can't read the template; it throws when it runs
  o`wishlist > items`([])
}))

$('#try-shelf').addEventListener('click', () => attempt(() => {
  // Not one of the finite states, and the type of state.catalog.shelf says so
  // @ts-expect-error: 'frozen' isn't one of the shelves
  state.catalog.shelf('frozen')
}))

// ---------------------------------------------------------------------------
// 12. First paint
//
// Subscribers run when state changes, not when they subscribe, so draw the
// page once now. The catalogue is still pending: skeleton shelves
// ---------------------------------------------------------------------------

renderShelves()
renderTotals()
renderState()

// For poking at from the console
Object.assign(globalThis, { o, mutex })
