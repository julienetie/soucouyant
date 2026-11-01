// Types for soucouyant/storage-indexeddb (browsers).

import type { StorageAdapter } from '../soucouyant-temporal.js'

export interface IndexedDbStorageOptions {
  /** Default: the databaseName setting, 'soucouyant'. */
  readonly databaseName?: string
  /** Default: the objectStoreName setting, 'transient-state'. */
  readonly objectStoreName?: string
}

/** IndexedDB storage for browsers. */
export declare function indexedDbStorage(options?: IndexedDbStorageOptions): StorageAdapter
