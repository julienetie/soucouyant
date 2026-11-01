// npm run test:types: compiles the TypeScript tests in test/types against
// the built package, the way an app would see it, under every supported
// TypeScript version and module resolution mode. Run npm run build first.
//
// test/types/node_modules/soucouyant links back to this repository, so
// imports resolve through package.json "exports" (and "typesVersions" for
// the older node10 resolution) to dist/ts. skipLibCheck is off, so the
// declarations themselves are checked too.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, rm, symlink } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const tests = fileURLToPath(new URL('../test/types/', import.meta.url))
const link = fileURLToPath(new URL('../test/types/node_modules/soucouyant', import.meta.url))

if (!existsSync(`${root}dist/ts/soucouyant-core.d.ts`)) {
  console.error('dist/ts is missing: run npm run build first')
  process.exit(1)
}

await mkdir(fileURLToPath(new URL('../test/types/node_modules/', import.meta.url)), { recursive: true })
await rm(link, { recursive: true, force: true })
await symlink(root, link, 'junction')

const projects = {
  core: 'the core alone; history methods must be absent',
  untyped: 'paths with no registered shape',
  register: 'a registered shape, with every strict option',
  temporal: 'temporal, storage adapters and the Next.js server binding',
  polychrony: 'timelines, typed from a registered shape',
  bindings: 'React, Vue, Svelte and the Next.js client binding',
  angular: 'the Angular binding'
}

// Framework types set their own TypeScript minimums (Vue and Angular need
// 5.4 or later), so the oldest supported TypeScript checks only Soucouyant's
// own types
const ownProjects = ['core', 'untyped', 'register', 'temporal', 'polychrony']

// Angular's own package can't be resolved with node10 resolution
const unsupported = (project, resolution) => project === 'angular' && resolution === 'node10'

const compilers = [
  {
    name: 'TypeScript 7',
    tsc: 'node_modules/typescript/bin/tsc',
    projects: Object.keys(projects),
    modes: [['nodenext', 'nodenext'], ['esnext', 'bundler'], ['preserve', 'bundler']]
  },
  {
    name: 'TypeScript 5.9',
    tsc: 'node_modules/typescript59/bin/tsc',
    projects: Object.keys(projects),
    modes: [['nodenext', 'nodenext'], ['esnext', 'bundler'], ['commonjs', 'node10']]
  },
  {
    name: 'TypeScript 5.0',
    tsc: 'node_modules/typescript5/bin/tsc',
    projects: ownProjects,
    modes: [['nodenext', 'nodenext'], ['esnext', 'bundler'], ['commonjs', 'node10']]
  }
]

let failures = 0
for (const compiler of compilers) {
  for (const [module, resolution] of compiler.modes) {
    for (const project of compiler.projects) {
      if (unsupported(project, resolution)) continue
      const result = spawnSync(process.execPath, [
        `${root}${compiler.tsc}`,
        '-p', `${tests}tsconfig.${project}.json`,
        '--module', module,
        '--moduleResolution', resolution
      ], { encoding: 'utf8' })
      const passed = result.status === 0
      if (!passed) failures++
      console.log(`${passed ? 'ok  ' : 'FAIL'} ${compiler.name}, ${module}/${resolution}: ${project} (${projects[project]})`)
      if (!passed) console.log((result.stdout + result.stderr).trim().replace(/^/gm, '     '))
    }
  }
}

console.log(failures === 0 ? '\nall type tests passed' : `\n${failures} type test run(s) failed`)
process.exitCode = failures === 0 ? 0 : 1
