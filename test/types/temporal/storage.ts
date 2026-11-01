// Storage adapters for Node and browsers, a custom adapter, and the Next.js
// server binding, which imports temporal.
import { o, chain } from 'soucouyant/temporal'
import type { StorageAdapter, StorageBatch, StoredFrame } from 'soucouyant/temporal'
import { sqliteStorage, type SqliteStorageOptions } from 'soucouyant/storage-sqlite'
import { indexedDbStorage, type IndexedDbStorageOptions } from 'soucouyant/storage-indexeddb'
import { snapshot, type Snapshot } from 'soucouyant/bindings/next'
import { assert, type Equal } from '../expect.js'

const sqlite = sqliteStorage({ path: './state.db' })
assert<Equal<typeof sqlite, StorageAdapter>>()
sqliteStorage()
// @ts-expect-error path is a string
sqliteStorage({ path: 1 })
const sqliteOptions: SqliteStorageOptions = {}
void sqliteOptions

const browser = indexedDbStorage({ databaseName: 'app', objectStoreName: 'state' })
assert<Equal<typeof browser, StorageAdapter>>()
indexedDbStorage()
// @ts-expect-error unknown option
indexedDbStorage({ version: 2 })
const browserOptions: IndexedDbStorageOptions = { databaseName: 'app' }
void browserOptions

o.config({ persist: true, offlineStorage: { mode: 'all', adapter: sqlite } })
o.config({ offlineStorage: { adapter: browser } })
o.config({ offlineStorage: { mode: 'disabled', adapter: null } })

// A custom adapter: an in-memory store
const frames = new Map<number, StoredFrame>()
const memoryStorage: StorageAdapter = {
  open: () => ({ firstIndex: frames.size === 0 ? -1 : Math.min(...frames.keys()), lastIndex: frames.size === 0 ? -1 : Math.max(...frames.keys()) }),
  writeFrames: async (batch: StorageBatch) => {
    const addresses = new Map(batch.objects)
    for (let i = 0; i < batch.indices.length; i++) {
      const index = batch.indices[i] ?? 0
      frames.set(index, {
        index,
        timestamp: batch.timestamps[i] ?? 0,
        identity: addresses.get(batch.objectIds[i] ?? 0) ?? '',
        state: batch.values[i],
        finiteIndex: batch.finiteIndexes[i] ?? -1,
        alias: batch.aliases[i] ?? null,
        flags: batch.flags[i] ?? 0
      })
    }
  },
  readLatest: async (count) => [...frames.values()].slice(-count),
  readRange: async (from, to) => [...frames.values()].filter((frame) => frame.index >= from && frame.index <= to),
  deleteBefore: async (index) => { for (const key of frames.keys()) if (key < index) frames.delete(key) },
  deleteBeforeTime: async (timestamp) => { for (const [key, frame] of frames) if (frame.timestamp < timestamp) frames.delete(key) },
  clear: async () => { frames.clear() },
  close: async () => {}
}
o.config({ offlineStorage: { mode: 'all', adapter: memoryStorage } })

// @ts-expect-error an adapter needs every method
const incomplete: StorageAdapter = { open: () => undefined }
void incomplete

const loaded: Promise<number> = chain.restore()
void loaded

// Next.js server side
const state = o({ page: { title: 'Home' } })
const serverSnapshot = snapshot(state.page.title)
assert<Equal<typeof serverSnapshot, Snapshot>>()
