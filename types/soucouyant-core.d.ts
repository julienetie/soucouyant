// Types for soucouyant, the core. The runtime is the plain JavaScript in
// dist/js; these declarations describe it. soucouyant-temporal.d.ts extends
// several of these interfaces when temporal is imported.

// ---------------------------------------------------------------------------
// Symbols
// ---------------------------------------------------------------------------

/** The state of a stateObject that has no value yet. Publish it to mark a stateObject as loading. */
export declare const pending: unique symbol
export type Pending = typeof pending

/** Passed to a mutex release function: notify subscribers again without recording a new state. */
export declare const republish: unique symbol
export type Republish = typeof republish

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------

/** Which way the head moved to reach the state being delivered. */
export type Direction = 'fwd' | 'rev'

/** A subscription reference. sub() makes one when none is given. A function can't be a reference: a second function is the inverted subscriber. */
export type SubscriptionRef = string | number | symbol | object

/**
 * The second argument a subscriber receives. Props are only built for
 * subscribers that declare two parameters, or subscribe with sub.withProps().
 */
export interface Props<T> {
  /** The state being delivered. */
  readonly state: T
  /** The stateObject's address, such as 'editor > text'. */
  readonly identity: string
  /** When the state was recorded, in milliseconds from performance.timeOrigin. */
  readonly timestamp: number
  /** The next recorded state after the head, when the head is in the past. Always undefined without temporal. */
  readonly fwd: T | undefined
  /** The state subscribers received before this one. */
  readonly rev: T | undefined
  /** The finite states, or null for a stateObject without them. */
  readonly states: readonly T[] | null
  /** The position of the state in states, or -1. */
  readonly finiteIndex: number
  /** The frame index in the chain. -1 without recorded history. */
  readonly index: number
  /** Milliseconds between the start of the session and timestamp. */
  readonly timeOffset: number
  readonly direction: Direction
  /** True when the state is pending. */
  readonly pending: boolean
  /** The alias of the frame being shown, or null. */
  readonly alias: string | null
}

/** Receives each new state. Declare the second parameter to receive props. */
export type Subscriber<T> = (state: T, props: Props<T>) => void

export interface Subscribe<T> {
  /**
   * Subscribes with a proceeding subscriber, for states reached moving
   * forward, and an inverted one, for states reached moving back through
   * history. Returns both references.
   */
  <P extends SubscriptionRef = string, I extends SubscriptionRef = string>(subscriber: Subscriber<T>, inverted: Subscriber<T>, ref?: P, invertedRef?: I): [P, I]
  /** Subscribes to every new state. Returns the reference, for unsub(). */
  <R extends SubscriptionRef = string>(subscriber: Subscriber<T>, ref?: R): R
}

export interface Sub<T> extends Subscribe<T> {
  /** Like sub(), but always builds props, even for a subscriber written with one parameter. */
  readonly withProps: Subscribe<T>
}

/** An absolute module path for scope(): it must start with '/' so it matches whole file names. */
export type ScopePath = `/${string}`

// ---------------------------------------------------------------------------
// StateObjects
// ---------------------------------------------------------------------------

/**
 * A stateObject. Call it with no argument to get its state, with a value to
 * publish, or with a function to publish from the newest state.
 */
export interface StateObject<T> {
  /** Gets the state. */
  (): T
  /** Calling with undefined is a get too. */
  (value: undefined): T
  /**
   * Publishes the result of an async callback. The stateObject stays locked
   * until the promise settles, so concurrent updates queue rather than race.
   */
  (update: (current: T) => Promise<T | undefined>): Promise<T | undefined>
  /** Publishes the callback's result. Returning undefined publishes nothing. */
  (update: (current: T) => T | undefined): T | undefined
  /** Publishes a state. Returns it, or undefined when it was queued behind a lock. */
  (value: T): T | undefined
  readonly sub: Sub<T>
  /** Removes subscriptions by reference. Returns how many were removed. */
  unsub(...refs: SubscriptionRef[]): number
  /** Development only: limits which modules may use this stateObject. */
  scope(...paths: [ScopePath, ...ScopePath[]]): this
  /** When the stateObject was declared, in milliseconds from performance.timeOrigin. */
  startTime(): number
}

