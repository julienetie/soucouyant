// Types for soucouyant/storage-sqlite (Node.js 22.5 and later).

import type { StorageAdapter } from '../soucouyant-temporal.js'

export interface SqliteStorageOptions {
  /** The database file. Default 'soucouyant.db'. */
  readonly path?: string
}

/** SQLite storage through node:sqlite, run in a worker thread so the main thread never blocks. */
export declare function sqliteStorage(options?: SqliteStorageOptions): StorageAdapter
