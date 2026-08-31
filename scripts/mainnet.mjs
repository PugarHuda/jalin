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
import { Account, RpcProvider, constants, hash, num, shortString } from 'starknet'
import { poseidonHashMany } from '@scure/starknet'
import { loadEnv, required } from './lib/env.mjs'
import { randomBytes } from 'node:crypto'
import { createPrivateTransfers } from '../vendor/starknet-privacy/sdk/dist/index.js'
import { PlanBuilder, toInvokeCall } from '../sdk/src/index.ts'

loadEnv(import.meta.url)

// ---------------------------------------------------------------------------


const env = (name, mandatory = true) => (mandatory ? required(name) : process.env[name])

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
  shadowAccountAnonymizerAddress: process.env.SHADOW_ACCOUNT_ANONYMIZER,
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
      'A hosted mainnet prover answers today:\n' +
      '  PROVING_SERVICE_URL=https://transaction-prover.alpha-mainnet.sw-dev.io\n\n' +
      'This message used to say no such endpoint was published, and six open\n' +
      "issues on the hub said the same. It was in another team's .env.example\n" +
      'the whole time.\n\n' +
      'Registering and shielding are proof-free at the protocol level, but the\n' +
      'SDK routes every execute() through the proving provider regardless, so\n' +
      'there is no partial path here.',
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
 * A private transfer: pool to pool, no public leg at either end.
 *
 * The one STRK20 operation this project had never exercised from its own code,
 * and the sprint names it in the 30% integration criterion. It was not built
 * because `requireProver` said no mainnet prover existed; that was wrong, so
 * this is what the correction is for rather than a note about it.
 *
 * The recipient is a pool address - a registered account's public viewing key
 * owner - not an ordinary Starknet address. Sending to an unregistered account
 * is the one mistake here that cannot be undone, so it is checked before the
 * proof is paid for rather than after.
 */
async function transfer(recipient, amountStrk) {
  requireProver('transfer')
  if (!recipient || !amountStrk) {
    console.error('usage: node scripts/mainnet.mjs transfer <recipient> <amount in STRK> [--execute]')
    process.exit(1)
  }

  const amount = BigInt(Math.round(Number(amountStrk) * 1e6)) * 10n ** 12n
  console.log(`transferring ${amountStrk} STRK (${amount} wei) to ${recipient}`)

  const { callAndProof } = await transfers
    .build()
    .with(STRK, (t) => t.transfer({ recipient, amount }))
    .execute({ provingBlockId: await provingBlockId() })
  return submit(callAndProof, 'transfer')
}

/**
 * A shadow account: a real Starknet account the anonymizer derives per
 * (identity, dapp, nonce), with no public link to the account that owns it.
 *
 * This is the one thing on the sprint's integration list this project could
 * only ever describe. The SDK route needs a deployed shadow_account_anonymizer
 * and no address for one was published where anyone was looking - not beside
 * the Ekubo and Vesu entries in the monorepo README, not in the docs mirror.
 * It is deployed, at 0x04f33230..., and starknet.js documents it under
 * "Address of a shadow account".
 *
 * Verified before use rather than trusted: get_privacy_contract() on that
 * anonymizer returns this project's pool, so it is bound to the same pool the
 * router already runs against.
 *
 * Read the address from the contract, never derive it. The SDK's local
 * derivation does not reproduce what this anonymizer deploys - the on-chain
 * get_shadow_account(commitment) view does.
 */