/**
 * A stateObject with finite states. T is the state type; E is the type of
 * each declared entry, which differs from T only for keyframes.
 */
export interface FiniteStateObject<T, E = T> extends StateObject<T> {}

// Any stateObject, whatever its state type
export type AnyStateObject = StateObject<any>

// ---------------------------------------------------------------------------
// Finite states and keyframes
// ---------------------------------------------------------------------------

/**
 * A keyframe: a finite state with timing and an action, used by
 * trajectories. The stateObject holds `state`; the rest drives playback.
 * Keyframes may carry fields of their own, which the action reads from
 * props.keyframe.
 */
export interface Keyframe<S = unknown> {
  readonly state: S
  /** Runs as the keyframe becomes active, when the trajectory has keyframeActions. */
  readonly action: (state: S, props: KeyframeProps<S>) => void
  /** Milliseconds the keyframe is shown. Needed with keyframeActions. */
  readonly duration?: number
  /** Milliseconds before the action runs. Needed with keyframeActions. */
  readonly startDelay?: number
  /** Milliseconds held after duration. Needed with keyframeActions. */
  readonly endDelay?: number
  readonly [field: string]: unknown
}

/** Props passed to a keyframe action: the usual props plus the keyframe itself. */
export type KeyframeProps<S> = Props<S> & { readonly keyframe: Keyframe<S> }

/** States a keyframe can hold. They're inferred as literals, as with any finite states. */
export type KeyframeState = string | number | bigint | boolean | null

/** The state an entry declares: a keyframe's state, or the entry itself. */
export type StateOfEntry<E> = E extends { readonly state: infer S, readonly action: (...args: any[]) => unknown } ? S : E

type TransitionKey<T> = T extends string | number | bigint | boolean | null | undefined ? `${T}` : never

/**
 * Which states each state may move to. Object keys are the states written as
 * strings; use a Map for states that are objects. A state with an empty
 * list is terminal, and a state left out may move anywhere.
 */
export type TransitionRules<T> =
  | { readonly [K in TransitionKey<T>]?: readonly T[] }
  | ReadonlyMap<T, readonly T[]>

export interface FiniteOptions<T> {
  readonly transitions?: TransitionRules<T>
}

// TypeScript 5.4 has NoInfer built in; this works from 5.0
type NoInference<T> = [T][T extends any ? 0 : never]

// ---------------------------------------------------------------------------
// Object declarations: o({ ... })
// ---------------------------------------------------------------------------

declare const declarationBrand: unique symbol

/** What finite() returns: a finite stateObject waiting to be declared. */
export interface FiniteDeclaration<T, E = T> {
  readonly [declarationBrand]: { readonly finite: T, readonly entry: E }
}

/** What value() returns: a stateObject waiting to be declared. */
export interface ValueDeclaration<T> {
  readonly [declarationBrand]: { readonly value: T }
}

/**
 * Declares a finite stateObject of keyframes inside o({ ... }). The state
 * type comes from each keyframe's state, and actions are typed from it.
 */
export declare function finite<const S extends KeyframeState>(
  initial: NoInference<S | Keyframe<S>> | undefined,
  keyframes: readonly Keyframe<S>[],
  options?: FiniteOptions<NoInference<S>>
): FiniteDeclaration<S, Keyframe<S>>
/**
 * Declares a finite stateObject inside o({ ... }). The states are inferred
 * as a union of literals, so publishing anything else is a type error.
 *
 *     o({ traffic: { light: finite('red', ['red', 'green', 'amber']) } })
 */
export declare function finite<const E>(
  initial: NoInference<StateOfEntry<E> | E> | undefined,
  states: readonly E[] | ReadonlySet<E>,
  options?: FiniteOptions<NoInference<StateOfEntry<E>>>
): FiniteDeclaration<StateOfEntry<E>, E>

/**
 * Declares a stateObject inside o({ ... }) whose state is a plain object,
 * which o() would otherwise read as a namespace. Also useful to widen the
 * type: value<User | Pending>(pending).
 */
export declare function value<T>(state: T): ValueDeclaration<T>

