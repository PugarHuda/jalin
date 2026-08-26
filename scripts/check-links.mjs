/**
 * Every path this repository points at, checked.
 *
 *   node scripts/check-links.mjs
 *
 * Markdown links to local files, and any repository path mentioned in a source
 * comment. A comment pointing at a document nobody ever wrote is worse than no
 * comment: it sends the reader looking for an explanation that does not exist.
 * Two such pointers were live when this was written.
 *
 * Read-only, no network. External URLs are not fetched — this is about the
 * repository being consistent with itself.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, relative, resolve, dirname, sep } from 'node:path'

const root = fileURLToPath(new URL('..', import.meta.url))

/**
 * Dot directories hold vendored upstream documentation - agent skill packs whose
 * links point at somebody else's website, not at files here. Checking those
 * produced 159 findings and 2 of them were ours, which is the ratio at which a
 * checker stops being read.
 */
const SKIP = new Set(['node_modules', '.next', 'target', 'vendor', 'test-results', 'coverage'])
const READ = /\.(md|ts|tsx|mjs|cairo|toml|yml|sh)$/

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

/** A markdown link to something local, skipping URLs and bare anchors. */
const MARKDOWN_LINK = /\[[^\]]*\]\(([^)\s]+)\)/g

/**
 * A repository path named in prose or a comment.
 *
 * The lookbehind stops it matching the tail of a longer one: a vendored import
 * ending in `dist/index.js` is not a claim about a file at the repository root.
 */
const REPO_PATH = /(?<![\w./-])((?:docs|sdk|contracts|scripts|app|prover|e2e)\/[\w./-]+\.\w{2,5})\b/g

/**
 * Git decides what is generated.
 *
 * `contracts/coverage/coverage.lcov` is named by the coverage gate and exists
 * only after a coverage run - present on a machine that has done one, absent in
 * CI, and a broken reference in neither case. Anything gitignored is a build
 * product, and naming one is not a claim that it is checked in.
 */
const NEWLINE = String.fromCharCode(10)

function isGenerated(paths) {
  if (paths.length === 0) return new Set()
  try {
    const out = execFileSync('git', ['check-ignore', '--stdin'], {
      cwd: root,
      input: paths.join(NEWLINE),
      encoding: 'utf8',
    })
    return new Set(out.split(NEWLINE).filter(Boolean).map((line) => resolve(root, line.trim())))
  } catch (error) {
    // git exits 1 when nothing matched, which is an answer rather than a fault.
    const out = typeof error.stdout === 'string' ? error.stdout : ''
    return new Set(out.split(NEWLINE).filter(Boolean).map((line) => resolve(root, line.trim())))
  }
}

const problems = []

for (const file of walk(root)) {
  const text = readFileSync(file, 'utf8')
  const here = dirname(file)
  const seen = new Set()

  const add = (target, raw) => {
    if (seen.has(raw)) return
    seen.add(raw)
    try {
      statSync(target)
    } catch {
      problems.push({ file: relative(root, file), raw, target })
    }
  }

  // Markdown links only in markdown. Elsewhere `](` is destructuring next to a
  // call, and every one of those matches is noise.
  if (file.endsWith('.md')) {
    for (const [, link] of text.matchAll(MARKDOWN_LINK)) {
      if (/^(https?:|mailto:|#)/.test(link)) continue
      add(resolve(here, link.split('#')[0]), link)
    }
  }

  for (const [, path] of text.matchAll(REPO_PATH)) {
    // Resolved from the repository root, which is how these are always written.
    add(resolve(root, path), path)
  }
}

// Forward slashes: git does not recognise a Windows-separated path, and every
// entry silently came back unmatched.
const generated = isGenerated(problems.map((p) => relative(root, p.target).split(sep).join('/')))
const missing = problems.filter((p) => !generated.has(p.target))

if (missing.length === 0) {
  console.log('Every local path this repository names exists.')
  process.exit(0)
}

console.error(`${problems.length} path${problems.length === 1 ? '' : 's'} named but not present:\n`)
for (const { file, raw } of problems) console.error(`  ${file}\n    -> ${raw}`)
process.exit(1)
