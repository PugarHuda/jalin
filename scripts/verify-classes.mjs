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
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const root = fileURLToPath(new URL('..', import.meta.url))

try {
  for (const line of readFileSync(join(root, '.env'), 'utf8').split('\n')) {
    const match = /^([A-Z_]+)=(.*)$/.exec(line.trim())
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2]
  }
} catch {}

const RPC = process.env.STARKNET_RPC_URL
if (!RPC) throw new Error('set STARKNET_RPC_URL (in .env or the environment)')

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

let matched = 0
for (const address of addresses) {
  let onchain
  try {
    onchain = BigInt(await provider.getClassHashAt(address, 'latest'))
  } catch {
    console.log(`${short(address)}  no contract deployed here`)
    continue
  }
  const found = built.find((b) => b.classHash === onchain)
  if (found) {
    matched += 1
    console.log(`${short(address)}  ${found.name} — matches this source`)
  } else {
    console.log(`${short(address)}  class ${short(num.toHex(onchain))} matches nothing built here`)
  }
}

console.log(`\n${matched} of ${addresses.length} deployed contracts are this source.`)
process.exit(matched === addresses.length ? 0 : 1)
