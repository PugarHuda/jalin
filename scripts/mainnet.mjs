/**
 * The mainnet run, in phases, because they unblock at different times.
 *
 *   node scripts/mainnet.mjs register
 *   node scripts/mainnet.mjs shield 1.5
 *   node scripts/mainnet.mjs plan
 *   node scripts/mainnet.mjs ballot <id>
 *
 * Add --execute to any of them to actually send. Without it everything is built
 * and printed but nothing is submitted.
 *
 * All four need PROVING_SERVICE_URL today.
 *
 * The Day 0 doc says registering and shielding need no proof, being ordinary
 * public transactions, and at the protocol level that is true. It is not true of
 * this SDK: every `execute()` path reaches for the proving provider, register
 * included. The phases were split hoping the first two could run ahead of the
 * others; they cannot, and pretending otherwise would only move the failure
 * later. See `requireProver` below and starkience/strk20-hackathon#121.
 */
import { Account, RpcProvider, constants } from 'starknet'
import { poseidonHashMany } from '@scure/starknet'
import { readFileSync } from 'node:fs'
import { createPrivateTransfers } from '../vendor/starknet-privacy/sdk/dist/index.js'
import { PlanBuilder, toInvokeCall } from '../sdk/src/index.ts'

// ---------------------------------------------------------------------------

for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
  const match = /^([A-Z_]+)=(.*)$/.exec(line.trim())
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2]
}

const env = (name, required = true) => {
  const value = process.env[name]
  if (required && !value) throw new Error(`set ${name} in .env`)
  return value
}

const [phase, ...rest] = process.argv.slice(2).filter((a) => a !== '--execute')
const EXECUTE = process.argv.includes('--execute')

const RPC = env('STARKNET_RPC_URL')
const POOL = env('POOL_ADDRESS')
const STRK = env('BALLOT_TOKEN')
const ADDRESS = env('ACCOUNT_ADDRESS')
const KEY = env('ACCOUNT_PRIVATE_KEY')

const provider = new RpcProvider({ nodeUrl: RPC })
const account = new Account({ provider, address: ADDRESS, signer: KEY, cairoVersion: '1' })

/**
 * Derived rather than stored. The viewing key is bound at registration and can
 * never be rotated, so it has to be reproducible from something you already
 * keep - and one more secret in .env is one more secret to leak.
 */
const VIEWING_KEY_TAG = BigInt('0x4a414c494e5f56494557494e475f4b45593a5631') // 'JALIN_VIEWING_KEY:V1'
const viewingKey = poseidonHashMany([VIEWING_KEY_TAG, BigInt(KEY)])

const transfers = createPrivateTransfers({
  account,
  viewingKeyProvider: { getViewingKey: async () => viewingKey },
  provingProvider: process.env.PROVING_SERVICE_URL
    ? { url: process.env.PROVING_SERVICE_URL, chainId: constants.StarknetChainId.SN_MAIN }
    : undefined,
  discoveryProvider: process.env.INDEXER_URL ? { url: process.env.INDEXER_URL } : undefined,
  poolContractAddress: POOL,
})

async function submit(callAndProof, label) {
  if (!EXECUTE) {
    console.log(`\n[dry run] ${label} built. Pass --execute to send it.`)
    console.log(JSON.stringify(callAndProof.call, (_, v) => (typeof v === 'bigint' ? `0x${v.toString(16)}` : v), 2).slice(0, 600))
    return null
  }
  const proof = callAndProof.proof?.proofFacts?.length
    ? { proofFacts: callAndProof.proof.proofFacts, proof: callAndProof.proof.data }
    : {}
  const tx = await account.execute(callAndProof.call, { tip: 0n, ...proof })
  console.log(`${label}: ${tx.transaction_hash}`)
  await provider.waitForTransaction(tx.transaction_hash)
  console.log(`${label}: accepted`)
  return tx.transaction_hash
}

const provingBlockId = async () => (await provider.getBlockNumber()) - 10

/**
 * The Day 0 doc says registering and shielding "need no proof at all - both are
 * ordinary public transactions". That is true of the protocol and not true of
 * this SDK: `execute()` reaches for `provingProvider.getDefaultDetails()` on
 * every path, register included, and throws a bare TypeError when there isn't
 * one. Checked here so the failure names the actual blocker.
 */
function requireProver(phaseName) {
  if (process.env.PROVING_SERVICE_URL) return
  console.error(
    `\n${phaseName} needs PROVING_SERVICE_URL.\n\n` +
      'The mainnet proving service URL is not published yet - see\n' +
      'starkience/strk20-hackathon#121, #124, #135, #147, all open.\n\n' +
      'Registering and shielding are proof-free at the protocol level, but the\n' +
      'SDK routes every execute() through the proving provider regardless, so\n' +
      'there is no partial path here. The alternatives are a wallet that\n' +
      'implements the STRK20 methods (ours answers "Not implemented"), or the\n' +
      'URL landing on one of those issues.',
  )
  process.exit(1)
}

// ---------------------------------------------------------------------------

async function register() {
  requireProver('register')
  const { callAndProof } = await transfers.build().register().execute({
    provingBlockId: await provingBlockId(),
  })
  return submit(callAndProof, 'register')
}

async function shield(amountStrk) {
  requireProver('shield')
  const amount = BigInt(Math.round(Number(amountStrk) * 1e6)) * 10n ** 12n
  console.log(`shielding ${amountStrk} STRK (${amount} wei)`)
  const { callAndProof } = await transfers
    .build({ autoSetup: true })
    .surplusTo(account.address)
    .with(STRK, (t) => t.deposit({ amount }))
    .execute({ provingBlockId: await provingBlockId() })
  return submit(callAndProof, 'shield')
}

/**
 * A two-step plan through the router. Two steps rather than one on purpose: a
 * single private swap is something AVNU already does with its own anonymizer,
 * and one invoke per transaction means Jalin and that anonymizer compete for the
 * same slot. Composition is the thing that cannot be done any other way.
 */
async function plan() {
  requireProver('plan')
  const router = env('ROUTER_ADDRESS')
  const jalinPlan = PlanBuilder.create()
    .call({
      target: STRK,
      selector: '0x0219209e083275171774dab1df80982e9df2096516f06319c5c6d71ae0a8480c', // approve
      approvals: [],
      calldata: [router, 0n, 0n],
    })
    .creditTo(STRK, 0n, 0n) // note id is substituted below
    .build()

  const { callAndProof } = await transfers
    .build({ autoSetup: true })
    .surplusTo(account.address)
    .with(STRK, (t) => t.transfer({ recipient: account.address, amount: 'OPEN' }))
    .invoke(({ openNotes, poolAddress }) =>
      toInvokeCall(jalinPlan, { router, openNotes, poolAddress }),
    )
    .execute({ provingBlockId: await provingBlockId() })

  return submit(callAndProof, 'plan')
}

async function ballot(proposalId) {
  const governor = env('GOVERNOR_ADDRESS')
  console.log(`casting a private ballot on proposal ${proposalId} via ${governor}`)
  throw new Error(
    'ballot is wired once the governor is deployed and a proposal exists; see docs/deploying.md',
  )
}

// ---------------------------------------------------------------------------

const phases = { register, shield, plan, ballot }
if (!phases[phase]) {
  console.error(`usage: node scripts/mainnet.mjs <${Object.keys(phases).join('|')}> [--execute]`)
  process.exit(1)
}

if (!EXECUTE) console.log('DRY RUN - nothing will be submitted\n')
await phases[phase](...rest)
