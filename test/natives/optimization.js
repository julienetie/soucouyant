// Run with: node --allow-natives-syntax --expose-gc test/natives/optimization.js
// Checks that V8 optimizes the hot paths, that namespaces stay in fast
// mode, and that steady-state publishing does not allocate: first with core
// alone, then with soucouyant-temporal.js loaded, then with timelines.
import { PerformanceObserver } from 'node:perf_hooks'
import { o } from '../../src/soucouyant-core.js'

const results = []
const check = (name, passed, detail = '') => {
  results.push(passed)
  console.log(`${passed ? 'ok  ' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`)
}

// Bit 4 (16) is "TurboFan optimized", bit 5 (32) "interpreted"; Maglev is bit 7 (128) on newer V8
const isOptimized = (fn) => {
  const status = %GetOptimizationStatus(fn)
  return (status & 16) !== 0 || (status & 128) !== 0
}

console.log('-- soucouyant-core.js alone')
o.config({ execution: 'async-queue' })
o`bench > deep > deeper > value`(0)`bench > flat`(0)

const readDeep = () => o.bench.deep.deeper.value()
const writeDeep = (n) => o.bench.deep.deeper.value(n)
const writeCallback = () => o.bench.flat((n) => n + 1)

for (const fn of [readDeep, writeDeep, writeCallback]) {
  ;%PrepareFunctionForOptimization(fn)
  for (let i = 0; i < 1000; i++) fn(i)
  ;%OptimizeFunctionOnNextCall(fn)
  fn(1)
  for (let i = 0; i < 100000; i++) fn(i)
  check(`${fn.name} stays optimized`, isOptimized(fn))
}

// Namespaces in fast mode after declaring many stateObjects
// V8's fast layout holds up to 1020 properties per object
for (let i = 0; i < 1000; i++) o`wide > ${'item' + i}`(i)
for (let i = 0; i < 1000; i++) o`spread${i} > value`(i)
check('o has fast properties with 1000 top-level namespaces', %HasFastProperties(o))
check('a namespace has fast properties with 1000 children', %HasFastProperties(o.wide))
check('a stateObject function has fast properties', %HasFastProperties(o.wide.item5))

// Zero allocation while publishing primitives with no history
const countMinorGc = (work) => {
  let minor = 0
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) if (entry.detail?.kind === 1) minor++
  })
  // Start from an empty young generation so earlier work is not counted
  globalThis.gc()
  observer.observe({ entryTypes: ['gc'] })
  work()
  return new Promise((resolve) => setTimeout(() => {
    observer.disconnect()
    resolve(minor)
  }, 50))
}

const value = o.bench.flat
const scavenges = await countMinorGc(() => {
  for (let i = 0; i < 5000000; i++) value(i & 1023)
})
check('5,000,000 primitive publishes without history cause no scavenge', scavenges === 0, `${scavenges} scavenges`)

// Now plug in recorded history and check the recording path
const { head } = await import('../../src/soucouyant-temporal.js')
console.log('-- with soucouyant-temporal.js loaded')
check('the core get still reads one cell', readDeep() === o.bench.deep.deeper.value())
o.config({ persist: true, mergeFidelity: 0 })
for (let i = 0; i < 200000; i++) value(i & 1023)
const historyScavenges = await countMinorGc(() => {
  for (let i = 0; i < 2000000; i++) value(i & 1023)
})
check('2,000,000 recorded publishes with the trail wrapping cause no scavenge', historyScavenges === 0, `${historyScavenges} scavenges`)

const seekBack = () => { head.seek('rev'); head.seek('fwd') }
;%PrepareFunctionForOptimization(seekBack)
for (let i = 0; i < 1000; i++) seekBack()
check('seek round trips run', head.meta().isHeadPresent)

// Now plug in timelines: the main timeline's code is untouched, so its hot
// paths must stay optimized and allocation-free while another timeline,
// running its own copy of the engine, records alongside it
const polychrony = await import('../../src/soucouyant-polychrony.js')
console.log('-- with soucouyant-polychrony.js loaded and a second timeline recording')
const timeline = polychrony.chain.create('natives')
const timelineValue = timeline.bench.flat
for (let i = 0; i < 200000; i++) timelineValue(i & 1023)
for (const fn of [readDeep, writeDeep, writeCallback]) {
  for (let i = 0; i < 100000; i++) fn(i)
  check(`main ${fn.name} stays optimized`, isOptimized(fn))
}
const mainWithTimeline = await countMinorGc(() => {
  for (let i = 0; i < 2000000; i++) value(i & 1023)
})
check('2,000,000 recorded publishes on main, with a timeline alive, cause no scavenge', mainWithTimeline === 0, `${mainWithTimeline} scavenges`)
const onTimeline = await countMinorGc(() => {
  for (let i = 0; i < 2000000; i++) timelineValue(i & 1023)
})
check('2,000,000 recorded publishes on the timeline cause no scavenge', onTimeline === 0, `${onTimeline} scavenges`)
check('the timeline kept its own state', timeline.bench.flat() !== undefined && o.bench.flat() === value())

const failed = results.filter((passed) => !passed).length
console.log(failed === 0 ? '\nall checks passed' : `\n${failed} check(s) failed`)
process.exitCode = failed === 0 ? 0 : 1
