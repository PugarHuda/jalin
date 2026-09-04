/**
 * Every test count this repository quotes, checked against the suites.
 *
 *   node scripts/check-counts.mjs
 *
 * The counts have gone stale five times. Four of those were the test numbers —
 * app/PRODUCT.md carries a note saying so, and that note was itself stale when
 * it said "three times". The fifth was the transaction count, which stayed at
 * "three" in six places for four days after the fourth one landed, including a
 * sentence claiming every listed transaction ran through the router when the
 * fourth had gone through the governor.
 *
 * Fixing the same class of error a sixth time by hand is how it happens a
 * seventh. This counts the suites and fails if any prose disagrees.
 *
 * Read-only, no network, no chain. Playwright is asked to list its tests, which
 * does not start the web server or a browser.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, relative } from 'node:path'

const root = fileURLToPath(new URL('..', import.meta.url))

const SKIP = new Set(['node_modules', '.next', 'target', 'vendor', 'test-results', 'coverage'])
const READ = /\.(md|tsx)$/

function walk(dir) {
  const found = []
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry) || entry.startsWith('.')) continue
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) found.push(...walk(path))
    else if (READ.test(entry)) found.push(path)
  }
  return found
}

function count(pattern, dir, extension) {
  let total = 0
  for (const entry of readdirSync(join(root, dir))) {
    if (!entry.endsWith(extension)) continue
    const text = readFileSync(join(root, dir, entry), 'utf8')
    total += text.split(NEWLINE).filter((line) => pattern.test(line)).length
  }
  return total
}

const NEWLINE = String.fromCharCode(10)

const sdk = count(/^\s*(test|it)\(/, 'sdk/test', '.ts')
const cairo = count(/#\[test\]/, 'contracts/tests', '.cairo')

/**
 * `--list` is the only honest source for this one. Counting `test(` in the spec
 * files gives the wrong answer because six projects run overlapping subsets:
 * `responsive.spec.ts` runs on four of them and `ready.spec.ts` on one, so the
 * file count and the suite size are different numbers.
 */
let browser
try {
  const out = execFileSync('npx', ['playwright', 'test', '--list'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    shell: process.platform === 'win32',
  })
  browser = Number(out.match(/Total:\s*(\d+)\s+tests?/)?.[1])
} catch {
  browser = NaN
}

if (!Number.isFinite(browser)) {
  console.error('Could not ask Playwright how many tests it has, so nothing was checked.')
  console.error('  npx playwright test --list')
  process.exit(1)
}

const total = sdk + cairo + browser

/**
 * Each claim is a phrasing that appears in the prose, paired with the number it
 * has to equal. A pattern that matches nothing is also a failure: it means the
 * sentence was rewritten and this checker quietly stopped covering it, which is
 * the exact silence the whole file exists to break.
 */
const CLAIMS = [
  { label: 'SDK tests', expected: sdk, pattern: /(\d+) SDK tests/g },
  { label: 'SDK tests, table row', expected: sdk, pattern: /\| SDK, (\d+) \|/g },
  { label: 'Playwright tests', expected: browser, pattern: /(\d+) Playwright tests/g },
  { label: 'browser tests', expected: browser, pattern: /(\d+) browser tests/g },
  { label: 'browser tests, table row', expected: browser, pattern: /\| Browser, (\d+) \|/g },
  { label: 'Cairo tests', expected: cairo, pattern: /(\d+) Cairo tests/g },
  { label: 'Cairo tests, table row', expected: cairo, pattern: /\| Cairo, (\d+) \|/g },
  { label: 'Cairo tests, after test.sh', expected: cairo, pattern: /test\.sh\s+#\s*(\d+) tests/g },
  { label: 'Cairo tests, fuzz sentence', expected: cairo, pattern: /(\d+) tests, two of them fuzzed/g },
  { label: 'every test, on the deck', expected: total, pattern: /value="(\d+)" of="tests across/g },
]

const problems = []
const matched = new Map(CLAIMS.map((claim) => [claim.label, 0]))

for (const file of walk(root)) {
  const text = readFileSync(file, 'utf8')
  for (const claim of CLAIMS) {
    for (const [whole, found] of text.matchAll(claim.pattern)) {
      matched.set(claim.label, matched.get(claim.label) + 1)
      if (Number(found) !== claim.expected) {
        problems.push({
          file: relative(root, file),
          said: whole.trim(),
          expected: `${claim.label} is ${claim.expected}`,
        })
      }
    }
  }
}

for (const claim of CLAIMS) {
  if (matched.get(claim.label) === 0) {
    problems.push({
      file: 'scripts/check-counts.mjs',
      said: `nothing matches ${claim.pattern}`,
      expected: `the "${claim.label}" claim was reworded or removed — fix this checker`,
    })
  }
}

if (problems.length === 0) {
  console.log(
    `Counts agree: ${sdk} SDK, ${cairo} Cairo, ${browser} browser, ${total} in total.`,
  )
  process.exit(0)
}

console.error(`${problems.length} count${problems.length === 1 ? '' : 's'} disagree with the suites:\n`)
for (const { file, said, expected } of problems) {
  console.error(`  ${file}\n    said: ${said}\n    but:  ${expected}`)
}
process.exit(1)
