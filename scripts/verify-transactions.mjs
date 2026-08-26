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
import { readFileSync } from 'node:fs'

const root = new URL('..', import.meta.url)

try {
  for (const line of readFileSync(new URL('.env', root), 'utf8').split('\n')) {
    const match = /^([A-Z_]+)=(.*)$/.exec(line.trim())
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2]
  }
} catch {
  // Falls back to whatever is already in the environment.
}

const RPC = process.env.STARKNET_RPC_URL
if (!RPC) throw new Error('set STARKNET_RPC_URL (in .env or the environment)')

const POOL =
  process.env.POOL_ADDRESS ??
  '0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a'

// A path argument lets this be pointed at somebody else's manifest, which is
// also how its own positive and negative paths were checked.
const manifestPath = process.argv[2] ?? new URL('strk20.json', root)
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const ours = (manifest.contracts ?? []).map((c) => BigInt(c))
const provider = new RpcProvider({ nodeUrl: RPC })

const same = (a, b) => BigInt(a) === BigInt(b)
const short = (v) => `${String(v).slice(0, 12)}…${String(v).slice(-6)}`

async function check(hash) {
  const result = { hash, exists: false, succeeded: false, touchedPool: false, throughOurs: null }
  let receipt
  try {
    receipt = await provider.getTransactionReceipt(hash)
  } catch {
    return result
  }
  result.exists = true
  result.succeeded = (receipt.execution_status ?? receipt.finality_status) === 'SUCCEEDED'

  const emitters = (receipt.events ?? []).map((e) => e.from_address)
  result.touchedPool = emitters.some((a) => same(a, POOL))
  // Only asserted when contracts are declared: the rule is conditional on having
  // deployed any, and a project with none is judged on the pool alone.
  result.throughOurs = ours.length === 0 ? null : emitters.some((a) => ours.some((o) => same(a, o)))
  return result
}

const hashes = manifest.transactions ?? []

console.log(`pool      ${short(POOL)}`)
console.log(`contracts ${ours.length ? ours.map((o) => short('0x' + o.toString(16))).join(', ') : 'none declared'}`)
console.log(`listed    ${hashes.length} transaction${hashes.length === 1 ? '' : 's'}\n`)

if (hashes.length === 0) {
  console.log('strk20.json lists no transactions yet. Three are needed to be scored.')
  process.exit(1)
}

const results = []
for (const hash of hashes) {
  const r = await check(hash)
  results.push(r)
  const mark = (ok) => (ok ? 'yes' : 'NO ')
  console.log(short(hash))
  console.log(`  exists ${mark(r.exists)}   succeeded ${mark(r.succeeded)}   touched pool ${mark(r.touchedPool)}` +
    (r.throughOurs === null ? '' : `   through ours ${mark(r.throughOurs)}`))
}

const qualifies = (r) =>
  r.exists && r.succeeded && r.touchedPool && (r.throughOurs === null || r.throughOurs)
const good = results.filter(qualifies).length

console.log(`\n${good} of ${results.length} qualify.`)

if (!manifest.demo_video) console.log('demo_video is empty, and it is needed to be scored.')
if (!manifest.demo_url) console.log('demo_url is empty; the hub can also detect it from the repository.')

process.exit(good >= 3 ? 0 : 1)
