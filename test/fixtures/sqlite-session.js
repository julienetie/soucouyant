import { o, chain, pending, head } from '../../src/index.js'
import { sqliteStorage } from '../../src/storage/sqlite.js'

const [path, step] = process.argv.slice(2)
const adapter = sqliteStorage({ path })
o.config({ execution: 'sync', persist: true, mergeFidelity: 0, offlineStorage: { mode: 'all', adapter } })
o`app > counter`(0)`app > label`(pending)

if (step === 'first') {
  o.app.counter(1)
  o.app.counter(2)
  o.app.counter(3)
  await chain.flush()
  const values = chain.expose().filter((frame) => frame.identity === 'app > counter').map((frame) => frame.state).slice(1)
  console.log(JSON.stringify({ values, lastIndex: chain.meta().lastIndex }))
} else if (step === 'second') {
  const restoredCount = await chain.restore()
  const restoredIndices = chain.expose().map((frame) => frame.index)
  const firstIndexAfterRestore = chain.meta().firstIndex
  o.app.counter(10)
  await chain.flush()
  console.log(JSON.stringify({
    restoredCount,
    restoredIndices,
    firstIndexAfterRestore,
    counter: chain.stateAt(chain.meta().lastIndex - 1, o.app.counter)['app > counter'],
    label: o.app.label() === pending ? 'pending' : o.app.label(),
    newIndex: chain.meta().lastIndex
  }))
} else {
  await chain.restore()
  const counter = o.app.counter()
  chain.trailLimit(2)
  const firstIndex = chain.meta().firstIndex
  const rangeLoaded = await chain.restore(0, firstIndex - 1)
  head.seek('present')
  console.log(JSON.stringify({ counter, rangeLoaded }))
}
await adapter.close()
