// Compile-time assertions. Equal is true only when two types are identical.
export type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false
export const assert = <T extends true>(): T | undefined => undefined
