// Examples from TS_README.md, so the documentation can't drift from the types.
import { o, finite, value, pending, mutex, republish, head, chain, alias } from 'soucouyant/temporal'
import type { Pending, StateObject, AnyStateObject, Props, StorageAdapter, StorageBatch } from 'soucouyant/temporal'
import { assert, type Equal } from '../expect.js'

// Declaring typed state
const state = o({
  editor: { text: '', cursor: { line: 1, column: 0 } },
  cart: { open: false, items: [] as string[] },
  account: { profile: value({ name: 'Ada', role: 'admin' as 'admin' | 'member' }) },
  traffic: { light: finite('red', ['red', 'green', 'amber']) }
})
const line = state.editor.cursor.line()
assert<Equal<typeof line, number>>()
state.cart.items((items) => [...items, 'sorrel'])
const role = state.account.profile().role
assert<Equal<typeof role, 'admin' | 'member'>>()

// Pending and async state
interface User { id: number, name: string }
const fetchUser = async (): Promise<User> => ({ id: 1, name: 'Ada' })
const session = o({ session: { user: value<User | Pending>(pending) } })
const loading = session.session.user(async () => fetchUser())
assert<Equal<typeof loading, Promise<User | Pending | undefined>>>()
const user = session.session.user()
if (user !== pending) assert<Equal<typeof user.name, string>>()

// Combining shapes
const editorShape = { notes: { body: '' } }
const cartShape = { basket: { count: 0 } }
const combined = o({ ...editorShape, ...cartShape })
const count = combined.basket.count()
assert<Equal<typeof count, number>>()

// Subscriptions
const render = (text: string, props: Props<string>): void => { void text; void props }
const named = state.editor.text.sub(render, 'toolbar')
assert<Equal<typeof named, 'toolbar'>>()

// Generic code
const resetTo = <T>(stateObject: StateObject<T>, initial: T) => stateObject(initial)
resetTo(state.editor.text, '')
// @ts-expect-error 0 is not a string
resetTo(state.editor.text, 0)
const all: AnyStateObject[] = [state.editor.text, state.traffic.light]
void all

// Mutex
const release = mutex.lock(state.editor.text)
release((text) => text.trim())
release(republish)

// Temporal
o.config({ persist: true, mergeFidelity: '200ms' })
head.seek('2.5s')
state.editor.text(alias('opened', 'Hello'))
const removed = chain.purge()
assert<Equal<typeof removed, number>>()

// A custom storage adapter
const remoteStorage: StorageAdapter = {
  open: async ({ databaseName, objectStoreName }) => { void databaseName; void objectStoreName; return { firstIndex: -1, lastIndex: -1 } },
  writeFrames: async (batch: StorageBatch) => { void batch },
  readLatest: async (count) => { void count; return [] },
  readRange: async (from, to) => { void from; void to; return [] },
  deleteBefore: async (index) => { void index },
  deleteBeforeTime: async (timestamp) => { void timestamp },
  clear: async () => {},
  close: async () => {}
}
o.config({ offlineStorage: { mode: 'all', adapter: remoteStorage } })
