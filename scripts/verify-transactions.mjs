/**
 * Check strk20.json the way the panel will.
 *
 *   node scripts/verify-transactions.mjs [path/to/strk20.json]
 *
 * The rules say each listed transaction must exist, have succeeded, have touched
 * the STRK20 pool, and - if you deployed contracts - have run through one of
 * yours. Every one of those is checkable against the chain, so there is no reason
 * to find out on 31 August whether a hash qualifies.
 *
 * Read-only. It sends nothing and needs no key.
 */
import { RpcProvider } from 'starknet'
import { checkReceipt, describeVerdict } from '../sdk/src/index.ts'
import { loadEnv, required } from './lib/env.mjs'
import { readFileSync } from 'node:fs'

loadEnv(import.meta.url)

const root = new URL('..', import.meta.url)


const RPC = required('STARKNET_RPC_URL', 'any Starknet mainnet node')

const POOL =
  process.env.POOL_ADDRESS ??
  '0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a'

// A path argument lets this be pointed at somebody else's manifest, which is
// also how its own positive and negative paths were checked.
const manifestPath = process.argv[2] ?? new URL('strk20.json', root)
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const ours = manifest.contracts ?? []
const provider = new RpcProvider({ nodeUrl: RPC })

const short = (v) => `${String(v).slice(0, 12)}…${String(v).slice(-6)}`

async function check(hash) {
  let receipt = null
  try {
    receipt = await provider.getTransactionReceipt(hash)
  } catch {
    // Absent is a verdict, not an error.
  }
  return { hash, ...checkReceipt(receipt, { pool: POOL, ours: manifest.contracts ?? [] }) }
}

const hashes = manifest.transactions ?? []

console.log(`pool      ${short(POOL)}`)
console.log(`contracts ${ours.length ? ours.map(short).join(', ') : 'none declared'}`)
console.log(`listed    ${hashes.length} transaction${hashes.length === 1 ? '' : 's'}\n`)

if (hashes.length === 0) {
  console.log('strk20.json lists no transactions yet. Three are needed to be scored.')
  process.exit(1)
}

const results = []
for (const hash of hashes) {
  const r = await check(hash)
  results.push(r)
  console.log(`${short(hash)}  ${describeVerdict(r)}`)
}

const good = results.filter((r) => r.qualifies).length

console.log(`\n${good} of ${results.length} qualify.`)

if (!manifest.demo_video) console.log('demo_video is empty, and it is needed to be scored.')
if (!manifest.demo_url) console.log('demo_url is empty; the hub can also detect it from the repository.')

process.exit(good >= 3 ? 0 : 1)
