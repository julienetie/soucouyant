import { test } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { o } from '../src/index.js'

const dom = new JSDOM('<!doctype html><div id="root"></div>')
globalThis.window = dom.window
globalThis.document = dom.window.document
globalThis.IS_REACT_ACT_ENVIRONMENT = true

o.config({ execution: 'sync' })
o`ui > count`(0)`ui > name`('ada')

test('React: useSoucouyant re-renders on change and unsubscribes on unmount', async () => {
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { act } = React
  const { useSoucouyant } = await import('../src/bindings/react.js')
  const Counter = () => React.createElement('span', null, String(useSoucouyant(o.ui.count)))
  const container = document.getElementById('root')
  const root = createRoot(container)
  await act(async () => root.render(React.createElement(Counter)))
  assert.equal(container.textContent, '0')
  await act(async () => { o.ui.count(5) })
  assert.equal(container.textContent, '5')
  await act(async () => root.unmount())
  o.ui.count(6)
})

test('React: server rendering reads the current state', async () => {
  const React = await import('react')
  const { renderToString } = await import('react-dom/server')
  const { useSoucouyant } = await import('../src/bindings/react.js')
  const Name = () => React.createElement('b', null, useSoucouyant(o.ui.name))
  assert.equal(renderToString(React.createElement(Name)), '<b>ada</b>')
})

test('Vue: refs follow the stateObject and stop on scope dispose', async () => {
  const { effectScope, watch, nextTick } = await import('vue')
  const { useSoucouyant, useSoucouyantModel } = await import('../src/bindings/vue.js')
  const scope = effectScope()
  const seen = []
  let model
  scope.run(() => {
    const count = useSoucouyant(o.ui.count)
    watch(count, (value) => seen.push(value))
    model = useSoucouyantModel(o.ui.name)
  })
  o.ui.count(7)
  await nextTick()
  assert.deepEqual(seen, [7])
  model.value = 'grace'
  assert.equal(o.ui.name(), 'grace')
  scope.stop()
  o.ui.count(8)
  await nextTick()
  assert.deepEqual(seen, [7])
})

test('Svelte: the store contract', async () => {
  const { toStore } = await import('../src/bindings/svelte.js')
  const store = toStore(o.ui.count)
  const seen = []
  const stop = store.subscribe((value) => seen.push(value))
  o.ui.count(9)
  store.set(10)
  stop()
  o.ui.count(11)
  assert.deepEqual(seen, [8, 9, 10])
})

test('Angular: injectSoucouyant returns a signal tied to DestroyRef', async () => {
  const { Injector, runInInjectionContext, createEnvironmentInjector, EnvironmentInjector } = await import('@angular/core')
  const { injectSoucouyant } = await import('../src/bindings/angular.js')
  const parent = Injector.create({ providers: [] })
  const environment = createEnvironmentInjector([], parent.get(EnvironmentInjector, null) ?? parent)
  let count
  runInInjectionContext(environment, () => { count = injectSoucouyant(o.ui.count) })
  assert.equal(count(), 11)
  o.ui.count(12)
  assert.equal(count(), 12)
  environment.destroy()
  o.ui.count(13)
  assert.equal(count(), 12)
})

test('Next.js: snapshot on the server, SoucouyantState on the client', async () => {
  const { snapshot } = await import('../src/bindings/next.js')
  const data = snapshot(o.ui.count, o.ui.name)
  assert.deepEqual(data, { 'ui > count': 13, 'ui > name': 'grace' })
  const React = await import('react')
  const { renderToString } = await import('react-dom/server')
  const { SoucouyantState, useSoucouyant } = await import('../src/bindings/next-client.js')
  const Show = () => React.createElement('i', null, String(useSoucouyant(o.ui.count)))
  const html = renderToString(React.createElement(SoucouyantState, { snapshot: { 'ui > count': 99 } }, React.createElement(Show)))
  assert.equal(html, '<i>99</i>')
})
