import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const directory = mkdtempSync(join(tmpdir(), 'soucouyant-'))
const database = join(directory, 'state.db')
const session = fileURLToPath(new URL('./fixtures/sqlite-session.js', import.meta.url))

// Each session is its own process, as separate app runs would be
const run = (step) => {
  const result = spawnSync(process.execPath, ['--no-warnings', session, database, step], { encoding: 'utf8' })
  if (result.status !== 0) throw new Error(result.stderr || `session ${step} failed`)
  return JSON.parse(result.stdout.trim().split('\n').at(-1))
}

test('frames survive across processes and numbering continues', () => {
  try {
    const first = run('first')
    assert.deepEqual(first.values, [1, 2, 3])
    const second = run('second')
    assert.equal(second.restoredCount > 0, true)
    assert.equal(second.counter, 3)
    assert.equal(second.label, 'pending')
    assert.equal(second.firstIndexAfterRestore > first.lastIndex || second.restoredIndices.includes(first.lastIndex), true)
    assert.equal(second.newIndex > first.lastIndex, true)
    const third = run('third')
    assert.equal(third.counter, 10)
    assert.equal(third.rangeLoaded > 0, true)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
