// Runs every benchmark group in its own process, so one group's
// configuration and JIT feedback never affect another
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const group = (file) => fileURLToPath(new URL(`./groups/${file}`, import.meta.url))
const runs = [
  ['get.js'],
  ['publish.js'],
  ['publish.js', 'history'],
  ['notify.js', '1'],
  ['notify.js', '10'],
  ['notify.js', '100'],
  ['batched.js'],
  ['finite.js'],
  ['objects.js', 'default'],
  ['objects.js', 'development'],
  ['objects.js', 'clone'],
  ['time-travel.js', '1000000'],
  ['declare.js']
]

const only = process.argv[2]
for (const [file, ...args] of runs) {
  if (only !== undefined && !file.startsWith(only)) continue
  console.log(`\n=== ${file} ${args.join(' ')}`)
  spawnSync(process.execPath, ['--expose-gc', '--no-warnings', group(file), ...args], { stdio: 'inherit' })
}
