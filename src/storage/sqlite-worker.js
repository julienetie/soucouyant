// Runs inside a worker thread: owns the SQLite connection.
// Values are stored with v8.serialize(), the same structured clone format
// IndexedDB uses, so both backends store identical data.

import { parentPort, workerData } from 'node:worker_threads'
import { DatabaseSync } from 'node:sqlite'
import { serialize, deserialize } from 'node:v8'

const FRAME_PENDING = 1
const FRAME_PURGED = 4

let database = null
let statements = null
// Session object ids are only valid for this session; addresses are stable
const storageIdBySessionId = new Map()

const schema = `
CREATE TABLE IF NOT EXISTS objects (storage_id INTEGER PRIMARY KEY, address TEXT UNIQUE NOT NULL) STRICT;
CREATE TABLE IF NOT EXISTS frames (
  frame_index INTEGER PRIMARY KEY,
  timestamp REAL NOT NULL,
  object_id INTEGER NOT NULL REFERENCES objects (storage_id),
  finite_index INTEGER NOT NULL,
  flags INTEGER NOT NULL,
  alias TEXT,
  value BLOB
) STRICT;
CREATE INDEX IF NOT EXISTS frames_by_time ON frames (timestamp);
CREATE INDEX IF NOT EXISTS frames_by_alias ON frames (alias) WHERE alias IS NOT NULL;
`

const selectFrames = 'SELECT f.frame_index AS frameIndex, f.timestamp, o.address, f.finite_index AS finiteIndex, f.flags, f.alias, f.value FROM frames f JOIN objects o ON o.storage_id = f.object_id'

const open = () => {
  database = new DatabaseSync(workerData.path)
  database.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;')
  database.exec(schema)
  statements = {
    insertObject: database.prepare('INSERT OR IGNORE INTO objects (address) VALUES (?)'),
    objectId: database.prepare('SELECT storage_id AS storageId FROM objects WHERE address = ?'),
    upsertFrame: database.prepare('INSERT OR REPLACE INTO frames (frame_index, timestamp, object_id, finite_index, flags, alias, value) VALUES (?, ?, ?, ?, ?, ?, ?)'),
    latest: database.prepare(`${selectFrames} ORDER BY f.frame_index DESC LIMIT ?`),
    range: database.prepare(`${selectFrames} WHERE f.frame_index BETWEEN ? AND ? ORDER BY f.frame_index`),
    bounds: database.prepare('SELECT MIN(frame_index) AS firstIndex, MAX(frame_index) AS lastIndex FROM frames'),
    deleteBefore: database.prepare('DELETE FROM frames WHERE frame_index < ?'),
    deleteBeforeTime: database.prepare('DELETE FROM frames WHERE timestamp < ?')
  }
  const bounds = statements.bounds.get()
  return {
    firstIndex: bounds.firstIndex === null ? -1 : bounds.firstIndex,
    lastIndex: bounds.lastIndex === null ? -1 : bounds.lastIndex
  }
}

const write = (batch) => {
  database.exec('BEGIN')
  try {
    for (const [sessionId, address] of batch.objects) {
      statements.insertObject.run(address)
      storageIdBySessionId.set(sessionId, statements.objectId.get(address).storageId)
    }
    for (let i = 0; i < batch.indices.length; i++) {
      const flags = batch.flags[i]
      const value = (flags & (FRAME_PENDING | FRAME_PURGED)) !== 0 ? null : serialize(batch.values[i])
      statements.upsertFrame.run(
        batch.indices[i],
        batch.timestamps[i],
        storageIdBySessionId.get(batch.objectIds[i]),
        batch.finiteIndexes[i],
        flags,
        batch.aliases[i],
        value
      )
    }
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}

const toFrame = (row) => ({
  index: row.frameIndex,
  timestamp: row.timestamp,
  identity: row.address,
  state: row.value === null ? null : deserialize(row.value),
  finiteIndex: row.finiteIndex,
  alias: row.alias,
  flags: row.flags
})

const handlers = {
  open,
  write,
  readLatest: ({ count }) => statements.latest.all(count).reverse().map(toFrame),
  readRange: ({ from, to }) => statements.range.all(from, to).map(toFrame),
  deleteBefore: ({ index }) => { statements.deleteBefore.run(index) },
  deleteBeforeTime: ({ timestamp }) => { statements.deleteBeforeTime.run(timestamp) },
  clear: () => {
    database.exec('DELETE FROM frames; DELETE FROM objects;')
    storageIdBySessionId.clear()
  },
  close: () => {
    if (database !== null) database.close()
    database = null
  }
}

parentPort.on('message', (message) => {
  try {
    const result = handlers[message.type](message.payload)
    parentPort.postMessage({ id: message.id, result })
  } catch (error) {
    parentPort.postMessage({ id: message.id, error: error instanceof Error ? error.message : String(error) })
  }
})
