import { pending, empty } from './helpers.js'
import stateObjectPartial from './state-object.js'

// Create main chain
const o = stateObjectPartial('main')

// Create additional timeline chains
o.createChain = (chainName, config) => {
  o[chainName] = stateObjectPartial(chainName, config)
}

const Debug = {
  // mode: {
  //   set enable(_) {
  //     // Throws errors instead of console.error
  //   },
  //   set enableOnAddressStart(addressStart) {
  //     // String or array of addresses
  //     // Throws errors insread of console.error
  //   }
  // },
  // logStatsOnChange() {
  //
  // },
  // tableStatsOnChange() {
  //
  // }
}

export { o, pending, Debug, empty }
