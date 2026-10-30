// Puts ./dist in StandardJS style. `standard` skips anything in .gitignore,
// and ./dist is ignored, so this runs ESLint with the same config directly.
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { ESLint } from 'eslint'

const eslint = new ESLint({
  fix: true,
  ignore: false,
  useEslintrc: false,
  overrideConfig: { extends: ['standard'], parserOptions: { ecmaVersion: 2022, sourceType: 'module' } }
})

// The .min.js files are left exactly as Terser wrote them
const files = (await readdir('dist', { recursive: true }))
  .filter((path) => path.endsWith('.js') && !path.endsWith('.min.js'))
  .map((path) => join('dist', path))
const results = await eslint.lintFiles(files)
await ESLint.outputFixes(results)

if (results.some((result) => result.errorCount > 0)) {
  const formatter = await eslint.loadFormatter('stylish')
  console.error(formatter.format(results))
  process.exitCode = 1
}
