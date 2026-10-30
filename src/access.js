// Composes the optional layers around get, publish and sub. With no layer
// active the stateObject calls straight into the core.

import { baseAccess, installAccess } from './engine.js'

let activeIsolationLayer = null
let activeScopeLayer = null

const rebuild = () => {
  let access = baseAccess
  if (activeIsolationLayer !== null) access = activeIsolationLayer(access)
  if (activeScopeLayer !== null) access = activeScopeLayer(access)
  installAccess(access)
}

export const setIsolationLayer = (layer) => {
  activeIsolationLayer = layer
  rebuild()
}

export const setScopeLayer = (layer) => {
  if (layer === activeScopeLayer) return
  activeScopeLayer = layer
  rebuild()
}