async function shadow(nonce = '0') {
  requireProver('shadow')
  const anonymizer = env('SHADOW_ACCOUNT_ANONYMIZER')
  const dapp = 'JALIN'

  const accounts = transfers.build().shadowAccounts(dapp)
  const partial = await accounts.partialCommitment()
  const commitment = await accounts.commitment(nonce)
  console.log(`dapp ${dapp} · nonce ${nonce}`)
  console.log(`partial commitment ${num.toHex(partial)}`)
  console.log(`commitment         ${num.toHex(commitment)}`)

  const [derived] = await provider.callContract({
    contractAddress: anonymizer,
    entrypoint: 'get_shadow_account',
    calldata: [num.toHex(commitment)],
  })
  console.log(`shadow account     ${derived}`)

  // An approve of zero: the smallest call that proves the account can act.
  const { callAndProof } = await transfers
    .build({ autoSetup: true })
    .surplusTo(account.address)
    .shadowAccounts(dapp)
    .invoke(nonce, {
      calls: [{ contractAddress: STRK, entrypoint: 'approve', calldata: [derived, '0x0', '0x0'] }],
    })
    .execute({ provingBlockId: await provingBlockId() })

  return submit(callAndProof, 'shadow')
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

/**
 * A private ballot. The pool withdraws the stake to the governor and calls its
 * `privacy_invoke`, so the weight is public and the voter is not.
 *
 * CAST returns an empty span, so no open note is declared: the stake stays
 * escrowed in the governor until the vote closes and is redeemed by revealing
 * the secret. The secret is printed once and stored nowhere.
 */
async function ballot(proposalId = '1') {
  requireProver('ballot')
  const governor = env('GOVERNOR_ADDRESS')
  const amount = BigInt(process.env.BALLOT_AMOUNT ?? '100000000000000000') // 0.1 STRK

  const secret = num.toHex(
    BigInt('0x' + Buffer.from(randomBytes(31)).toString('hex')) % 2n ** 250n,
  )
  const commitment = hash.computePoseidonHashOnElements([
    shortString.encodeShortString('JALIN_BALLOT:V1'),
    secret,
  ])

  console.log(`proposal   ${proposalId}`)
  console.log(`stake      ${Number(amount) / 1e18} STRK`)
  console.log(`secret     ${secret}`)
  console.log('           ^ the only thing that redeems the stake. Save it now.')

  const { callAndProof } = await transfers
    .build({ autoSetup: true })
    .surplusTo(account.address)
    .with(STRK, (t) => t.withdraw({ amount, recipient: governor }))
    .invoke(({ poolAddress }) => ({
      contractAddress: governor,
      // privacy_invoke(pool_address, operation, proposal_id, support,
      //                commitment, secret, amount, note_id)
      calldata: [poolAddress, 0n, BigInt(proposalId), 1n, commitment, 0n, amount, 0n],
    }))
    .execute({ provingBlockId: await provingBlockId() })

  return submit(callAndProof, 'ballot')
}

// ---------------------------------------------------------------------------

const phases = { register, shield, transfer, plan, shadow, ballot }
if (!phases[phase]) {
  console.error(`usage: node scripts/mainnet.mjs <${Object.keys(phases).join('|')}> [--execute]`)
  process.exit(1)
}

if (!EXECUTE) console.log('DRY RUN - nothing will be submitted\n')

/**
 * The SDK's own errors, printed rather than thrown.
 *
 * A stack trace out of `compiler.js` is the library's failure, and every one of
 * them here is really a statement about this account: no notes, not registered,
 * not enough for the fee. Those are answers, and a script whose whole argument
 * is that a failure should name its blocker cannot end in a stack.
 */
try {
  await phases[phase](...rest)
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  console.error('')
  console.error(`${phase} stopped: ${message}`)
  console.error('')

  if (/Insufficient balance/i.test(message)) {
    console.error("That is this account's shielded balance, not its public one.")
    console.error('Shield first:  node scripts/mainnet.mjs shield <amount> --execute')
    console.error('The pool also charges a flat fee per private operation on top of')
    console.error('whatever the action moves, so shield more than you mean to send.')
  } else if (/NOT_REGISTERED/i.test(message)) {
    console.error('This account has published no viewing key yet:')
    console.error('  node scripts/mainnet.mjs register --execute')
  }
  process.exit(1)
}
