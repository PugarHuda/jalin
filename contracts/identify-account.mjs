/**
 * Works out which of the supplied values is the account address and which is its
 * signing key, by asking the chain rather than by guessing from the shape of a
 * hex string.
 *
 *   node contracts/identify-account.mjs 0xA 0xB 0xC
 *
 * or set CANDIDATES in .env as a comma-separated list and pass nothing, which
 * keeps the key out of your shell history.
 *
 * Nothing is written anywhere and no transaction is sent. It only reads.
 */
import { RpcProvider, ec, num } from 'starknet'
import { readFileSync } from 'node:fs'

try {
  for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
    const match = /^([A-Z_]+)=(.*)$/.exec(line.trim())
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2]
  }
} catch {
  // No .env is fine when the values come in on the command line.
}

const provider = new RpcProvider({ nodeUrl: process.env.STARKNET_RPC_URL })
const candidates =
  process.argv.length > 2
    ? process.argv.slice(2)
    : (process.env.CANDIDATES ?? '').split(',').map((s) => s.trim()).filter(Boolean)
if (candidates.length === 0) {
  throw new Error('pass the values as arguments, or set CANDIDATES in .env')
}

const short = (v) => `${v.slice(0, 10)}…${v.slice(-4)}`
const deployed = []

for (const value of candidates) {
  try {
    const classHash = await provider.getClassHashAt(value, 'latest')
    deployed.push({ address: value, classHash })
    console.log(`${short(value)}  deployed contract, class ${short(classHash)}`)
  } catch {
    console.log(`${short(value)}  not a deployed contract - candidate key`)
  }
}

for (const { address } of deployed) {
  let onchain = null
  for (const fn of ['get_public_key', 'getPublicKey', 'get_signer', 'getSigner']) {
    try {
      const [result] = await provider.callContract({
        contractAddress: address,
        entrypoint: fn,
        calldata: [],
      })
      onchain = BigInt(result)
      console.log(`\n${short(address)}  ${fn}() = ${short(num.toHex(onchain))}`)
      break
    } catch {}
  }
  if (onchain === null) {
    console.log(`\n${short(address)}  exposes no public-key getter; cannot pair it here`)
    continue
  }

  for (const candidate of candidates) {
    if (candidate === address) continue
    try {
      const derived = BigInt(ec.starkCurve.getStarkKey(candidate))
      const paired = derived === onchain
      console.log(
        `  ${short(candidate)} derives ${short(num.toHex(derived))}  ${paired ? '<< signs for this account' : 'no'}`,
      )
    } catch {
      console.log(`  ${short(candidate)} is not a valid private key`)
    }
  }
}
