// npm run size: prints the size of each library file in ./dist/js, raw, gzip
// and Brotli, and fails when a minified file grows past its gzip budget.
// Run npm run build first.
import { readFile } from 'node:fs/promises'
import { gzipSync, brotliCompressSync } from 'node:zlib'

// Gzip budgets in bytes, with some headroom over today's sizes. Raise one
// deliberately, in the same commit as the growth it allows
const budgets = {
  // Raised from 9,500 for the hooks soucouyant/polychrony shares the shape
  // and routes locks through
  'soucouyant-core.min.js': 10000,
  'soucouyant-temporal.min.js': 11500,
  // A complete copy of core and temporal, for timelines, plus the glue
  'soucouyant-polychrony.min.js': 22000
}

const files = [
  'soucouyant-core.js',
  'soucouyant-core.min.js',
  'soucouyant-temporal.js',
  'soucouyant-temporal.min.js',
  'soucouyant-polychrony.js',
  'soucouyant-polychrony.min.js'
]

const kilobytes = (bytes) => `${(bytes / 1000).toFixed(1)} kB`

let overBudget = false
const rows = []
for (const file of files) {
  const code = await readFile(new URL(`../dist/js/${file}`, import.meta.url))
  const gzip = gzipSync(code).length
  const budget = budgets[file]
  const status = budget === undefined ? '' : gzip > budget ? `over budget (${kilobytes(budget)})` : `budget ${kilobytes(budget)}`
  if (budget !== undefined && gzip > budget) overBudget = true
  rows.push([file, kilobytes(code.length), kilobytes(gzip), kilobytes(brotliCompressSync(code).length), status])
}

const header = ['File', 'Size', 'gzip', 'Brotli', '']
const widths = header.map((title, column) => Math.max(title.length, ...rows.map((row) => row[column].length)))
const line = (row) => row.map((cell, column) => column === 0 ? cell.padEnd(widths[column]) : cell.padStart(widths[column])).join('  ').trimEnd()
console.log([line(header), ...rows.map(line)].join('\n'))

if (overBudget) {
  console.error('\nA minified file is over its gzip budget. Shrink it, or raise the budget in scripts/size.js on purpose.')
  process.exitCode = 1
}
