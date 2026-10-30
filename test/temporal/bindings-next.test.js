import { test } from 'node:test'
import assert from 'node:assert/strict'
import { o } from '../../src/soucouyant-temporal.js'

o.config({ execution: 'sync' })
o`ui > count`(13)`ui > name`('grace')

test('Next.js: snapshot on the server, SoucouyantState on the client', async () => {
  const { snapshot } = await import('../../src/bindings/next.js')
  const data = snapshot(o.ui.count, o.ui.name)
  assert.deepEqual(data, { 'ui > count': 13, 'ui > name': 'grace' })
  const React = await import('react')
  const { renderToString } = await import('react-dom/server')
  const { SoucouyantState, useSoucouyant } = await import('../../src/bindings/next-client.js')
  const Show = () => React.createElement('i', null, String(useSoucouyant(o.ui.count)))
  const html = renderToString(React.createElement(SoucouyantState, { snapshot: { 'ui > count': 99 } }, React.createElement(Show)))
  assert.equal(html, '<i>99</i>')
})
