// Devtools: the logger behind `observe`, plus tree() and table().
// Importing this module is what turns observation on; production bundles
// that never import it pay nothing.

import { settings, setObserver, records, idOfStateObject, headValueOf, tipValue, objectCount } from './engine.js'
import { persistEnabled } from './temporal/log.js'
import { namespaceMeta } from './accessor.js'
import { trajectoryOwners } from './temporal/trajectory.js'
import { chain } from './temporal/chain.js'
import { clock, startTime } from './environment.js'

const levels = { minimal: 1, moderate: 2, verbose: 3 }
const eventLevels = { stateChange: 1, error: 1, nonChange: 2, mutex: 2, buffered: 2, seek: 3, trajectory: 3 }

const nameOf = (id) => id < 0 ? 'chain' : records[id].address

const log = (kind, id, detail) => {
  const level = levels[settings.observe] ?? 0
  if (level === 0 || (eventLevels[kind] ?? 3) > level) return
  const prefix = level === 3 ? `[soucouyant +${(clock() - startTime).toFixed(1)}ms]` : '[soucouyant]'
  if (kind === 'error') console.error(prefix, `subscriber of ${nameOf(id)} threw`, detail)
  else console.log(prefix, kind, nameOf(id), detail)
}

setObserver(log)

const describeStateObject = (id) => {
  const record = records[id]
  return {
    state: headValueOf(id),
    latest: tipValue[id],
    subscribers: record.liveSlots,
    finiteStates: record.finiteStates,
    trajectory: record.trajectory === null ? null : record.trajectory.position
  }
}

const printNamespace = (target, label) => {
  console.group(label)
  for (const name of Object.keys(target)) {
    const child = target[name]
    const id = idOfStateObject.get(child)
    if (id !== undefined) console.log(`${name}:`, headValueOf(id))
    else printNamespace(child, name)
  }
  console.groupEnd()
}

const framesFor = (aliases) => {
  const frames = chain.expose()
  if (aliases.length === 0) return frames
  const wanted = new Set(aliases)
  return frames.filter((frame) => wanted.has(frame.alias))
}

export const tree = (target, ...aliases) => {
  if (target === chain) {
    console.group('chain')
    if (!persistEnabled) console.log('(persist is off: no history)')
    for (const frame of framesFor(aliases)) {
      console.log(`#${frame.index}`, frame.identity, frame.state, frame.alias === null ? '' : `(${frame.alias})`)
    }
    console.groupEnd()
    return
  }
  const trajectoryOwner = trajectoryOwners.get(target)
  if (trajectoryOwner !== undefined) {
    console.group(`${records[trajectoryOwner].address} trajectory`)
    console.log(target())
    console.groupEnd()
    return
  }
  const id = idOfStateObject.get(target)
  if (id !== undefined) {
    console.group(records[id].address)
    const description = describeStateObject(id)
    for (const key of Object.keys(description)) console.log(`${key}:`, description[key])
    console.groupEnd()
    return
  }
  const meta = namespaceMeta(target)
  if (meta === undefined) throw new TypeError('tree() takes o, a namespace, a stateObject, a trajectory or chain')
  printNamespace(target, meta.address === '' ? 'o' : meta.address)
}

const rowsForNamespace = (target, rows) => {
  for (const name of Object.keys(target)) {
    const child = target[name]
    const id = idOfStateObject.get(child)
    if (id !== undefined) rows.push({ address: records[id].address, state: headValueOf(id), latest: tipValue[id], subscribers: records[id].liveSlots })
    else rowsForNamespace(child, rows)
  }
  return rows
}

export const table = (target, ...aliases) => {
  if (target === chain) {
    console.table(framesFor(aliases).map((frame) => ({ index: frame.index, identity: frame.identity, state: frame.state, alias: frame.alias, ignored: frame.ignored })))
    return
  }
  const trajectoryOwner = trajectoryOwners.get(target)
  if (trajectoryOwner !== undefined) {
    const description = target()
    console.table(description === null ? [] : description.order.map((state, position) => ({ position, state, current: position === description.position })))
    return
  }
  const id = idOfStateObject.get(target)
  if (id !== undefined) {
    const address = records[id].address
    console.table(persistEnabled ? chain.expose().filter((frame) => frame.identity === address) : [{ address, state: headValueOf(id) }])
    return
  }
  if (namespaceMeta(target) === undefined) throw new TypeError('table() takes o, a namespace, a stateObject, a trajectory or chain')
  console.table(rowsForNamespace(target, []))
}

export const stateObjectCount = () => objectCount
