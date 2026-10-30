// SQLite storage for Node, through node:sqlite. node:sqlite is synchronous,
// so the database runs in a worker thread and the main thread never blocks.
//
//   import { sqliteStorage } from 'soucouyant/storage-sqlite'
//   o.config({ persist: true, offlineStorage: { mode: 'all', adapter: sqliteStorage({ path: './state.db' }) } })

import { Worker } from 'node:worker_threads'

export const sqliteStorage = (options = {}) => {
  const path = options.path ?? 'soucouyant.db'
  let worker = null
  let sequence = 0
  const waiting = new Map()

  const settle = (message) => {
    const entry = waiting.get(message.id)
    if (entry === undefined) return
    waiting.delete(message.id)
    if (waiting.size === 0) worker.unref()
    if (message.error !== undefined) entry.reject(new Error(message.error))
    else entry.resolve(message.result)
  }

  const failAll = (error) => {
    for (const entry of waiting.values()) entry.reject(error)
    waiting.clear()
  }

  // The worker keeps the process alive only while a request is in flight
  const call = (type, payload, transfer) => new Promise((resolve, reject) => {
    if (worker === null) {
      reject(new Error('SQLite storage is not open'))
      return
    }
    const id = sequence++
    waiting.set(id, { resolve, reject })
    worker.ref()
    worker.postMessage({ id, type, payload }, transfer)
  })

  return {
    open: () => {
      if (worker === null) {
        worker = new Worker(new URL('./sqlite-worker.js', import.meta.url), { workerData: { path } })
        worker.on('message', settle)
        worker.on('error', failAll)
        worker.unref()
      }
      return call('open', null, [])
    },
    writeFrames: (batch) => call('write', batch, [
      batch.indices.buffer, batch.timestamps.buffer, batch.objectIds.buffer, batch.finiteIndexes.buffer, batch.flags.buffer
    ]),
    readLatest: (count) => call('readLatest', { count }, []),
    readRange: (from, to) => call('readRange', { from, to }, []),
    deleteBefore: (index) => call('deleteBefore', { index }, []),
    deleteBeforeTime: (timestamp) => call('deleteBeforeTime', { timestamp }, []),
    clear: () => call('clear', null, []),
    close: async () => {
      if (worker === null) return
      await call('close', null, [])
      const closing = worker
      worker = null
      await closing.terminate()
    }
  }
}