type Primitive = string | number | bigint | boolean | symbol | null | undefined

/** Values o({ ... }) declares as states rather than namespaces, without value(). */
export type StateLeaf =
  | Primitive
  | readonly unknown[]
  | ReadonlyMap<any, any>
  | ReadonlySet<any>
  | WeakMap<object, any>
  | WeakSet<object>
  | Date
  | RegExp
  | Error
  | ArrayBuffer
  | ArrayBufferView
  | Promise<any>

// undefined declares a pending stateObject. On its own it says nothing about
// the type to come, so the state is unknown; value<User | Pending>(pending)
// types it. In a union, undefined becomes Pending
type StateOfValue<T> = [T] extends [undefined] ? unknown : undefined extends T ? Exclude<T, undefined> | Pending : T

/** The node o({ ... }) creates for one entry of the object. */
export type NodeOf<S> =
  [S] extends [FiniteDeclaration<infer T, infer E>] ? FiniteStateObject<T, E>
    : [S] extends [ValueDeclaration<infer T>] ? StateObject<StateOfValue<T>>
      : [S] extends [StateLeaf] ? StateObject<StateOfValue<S>>
        : Namespace<S>

export interface NamespaceMethods {
  /** Development only: limits which modules may use this namespace and everything in it. */
  scope(...paths: [ScopePath, ...ScopePath[]]): this
}

/** A namespace: its children, typed from the object that declared them. */
export type Namespace<S> = { readonly [K in Extract<keyof S, string>]: NodeOf<S[K]> } & NamespaceMethods

type ReservedName =
  | 'scope' | 'constructor' | 'hasOwnProperty' | 'isPrototypeOf' | 'propertyIsEnumerable'
  | 'toLocaleString' | 'toString' | 'valueOf' | '__proto__'
  | '__defineGetter__' | '__defineSetter__' | '__lookupGetter__' | '__lookupSetter__'
type RootReservedName = 'config' | 'isolate' | 'head' | 'chain' | 'name' | 'length' | 'prototype' | 'caller' | 'arguments' | 'apply' | 'call' | 'bind'

// Marks what o() would reject at runtime as never, so the mistake is a type
// error on the offending key: reserved names, functions and empty namespaces.
// Valid leaves map to unknown rather than their own type: echoing the type
// back would make TypeScript keep literal types, typing text: '' as ''
type CheckLevel<S, Reserved> = {
  [K in keyof S]: K extends Reserved ? never
    : S[K] extends (...args: any[]) => unknown ? never
      : [S[K]] extends [FiniteDeclaration<any, any> | ValueDeclaration<any> | StateLeaf] ? unknown
        : keyof S[K] extends never ? never
          : CheckLevel<S[K], ReservedName>
}

/** Checks an object passed to o() for names and values it can't declare. */
export type ShapeCheck<S> = S extends readonly unknown[] ? never : keyof S extends never ? never : CheckLevel<S, ReservedName | RootReservedName>

// ---------------------------------------------------------------------------
// The root, o
// ---------------------------------------------------------------------------

/**
 * Register the object you declare with, to type o itself everywhere:
 *
 *     const shape = { editor: { text: '' } }
 *     export const state = o(shape)
 *
 *     declare module 'soucouyant' {
 *       interface Register { shape: typeof shape }
 *     }
 *
 * Without it, o accepts any path and states are unknown.
 */
export interface Register {}

/** Any path, for when no shape is registered: every node is both a namespace and a stateObject. */
export interface UntypedTree {
  readonly [name: string]: UntypedNode
}
export type UntypedNode = FiniteStateObject<unknown> & NamespaceMethods & UntypedTree

/** The tree o exposes: the registered shape, or UntypedTree. */
export type RegisteredTree = Register extends { readonly shape: infer S } ? Namespace<S> : UntypedTree

/** What a tagged declaration returns: call it with the initial state. */
export interface Declare {
  /** Declares a finite stateObject of keyframes. */
  <const S extends KeyframeState>(state: NoInference<S | Keyframe<S>> | undefined, keyframes: readonly Keyframe<S>[], options?: FiniteOptions<NoInference<S>>): O
  /** Declares a finite stateObject. */
  <const E>(state: NoInference<StateOfEntry<E> | E> | undefined, finiteStates: readonly E[] | ReadonlySet<E>, options?: FiniteOptions<NoInference<StateOfEntry<E>>>): O
  /** Declares a stateObject. With no state, it starts pending. */
  (state?: unknown): O
}

