export const pending = Symbol('pending')
export const republish = Symbol('republish')

export const isPlainObjectPartialCheck = value => {
  const proto = Object.getPrototypeOf(value)
  return proto === null || proto === Object.prototype
}

export const areErrorsSimilar = (errorA, errorB) => (
  errorA.name === errorB.name
  && errorA.message === errorB.message
  && errorA.constructor === errorB.constructor
)

export const areDatesSimilar = (dateA, dateB) => dateA.valueOf() === dateB.valueOf()

export const areRegExpSimilar = (regexA, regexB) => regexA.source === regexB.source && regexA.flags === regexB.flags

export const arePlainObjectsSimilar = (objA, objB) => {
  const keysA = Object.keys(objA)
  const keysB = Object.keys(objB)

  if (keysA.length !== keysB.length) return false

  for (const key of keysA) {
    if (objA[key] !== objB[key]) return false
  }
  return true
}

export const areArraysSimilar = (arrA, arrB) => {
  if (arrA.length !== arrB.length) return false
  return arrA.every((value, i) => value === arrB[i])
}

export const areMapsSimilar = (mapA, mapB) => {
  if (mapA.size !== mapB.size) return false

  for (const [key, val] of mapA) {
    if (!mapB.has(key) || mapB.get(key) !== val) return false
  }
  return true
}

export const areSetsSimilar = (setA, setB) => {
  if (setA.size !== setB.size) return false

  for (const item of setA) {
    if (!setB.has(item)) return false
  }
  return true
}

export const { isArray } = Array

export const startsWithUppercase = string => /^[A-Z]/.test(string)

export const empty = ''

export const normalizeNumbers = value => {
  if (value === Infinity) return Infinity
  if (value === 0) return 0
  return Math.min(Math.max(value, Number.MIN_SAFE_INTEGER), Number.MAX_SAFE_INTEGER)
}
