import 'fake-indexeddb/auto'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { o, chain, pending } from '../../src/soucouyant-temporal.js'
import { indexedDbStorage } from '../../src/storage/indexeddb.js'

test('IndexedDB adapter writes, restores and trims', async () => {
  const adapter = indexedDbStorage({ databaseName: 'soucouyant-test' })
  o.config({ execution: 'sync', persist: true, mergeFidelity: 0, offlineStorage: { mode: 'all', excessLimit: 50, adapter } })
  o`idb > value`(0)`idb > later`(pending)
  for (let i = 1; i <= 80; i++) o.idb.value(i)
  o.idb.later({ ready: true })
  await chain.flush()
  assert.ok(chain.meta().framesInStorage <= 50)
  o.idb.value(1000)
  const restored = await chain.restore()
  assert.ok(restored > 0)
  assert.equal(o.idb.value(), 1000)
  assert.deepEqual(o.idb.later(), { ready: true })
  await chain.clear({ storage: true })
  assert.equal(chain.meta().framesInStorage, 0)
  await adapter.close()
})
