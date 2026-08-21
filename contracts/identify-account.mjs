/**
 * Works out which of the supplied values is the account address, which network
 * that account lives on, and which value signs for it - by asking the chain
 * rather than guessing from the shape of a hex string.
 *
 *   node contracts/identify-account.mjs 0xA 0xB 0xC
 *
 * or set CANDIDATES in .env as a comma-separated list and pass nothing, which
 * keeps the key out of your shell history.
 *
 * Read-only. It sends no transaction and writes nothing. Values are printed
 * truncated so the output is safe to paste into a chat.
 */
import { ec, num, RpcProvider } from 'starknet'
import { readFileSync } from 'node:fs'

try {
  for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
    const match = /^([A-Z_]+)=(.*)$/.exec(line.trim())
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2]
  }
} catch {
  // No .env is fine when the values come in on the command line.
}

const candidates =
  process.argv.length > 2
    ? process.argv.slice(2)
    : (process.env.CANDIDATES ?? '').split(',').map((s) => s.trim()).filter(Boolean)
if (candidates.length === 0) {
  throw new Error('pass the values as arguments, or set CANDIDATES in .env')
}

const mainnet = process.env.STARKNET_RPC_URL
const sepolia =
  process.env.STARKNET_SEPOLIA_RPC_URL ??
  (mainnet?.includes('g.alchemy.com')
    ? mainnet.replace('starknet-mainnet', 'starknet-sepolia')
    : 'https://starknet-sepolia.public.blastapi.io/rpc/v0_8')

const NETWORKS = [
  { name: 'mainnet', url: mainnet },
  { name: 'sepolia', url: sepolia },
].filter((n) => n.url)

// Same addresses on both networks.
const TOKENS = [
  { symbol: 'STRK', address: '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d' },
  { symbol: 'ETH', address: '0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7' },
]

const short = (v) => `${String(v).slice(0, 10)}…${String(v).slice(-4)}`
const findings = []

for (const network of NETWORKS) {
  const provider = new RpcProvider({ nodeUrl: network.url })
  console.log(`\n== ${network.name} ==`)

  for (const value of candidates) {
    let classHash = null
    try {
      classHash = await provider.getClassHashAt(value, 'latest')
    } catch {}

    const balances = []
    for (const token of TOKENS) {
      try {
        const result = await provider.callContract({
          contractAddress: token.address,
          entrypoint: 'balanceOf',
          calldata: [value],
        })
        const amount = BigInt(result[0]) + (BigInt(result[1]) << 128n)
        if (amount > 0n) balances.push(`${token.symbol} ${Number(amount) / 1e18}`)
      } catch {}
    }

    // A value that holds funds is an address even when no contract sits there
    // yet: a wallet address exists before its first transaction deploys it.
    const looksLikeAddress = Boolean(classHash) || balances.length > 0
    if (looksLikeAddress) {
      findings.push({ network: network.name, value, classHash, balances })
    }

    console.log(
      `  ${short(value)}  ${classHash ? `deployed, class ${short(classHash)}` : 'no contract'}` +
        (balances.length ? `  holds ${balances.join(', ')}` : ''),
    )
  }
}

console.log('\n== reading ==')

if (findings.length === 0) {
  console.log(
    'None of these is an address with a contract or a balance, on either network.\n' +
      'Either the account has never been funded, or these are not what we assumed.\n' +
      'Open the first value on voyager.online to see what the explorer thinks it is.',
  )
} else {
  for (const finding of findings) {
    if (!finding.classHash) {
      console.log(
        `${short(finding.value)} on ${finding.network} holds ${finding.balances.join(', ')} but has no contract.\n` +
          '  That is a counterfactual address: funded, but never deployed. Run the "deploy\n' +
          '  account" step in your wallet before anything can be sent from it.',
      )
      continue
    }

    console.log(`${short(finding.value)} is a deployed account on ${finding.network}.`)
    console.log(`  class ${finding.classHash}`)
    if (finding.balances.length === 0) {
      console.log('  holds nothing - it cannot pay for a declare')
    }

    const provider = new RpcProvider({
      nodeUrl: NETWORKS.find((n) => n.name === finding.network).url,
    })
    let onchain = null
    for (const fn of ['get_public_key', 'getPublicKey', 'get_signer', 'getSigner']) {
      try {
        const [result] = await provider.callContract({
          contractAddress: finding.value,
          entrypoint: fn,
          calldata: [],
        })
        onchain = BigInt(result)
        break
      } catch {}
    }
    if (onchain === null) {
      console.log('  no public-key getter, so the signing key cannot be paired from here')
      continue
    }

    for (const candidate of candidates) {
      if (candidate === finding.value) continue
      if (BigInt(candidate) === onchain) {
        console.log(`  ${short(candidate)} is the PUBLIC key`)
        continue
      }
      try {
        const derived = BigInt(ec.starkCurve.getStarkKey(candidate))
        if (derived === onchain) console.log(`  ${short(candidate)} is the PRIVATE key`)
      } catch {}
    }
  }
}
