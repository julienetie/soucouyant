// Without a registered shape, o accepts any path and states are unknown.
// This project turns off noUncheckedIndexedAccess: with it on, TypeScript
// reads every unregistered path as possibly undefined, as it does for any
// index signature. TS_README.md recommends registering a shape instead.
import { o, mutex } from 'soucouyant'
import { assert, type Equal } from '../expect.js'

o`app > theme`('dark')`app > fontSize`(14)

const theme = o.app.theme()
assert<Equal<typeof theme, unknown>>()
o.app.theme('anything')
o.app.fontSize((current) => {
  assert<Equal<typeof current, unknown>>()
  return 16
})
o.app.theme.sub((current, props) => {
  assert<Equal<typeof current, unknown>>()
  assert<Equal<typeof props.identity, string>>()
})
o.app.scope('/src/app.js')

// The root's own members keep their types
o.config({ execution: 'sync' })
// @ts-expect-error config takes an options object
o.config('sync')
mutex.lock(o)()
const release = mutex.lock(o.app.theme)
release('light')
