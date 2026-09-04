/**
 * Prove the contracts on mainnet are the contracts in this repository.
 *
 *   node scripts/verify-classes.mjs
 *
 * Rebuilds nothing and sends nothing. It hashes the Sierra artifacts on disk and
 * compares each against the class actually deployed at the address in
 * strk20.json. A match means the source you are reading is the code that runs.
 *
 * One trap it checks for: `snforge test` writes over the release artifact with a
 * test-configured build of the same contract. Hash that and you get an answer
 * that never matches what was declared, with nothing to suggest why. Run
 * `scarb build` after testing, or read the warning below.
 */
import { hash, num, RpcProvider } from 'starknet'
import { loadEnv, required } from './lib/env.mjs'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

/**
 * Addresses whose deployed class is deliberately behind this source.
 *
 * Not an excuse list. An entry says: we changed the contract, we know the chain
 * has not caught up, and here is where the reason is written. Without this the
 * only two answers available are "matches" and "matches nothing built here", and
 * the second one reads like a mystery when it is a decision.
 *
 * Self-cleaning: if a superseded address turns out to match the current source,
 * this script fails and tells you to delete the entry, so a stale exemption
 * cannot outlive the deploy that resolved it.
 */
const SUPERSEDED = new Map([
  [
    '0x05bd985e794aee4c12d529ab50a68e5a40c7e28a36642b2b8e2ccdb373346984',
    'governor: tallied ballot weight it never measured. Fixed and tested 4 September, not redeployed — the deployer holds 2.178 STRK against a bound near 66. See docs/threat-model.md.',
  ],
])

loadEnv(import.meta.url)

const root = fileURLToPath(new URL('..', import.meta.url))


const RPC = required('STARKNET_RPC_URL', 'any Starknet mainnet node')

const targetDir = join(root, 'contracts', 'target', 'dev')
if (!existsSync(targetDir)) {
  console.error('No build found. Run: scarb build --manifest-path contracts/Scarb.toml')
  process.exit(1)
}

// snforge leaves its own artifacts beside the release ones and overwrites the
// release build of each contract while it is at it.
const contaminated = readdirSync(targetDir).some((f) => /\.test\.contract_class\.json$/.test(f))
if (contaminated) {
  console.log('note: this target/ has test artifacts in it, so the release build may be')
  console.log('      the one snforge wrote. If a class differs, run scarb build and retry.\n')
}

/**
 * The artifacts have to be newer than the source, or this proves nothing.
 *
 * Hashing a stale build and comparing it to the chain answers a question nobody
 * asked: whether the chain matches a build from some earlier day. On 4 September
 * this script reported "JalinGovernor — matches this source" against an artifact
 * from 26 August, hours after the governor was changed. A check that can say
 * "matches" when it does not is worse than no check, because the whole point of
 * this one is that the code you are reading is the code that runs.
 */
const newest = (dir, test) =>
  readdirSync(dir)
    .filter(test)
    .reduce((latest, file) => Math.max(latest, statSync(join(dir, file)).mtimeMs), 0)

/**
 * The release artifacts only. `snforge` writes `*.test.contract_class.json`
 * beside them on every run, and timing the whole directory therefore times the
 * test build — which is fresh today while the release build is nine days old.
 * That is the shape of the bug this guard exists to catch, so it must not be
 * the shape of the guard.
 */
const RELEASE_ARTIFACT = /^jalin_[A-Za-z][A-Za-z0-9]*\.contract_class\.json$/

const sourceDir = join(root, 'contracts', 'src')
const sourceAt = newest(sourceDir, (f) => f.endsWith('.cairo'))
const builtAt = newest(targetDir, (f) => RELEASE_ARTIFACT.test(f))

if (sourceAt > builtAt) {
  const when = (ms) => new Date(ms).toISOString().replace('T', ' ').slice(0, 16)
  console.error('The build is older than the source, so this would compare the chain against')
  console.error('a contract nobody is reading.\n')
  console.error(`  contracts/src   changed ${when(sourceAt)}`)
  console.error(`  contracts/target built  ${when(builtAt)}\n`)
  console.error('Run: scarb build --manifest-path contracts/Scarb.toml')
  process.exit(1)
}

const manifest = JSON.parse(readFileSync(join(root, 'strk20.json'), 'utf8'))
const addresses = manifest.contracts ?? []
if (addresses.length === 0) {
  console.error('strk20.json lists no contracts.')
  process.exit(1)
}

const provider = new RpcProvider({ nodeUrl: RPC })
const short = (v) => `${String(v).slice(0, 14)}…${String(v).slice(-6)}`

// Which artifact belongs to which address is decided by asking the chain, not by
// assuming the order in strk20.json.
const built = readdirSync(targetDir)
  .filter((f) => /^jalin_[A-Za-z][A-Za-z0-9]*\.contract_class\.json$/.test(f))
  .map((file) => {
    const name = file.replace(/^jalin_|\.contract_class\.json$/g, '')
    const sierra = JSON.parse(readFileSync(join(targetDir, file), 'utf8'))
    return { name, classHash: BigInt(hash.computeContractClassHash(sierra)) }
  })

console.log(`built locally: ${built.map((b) => b.name).join(', ')}\n`)

// Superseded entries are keyed by value, so padding cannot hide one.
const supersededBy = (address) => {
  for (const [listed, reason] of SUPERSEDED) {
    if (BigInt(listed) === BigInt(address)) return reason
  }
  return null
}

let matched = 0
let superseded = 0
const stale = []

for (const address of addresses) {
  let onchain
  try {
    onchain = BigInt(await provider.getClassHashAt(address, 'latest'))
  } catch {
    console.log(`${short(address)}  no contract deployed here`)
    continue
  }
  const found = built.find((b) => b.classHash === onchain)
  const reason = supersededBy(address)

  if (found && reason) {
    stale.push(address)
    console.log(`${short(address)}  ${found.name} — matches this source, but is listed as superseded`)
  } else if (found) {
    matched += 1
    console.log(`${short(address)}  ${found.name} — matches this source`)
  } else if (reason) {
    superseded += 1
    console.log(`${short(address)}  superseded — ${reason}`)
  } else {
    console.log(`${short(address)}  class ${short(num.toHex(onchain))} matches nothing built here`)
  }
}

if (stale.length > 0) {
  console.error('\nThese addresses run the current source, so their SUPERSEDED entry is a lie:')
  for (const address of stale) console.error(`  ${address}`)
  console.error('Delete them from scripts/verify-classes.mjs.')
  process.exit(1)
}

const accounted = matched + superseded
console.log(
  `\n${matched} of ${addresses.length} deployed contracts are this source` +
    (superseded > 0 ? `, and ${superseded} deliberately ${superseded === 1 ? 'is' : 'are'} not.` : '.'),
)
process.exit(accounted === addresses.length ? 0 : 1)
