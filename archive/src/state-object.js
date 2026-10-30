import { startsWithUppercase, empty, pending } from './helpers.js'
import { chainFactory } from './accumulator.js'
import cache from './cache.js'

/**
 * @param {*} state
 * @param {number} identity - the unique state subscription identifier
 */
const stateMachine = (chain, identity, state, isCreation) => {
  chain.setState(
    identity,
    state === undefined ? pending : state
  )

  const stateModifier = callback => {
    if (callback === undefined) {
      // initial
      return chain.getState(identity)
    }

    if (typeof callback !== 'function') {
      // callback is now the value of the state
      if (callback === undefined) {
        return callback
      }

      // callback is now the value of the state
      chain.setState(identity, callback)
      return callback
    }

    if (typeof callback === 'function') {
      const lastState = chain.getState(identity)
      const newState = callback(lastState)
      if (newState === undefined) {
        return lastState
      } else {
        chain.setState(identity, newState)
        return newState
      }
    }

    console.error('Something went wrong')
  }
  /**
     * subscribe method.
     * @param {string} ref - subscription reference.
     * @param {Function} callback - On subscribe callback
     */
  stateModifier.sub = (...params) => {
    // Get ref value
    const ref = params.pop()
    console.trace(ref)
    // Get callback fns
    const forwardCallback = params[0]
    const activeCallback = params[1]
    const reverseCallback = params[2]

    // Store callback values
    // const callbacks = {}
    // forwardCallback && (callbacks.forwardCallback = forwardCallback)
    // activeCallback && (callbacks.activeCallback = activeCallback)
    // reverseCallback && (callbacks.reverseCallback = reverseCallback)

    if (cache.subscriptions[identity] === undefined) {
      cache.subscriptions[identity] = {}
      cache.suspend[identity] = {}
    }

    if (cache.subscriptions[identity][ref] === undefined) {
      cache.subscriptions[identity][ref] = {
        forwardCallback,
        activeCallback,
        reverseCallback
      }
      cache.suspend[identity][ref] = false
    } else {
      console
        .error(`The subscriptions reference ${ref} is already in use for identity ${identity}`)
    }
  }
  /**
     * suspend method.
     * @param {string} ref - subscription reference.
     * @param {Function} callback - On subscribe callback
     */
  stateModifier.suspend = ref => {
    cache.suspend[identity][ref] = true
  }

  /**
     * suspend method.
     * @param {string} ref - subscription reference.
     * @param {Function} callback - On subscribe callback
     */
  stateModifier.unsubscribe = ref => {
    delete cache.subscriptions[identity][ref]
  }

  return stateModifier
}

const reservedWords = [
  'createChain',
  'config',
  'chain'
]

let hasMain = 0
/**
* State object is a side effect represented by the "o" letter.
* It takes a namespace address separeated by forward arrows and
* an inital state.
*
* @param { string } address - The namespace address of the state object.
* @param { *} state - The value of the state.
* @returns { Function } StateObject.
*/
const stateObjectPartial = (chainName, config = {}) => {
  if (hasMain === 0 && chainName === 'main') {
    hasMain++
  } else {
    if (chainName === 'main' || chainName === 'Main') return console.error('There can only be one main chain')

    if (reservedWords.includes(chainName)) {
      return console
        .error(`Soucouyant: Cannot create chain as ${chainName} is a reserved word.`)
    }

    if (!(chainName.startsWith('_') || startsWithUppercase(chainName))) {
      return console
        .error(`Soucouyant: ${chainName} is invalid. chianName should begin with an _ or capital letter.`)
    }
  }
  // Identity ensures that each
  /* state has a unique key for the:
     cache.subscriptions[identity]
     as an object.
     That object then stores references for each
     subscription.See above. */
  let identity = -1
  /**
    *
    * @param { Array } addressParts - Namespaces separated by >
    * @param { number } count - 0.
  * @param {*} state
  * @param { number } length - Number of namespaces.
  * @param { boolean } isCollection - false.
  * @param {*} nextPart - null.
  */
  const createAddress = (chain, addressParts, count, state, length, isCollection, nextPart) => {
    if (count === 0 && length === 1) {
      nextPart = stateObject
    }
    const newPart = (addressParts[count] + '').trim()
    if (nextPart === null) {
      // Creates the next property as an object.
      // And assigns the nextPart as that property to
      // recycle into it's self to add additional levels.
      // Once!
      if (stateObject[newPart] === undefined) {
        nextPart = stateObject[newPart] = {}
      } else {
        nextPart = stateObject[newPart]
      }
    } else {
      // Creates the next property as an object.
      // And assigns the nextPart as that property to
      // recycle into it's self to add additional levels.
      // beyond the first (I think)
      const isEndOfPath = count === length - 1
      if (nextPart[newPart] === undefined) {
        identity++
        const machine = isEndOfPath ? isCollection ? state : stateMachine(chain, identity, state) : {}
        nextPart = nextPart[newPart] = machine // Creates the next property as an object.
        if (isEndOfPath) return
      } else {
        nextPart = nextPart[newPart]
        if (isEndOfPath) {
          return
        }
      }
    }
    count++
    createAddress(chain, addressParts, count, state, length, isCollection, nextPart)
  }

  const stateObject = (address) => {
    return (state) => {
      const addressParts = address[0].split('>')
      if (addressParts.length === 0) return console.error('An address requires a namespace')

      console.log('@@@', state)

      if (chainName === 'main') {
        const firstPartFirstChar = addressParts[0][0] || empty
        if (firstPartFirstChar === empty) return console.error('Sououyant: Address cannot be an empty string')

        if (firstPartFirstChar === '_' || firstPartFirstChar === firstPartFirstChar.toUpperCase()) {
          return console.error('Soucouyant: The first address part on the main chain cannot begin with an underscore, capital letter or special character.')
        }
      }
      const addressPartsLength = addressParts.length
      const chain = chainFactory(chainName, config)
      createAddress(
        chain,
        addressParts,
        0,
        state,
        addressPartsLength,
        false,
        null,
        stateObject
      )
      return stateObject
    }
  }
  stateObject.chain = {
    name: chainName
  }
  return stateObject
}

export default stateObjectPartial
