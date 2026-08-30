/**
 * Stage and publish @jalin/sdk.
 *
 * The package this repository develops against and the package other people
 * install are not the same shape. Here the entry is `src/index.ts`, because the
 * app and the tests read TypeScript directly. A consumer cannot: Node does not
 * strip types inside `node_modules`, so a published package pointing at `.ts`
 * is a package that throws on `import`.
 *
 * npm has no way to rewrite `main`/`exports` at publish time - `publishConfig`
 * only overrides npm's own config, and the field replacement people remember is
 * pnpm's. So the tarball is built from a staging directory instead: compiled
 * JavaScript, its declarations, and a package.json whose entry points at them.
 *
 * Nothing here touches how the app resolves the SDK, which is the point. The
 * production build is not worth risking to ship a tarball.
 *
 *   node scripts/publish-sdk.mjs            # build, stage, pack, verify
 *   node scripts/publish-sdk.mjs --publish  # the same, then npm publish
 */
import { execFileSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// ponytail: shell on Windows, where npm and npx are .cmd shims that Node 26
// refuses to spawn directly. Every argument here is a literal in this file;
// nothing reaches it from a caller. If that stops being true, quote them.
const run = (cmd, args, cwd) =>
  execFileSync(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' })

const root = fileURLToPath(new URL('..', import.meta.url))
const sdk = join(root, 'sdk')

run('npx', ['tsc', '-p', 'tsconfig.build.json'], sdk)

const manifest = JSON.parse(readFileSync(join(sdk, 'package.json'), 'utf8'))
const stage = mkdtempSync(join(tmpdir(), 'jalin-sdk-'))

cpSync(join(sdk, 'dist'), join(stage, 'dist'), { recursive: true })
for (const file of ['LICENSE', 'README.md']) cpSync(join(sdk, file), join(stage, file))

// The consumer's copy carries no scripts and no dev dependencies: `prepack`
// would try to build inside their install, and nothing here is theirs to run.
const keep = { ...manifest }
delete keep.scripts
delete keep.devDependencies
writeFileSync(
  join(stage, 'package.json'),
  JSON.stringify(
    {
      ...keep,
      main: './dist/index.js',
      types: './dist/index.d.ts',
      exports: { '.': { types: './dist/index.d.ts', default: './dist/index.js' } },
      files: ['dist'],
    },
    null,
    2,
  ) + '\n',
)

// A tarball nobody imported is a tarball nobody has tested. Import it here.
const entry = pathToFileURL(join(stage, 'dist', 'index.js')).href
const exported = Object.keys(await import(entry))
if (exported.length === 0) throw new Error('the staged package exports nothing')
console.log(`\nstaged ${stage}\n${exported.length} exports resolve from the built entry`)

run('npm', process.argv.includes('--publish') ? ['publish'] : ['pack', '--dry-run'], stage)

if (!process.argv.includes('--publish')) {
  console.log('\nDry run. To publish: npm login, then node scripts/publish-sdk.mjs --publish')
  console.log('A scoped name needs the scope to exist: npmjs.com/org/create, free for public packages.')
}
rmSync(stage, { recursive: true, force: true })
