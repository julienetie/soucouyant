// IndexedDB storage for browsers. Runs on the main thread: IndexedDB is
// already asynchronous, and values are cloned on the sending thread either
// way, so a worker would add a copy without saving work.
//
//   import { indexedDbStorage } from 'soucouyant/storage-indexeddb'
//   o.config({ persist: true, offlineStorage: { mode: 'all', adapter: indexedDbStorage() } })

const request = (operation) => new Promise((resolve, reject) => {
  operation.onsuccess = () => resolve(operation.result)
  operation.onerror = () => reject(operation.error)
})

const done = (transaction) => new Promise((resolve, reject) => {
  transaction.oncomplete = () => resolve()
  transaction.onerror = () => reject(transaction.error)
  transaction.onabort = () => reject(transaction.error)
})

export const indexedDbStorage = (options = {}) => {
  let database = null
  let storeName = null
  // Session object ids are only valid for this session; addresses are stable
  const addressBySessionId = new Map()

  const store = (mode) => {
    const transaction = database.transaction(storeName, mode)
    return [transaction, transaction.objectStore(storeName)]
  }

  const edgeKey = async (direction) => {
    const [, frames] = store('readonly')
    const cursor = await request(frames.openKeyCursor(null, direction))
    return cursor === null ? -1 : cursor.key
  }

  return {
    open: async (settings = {}) => {
      const databaseName = options.databaseName ?? settings.databaseName ?? 'soucouyant'
      storeName = options.objectStoreName ?? settings.objectStoreName ?? 'transient-state'
      const opening = globalThis.indexedDB.open(databaseName, 1)
      opening.onupgradeneeded = () => {
        const upgrading = opening.result
        if (!upgrading.objectStoreNames.contains(storeName)) {
          const frames = upgrading.createObjectStore(storeName, { keyPath: 'index' })
          frames.createIndex('timestamp', 'timestamp')
          frames.createIndex('alias', 'alias')
        }
      }
      database = await request(opening)
      return { firstIndex: await edgeKey('next'), lastIndex: await edgeKey('prev') }
    },
    writeFrames: async (batch) => {
      for (const [sessionId, address] of batch.objects) addressBySessionId.set(sessionId, address)
      const [transaction, frames] = store('readwrite')
      for (let i = 0; i < batch.indices.length; i++) {
        frames.put({
          index: batch.indices[i],
          timestamp: batch.timestamps[i],
          identity: addressBySessionId.get(batch.objectIds[i]),
          finiteIndex: batch.finiteIndexes[i],
          flags: batch.flags[i],
          alias: batch.aliases[i],
          state: batch.values[i]
        })
      }
      await done(transaction)
    },
    readLatest: async (count) => {
      const [, frames] = store('readonly')
      const found = []
      await new Promise((resolve, reject) => {
        const cursor = frames.openCursor(null, 'prev')
        cursor.onerror = () => reject(cursor.error)
        cursor.onsuccess = () => {
          const position = cursor.result
          if (position === null || found.length >= count) {
            resolve()
            return
          }
          found.push(position.value)
          position.continue()
        }
      })
      return found.reverse()
    },
    readRange: async (from, to) => {
      const [, frames] = store('readonly')
      return request(frames.getAll(globalThis.IDBKeyRange.bound(from, to)))
    },
    deleteBefore: async (index) => {
      const [transaction, frames] = store('readwrite')
      frames.delete(globalThis.IDBKeyRange.upperBound(index, true))
      await done(transaction)
    },
    deleteBeforeTime: async (timestamp) => {
      const [transaction, frames] = store('readwrite')
      const cursor = frames.index('timestamp').openCursor(globalThis.IDBKeyRange.upperBound(timestamp, true))
      cursor.onsuccess = () => {
        const position = cursor.result
        if (position === null) return
        position.delete()
        position.continue()
      }
      await done(transaction)
    },
    clear: async () => {
      const [transaction, frames] = store('readwrite')
      frames.clear()
      await done(transaction)
    },
    close: async () => {
      if (database !== null) database.close()
      database = null
    }
  }
}
