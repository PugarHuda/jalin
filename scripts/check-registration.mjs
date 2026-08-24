/**
 * Is this account registered in the STRK20 pool?
 *
 *   node scripts/check-registration.mjs 0xYOUR_ADDRESS
 *
 * Registration publishes a public viewing key and emits `ViewingKeySet`, whose
 * first key is the address and whose second is the key itself. That event is the
 * enrolment, so its presence is the answer.
 *
 * `get_public_key` on the pool looks like it should answer this and does not -
 * it returns zero for accounts that demonstrably transact through the pool, so
 * its argument means something other than "which user". Read-only either way.
 */
import { hash, num, RpcProvider } from 'starknet'
import { readFileSync } from 'node:fs'

try {
  for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
    const match = /^([A-Z_]+)=(.*)$/.exec(line.trim())
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2]
  }
} catch {}

const address = process.argv[2]
if (!address) throw new Error('usage: node scripts/check-registration.mjs 0xADDRESS')

const pool =
  process.env.POOL_ADDRESS ??
  '0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a'
const provider = new RpcProvider({ nodeUrl: process.env.STARKNET_RPC_URL })

// Canonical form, because an event key is compared as a felt and written as one.
const wanted = num.toHex(BigInt(address))
const selector = num.toHex(hash.starknetKeccak('ViewingKeySet'))

const head = await provider.getBlockNumber()
let cursor
let scanned = 0
let found = null

// The pool has been live for weeks, so walk back rather than scanning from zero.
const WINDOW = 100_000
const from = Math.max(0, head - WINDOW)

do {
  const page = await provider.getEvents({
    address: pool,
    keys: [[selector], [wanted]],
    from_block: { block_number: from },
    to_block: 'latest',
    chunk_size: 100,
    ...(cursor ? { continuation_token: cursor } : {}),
  })
  scanned += page.events.length
  if (page.events.length > 0) found = page.events[page.events.length - 1]
  cursor = page.continuation_token
} while (cursor && !found)

console.log(`address : ${wanted}`)
console.log(`blocks  : ${from} to ${head}`)

if (found) {
  console.log(`\nREGISTERED`)
  console.log(`  viewing key : ${found.keys[2] ?? '(not in keys)'}`)
  console.log(`  block       : ${found.block_number}`)
  console.log(`  tx          : ${found.transaction_hash}`)
} else {
  console.log(`\nNOT REGISTERED in the last ${WINDOW} blocks (${scanned} matching events).`)
  console.log('Register once at https://strk20.starknet.io/app, then run this again.')
}
