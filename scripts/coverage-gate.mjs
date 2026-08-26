/**
 * Reads contracts/coverage/coverage.lcov and fails if any contract source line
 * is unexecuted.
 *
 *   sh contracts/coverage.sh && node scripts/coverage-gate.mjs
 *
 * The bar is 100% of `src/`, not of the repository. Test files are excluded
 * because a `should_panic` test has unreachable lines after the panic by
 * construction, and counting those would only teach everyone to ignore the
 * number.
 *
 * 100% of lines is not 100% of behaviour - it says every line ran, not that
 * every line ran under the conditions that would break it. It is a floor.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const root = fileURLToPath(new URL('..', import.meta.url))
const lcovPath = join(root, 'contracts', 'coverage', 'coverage.lcov')

let lcov
try {
  lcov = readFileSync(lcovPath, 'utf8')
} catch {
  console.error(`No coverage at ${lcovPath}. Run: sh contracts/coverage.sh`)
  process.exit(1)
}

const files = new Map()
let current = null

for (const line of lcov.split('\n')) {
  if (line.startsWith('SF:')) {
    current = line.slice(3).trim()
    files.set(current, { hit: 0, total: 0, missed: [] })
  } else if (line.startsWith('DA:')) {
    const [number, count] = line.slice(3).split(',')
    const file = files.get(current)
    file.total += 1
    if (Number(count) > 0) file.hit += 1
    else file.missed.push(number)
  }
}

let failed = false

for (const [path, stats] of files) {
  // Paths are as seen inside the container, so match on the suffix.
  if (!/(^|\/)src\//.test(path)) continue

  const name = path.replace(/^.*contracts\//, '')
  const percent = Math.round((100 * stats.hit) / stats.total)
  console.log(`${String(percent).padStart(3)}%  ${String(stats.hit).padStart(4)}/${String(stats.total).padEnd(5)} ${name}`)

  if (stats.missed.length > 0) {
    failed = true
    console.log(`      never executed: line ${stats.missed.join(', ')}`)
  }
}

if (files.size === 0) {
  console.error('The lcov file named no files. Did the coverage run compile anything?')
  process.exit(1)
}

if (failed) {
  console.error('\nEvery line of a contract has to run at least once in the suite.')
  process.exit(1)
}

console.log('\nEvery contract line runs in the suite.')
