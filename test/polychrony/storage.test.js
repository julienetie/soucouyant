import 'fake-indexeddb/auto'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { o, chain } from '../../src/soucouyant-polychrony.js'
import { sqliteStorage } from '../../src/storage/sqlite.js'
import { indexedDbStorage } from '../../src/storage/indexeddb.js'

o.config({ execution: 'sync', persist: true, mergeFidelity: 0 })
o`ledger > balance`(100)
o.ledger.balance(110)

test('each timeline stores to its own SQLite database', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'soucouyant-polychrony-'))
  try {
    const left = chain.create('left', { offlineStorage: { mode: 'all', adapter: sqliteStorage({ path: join(directory, 'left.db') }) } })
    const right = chain.create('right', { offlineStorage: { mode: 'all', adapter: sqliteStorage({ path: join(directory, 'right.db') }) } })
    left.ledger.balance(120)
    left.ledger.balance(130)
    right.ledger.balance(90)
    await left.chain.flush()
    await right.chain.flush()
    assert.equal(left.chain.meta().framesInStorage, 2)
    assert.equal(right.chain.meta().framesInStorage, 1)

    // Restoring brings back each timeline's own frames
    left.ledger.balance(0)
    right.ledger.balance(0)
    await left.chain.restore()
    await right.chain.restore()
    assert.equal(left.ledger.balance(), 0)
    assert.equal(right.ledger.balance(), 0)
    assert.equal(o.ledger.balance(), 110)

    assert.equal(left.chain.delete(), true)
    assert.equal(right.chain.delete(), true)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('IndexedDB timelines get their own database by default', async () => {
  const draft = chain.create('draft', { offlineStorage: { mode: 'all', adapter: indexedDbStorage() } })
  assert.equal(draft.config({}).databaseName, 'soucouyant:draft')
  draft.ledger.balance(77)
  await draft.chain.flush()
  assert.equal(draft.chain.meta().framesInStorage, 1)
  draft.ledger.balance(78)
  const restored = await draft.chain.restore()
  assert.equal(restored > 0, true)
  assert.equal(draft.ledger.balance(), 78)
  await draft.chain.clear({ storage: true })
  assert.equal(draft.chain.meta().framesInStorage, 0)
  draft.chain.delete()
})