export type Execution = 'sync' | 'async-queue' | 'async-frame'
export type ObserveLevel = 'minimal' | 'moderate' | 'verbose'

/** Options for o.config(). Each one is optional; the rest keep their values. */
export interface ConfigOptions {
  allowNaN?: boolean
  /** Most namespaces above a stateObject. Default 4. */
  namespaceDepth?: number
  /** When subscribers run. Default 'async-frame' in browsers and 'async-queue' in Node. */
  execution?: Execution
  /** Logs events through soucouyant/devtools. */
  observe?: false | ObserveLevel
  /** Checks values are cloneable, and with 'freeze', freezes them. */
  development?: boolean | 'freeze'
  /** Stores a structured clone of every published object. */
  clone?: boolean
  /** 'sync-only' makes an async callback throw instead of locking. */
  asyncCallbacks?: 'lock' | 'sync-only'
  /** Milliseconds before a hung async callback's lock is released. Default 10000. */
  asyncLockTimeout?: number
}

/** The current configuration, as o.config() returns it. */
export interface Settings {
  readonly allowNaN: boolean
  readonly namespaceDepth: number
  readonly execution: Execution
  readonly observe: false | ObserveLevel
  readonly development: boolean | 'freeze'
  readonly clone: boolean
  readonly asyncCallbacks: 'lock' | 'sync-only'
  readonly asyncLockTimeout: number
}

export interface Root {
  /** Declares one stateObject: o`namespace > name`(state). */
  (strings: TemplateStringsArray, ...values: unknown[]): Declare
  /**
   * Declares a whole object of stateObjects and returns them, typed from the
   * object. Plain objects are namespaces; use finite() and value() for the
   * leaves that need them.
   */
  <S extends object>(shape: S & ShapeCheck<S>): Namespace<S>
  config(options: ConfigOptions): Settings
  /** Node only: runs the handler with its own values, subscribers and locks, carried across every await. */
  isolate<R>(handler: () => R): R
  /** Development only: limits which modules may use any state. */
  scope(...paths: [ScopePath, ...ScopePath[]]): O
}

/** The type of o: the root plus the registered tree. */
export type O = Root & RegisteredTree

/** The root of all state. */
export declare const o: O

/** Stops new names being added to the target and the namespaces above it. Returns the target. */
export declare function freeze<T extends O | NamespaceMethods | AnyStateObject>(target: T): T

// ---------------------------------------------------------------------------
// Mutex
// ---------------------------------------------------------------------------

/** Releases a lock on one stateObject. With a value, publishes it as the holder first. */
export interface Release<T> {
  (): undefined
  (update: (current: T) => T | undefined): T | undefined
  (value: T | Republish): T | undefined
}

/** Releases the lock on every stateObject. With a stateObject and a value, publishes it first. */
export interface ReleaseAll {
  (): undefined
  <T>(stateObject: StateObject<T>, update: (current: T) => T | undefined): T | undefined
  <T>(stateObject: StateObject<T>, value: T | Republish): T | undefined
}

/** A publish waiting behind a lock. */
export interface BufferedEntry {
  /** The address of the locked stateObject, or 'all'. */
  readonly target: string
  /** The address of the stateObject the publish is for. */
  readonly identity: string
  readonly kind: 'value' | 'callback'
  readonly payload: unknown
}

export interface Mutex {
  /** Locks every stateObject. Publishes queue until release. */
  lock(target: O): ReleaseAll
  /** Locks one stateObject. Only the release function publishes through the lock; other publishes queue. */
  lock<T>(stateObject: StateObject<T>): Release<T>
  /** Releases a lock without publishing. Returns false when it wasn't locked. */
  unlock(target: O | AnyStateObject): boolean
  /** Publishes waiting behind a lock. */
  readonly buffer: BufferedEntry[]
}

export declare const mutex: Mutex

export {}
