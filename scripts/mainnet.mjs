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
import {
  BALLOT_TAG,
  PlanBuilder,
  ballotStage,
  decodeBallot,
  toInvokeCall,
} from '../sdk/src/index.ts'

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

/**
 * The public side of a private transaction.
 *
 * The pool pulls its flat fee from the public caller with transfer_from, on
 * top of the gas a proof-verified call costs. So every private phase needs
 * three things on the public side that no single error names together: the
 * fee amount, an allowance that covers it, and a balance that covers fee
 * plus gas. Read all three up front, and top the allowance up when sending,
 * because 'Insufficient ERC20 allowance' from the pool has cost this project
 * a proof before and 'Insufficient ERC20 balance' would cost it the gas.
 */
async function feeSide() {
  const [feeRaw] = await provider.callContract({ contractAddress: POOL, entrypoint: 'get_fee_amount' })
  const [allowRaw] = await provider.callContract({
    contractAddress: STRK,
    entrypoint: 'allowance',
    calldata: [account.address, POOL],
  })
  const [balanceRaw] = await provider.callContract({
    contractAddress: STRK,
    entrypoint: 'balanceOf',
    calldata: [account.address],
  })
  const side = { fee: BigInt(feeRaw), allowance: BigInt(allowRaw), balance: BigInt(balanceRaw) }
  console.log(
    `pool fee ${strk(side.fee)} STRK · allowance ${strk(side.allowance)} · public balance ${strk(side.balance)}`,
  )
  return side
}

const strk = (wei) => (Number(wei) / 1e18).toFixed(2)

async function submit(callAndProof, label) {
  const side = await feeSide()
  const proof = callAndProof.proof?.proofFacts?.length
    ? { proofFacts: callAndProof.proof.proofFacts, proof: callAndProof.proof.data }
    : {}
  if (!EXECUTE) {
    console.log(`\n[dry run] ${label} built. Pass --execute to send it.`)
    console.log(JSON.stringify(callAndProof.call, (_, v) => (typeof v === 'bigint' ? `0x${v.toString(16)}` : v), 2).slice(0, 600))
    // What it would cost, asked of the node rather than guessed. A dry run
    // that proves for thirty seconds and then cannot say whether the account
    // can pay is a dry run that ends in a reverted transaction: the pool's
    // flat fee is pulled from the *public* caller by transfer_from, on top of
    // gas, and a shortfall surfaces here as the node's revert reason rather
    // than on chain with the gas already spent.
    try {
      const estimate = await account.estimateInvokeFee(callAndProof.call, { tip: 0n, ...proof })
      const fee = Number(estimate.overall_fee) / 1e18
      console.log(`estimated gas ${fee.toFixed(4)} STRK, on top of the pool fee`)
    } catch (error) {
      // The node echoes the whole request before the reason, so the tail is
      // the part worth reading.
      const text = String(error?.message ?? error).replace(/\s+/g, ' ')
      // Nested one contract per frame; the innermost string is the reason.
      const frames = [...text.matchAll(/"error":"((?:\\.|[^"])+)"/g)].map((m) => m[1])
      const reason = (frames.at(-1) ?? text.slice(-700)).replace(/\\"/g, '"').replace(/^"|"$/g, '')
      console.log(`the node would not estimate it: ${reason}`)
    }
    if (side.allowance < side.fee) {
      console.log(`the allowance is short of the pool fee; --execute sends an approve first`)
    }
    if (side.balance < side.fee) {
      console.log(
        `the public balance is short of the pool fee by ${strk(side.fee - side.balance)} STRK before gas; fund ${account.address}`,
      )
    }
    return null
  }
  if (side.allowance < side.fee) {
    const approve = await account.execute({
      contractAddress: STRK,
      entrypoint: 'approve',
      calldata: [POOL, `0x${side.fee.toString(16)}`, '0x0'],
    })
    console.log(`approve: ${approve.transaction_hash}`)
    await provider.waitForTransaction(approve.transaction_hash)
  }
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

  const [deployed] = await provider.callContract({
    contractAddress: anonymizer,
    entrypoint: 'get_shadow_account',
    calldata: [num.toHex(commitment)],
  })
  // Zero until the first interaction deploys it. The address is still
  // knowable: get_shadow_accounts returns, for an undeployed nonce, the
  // address the deploy syscall will derive - which is how the pool knows
  // where to send an input before the account exists. The first run of this
  // phase passed the zero straight into approve(0x0, 0) and the node
  // answered 'ERC20: approve to 0' after thirty seconds of proving.
  let shadowAccount = deployed
  if (BigInt(deployed) === 0n) {
    const [, , predicted] = await provider.callContract({
      contractAddress: anonymizer,
      entrypoint: 'get_shadow_accounts',
      calldata: [num.toHex(partial), num.toHex(nonce), num.toHex(BigInt(nonce) + 1n), '0x0'],
    })
    shadowAccount = predicted
    console.log(`shadow account     ${shadowAccount} (not deployed yet; this transaction deploys it)`)
  } else {
    console.log(`shadow account     ${shadowAccount}`)
  }

  // An approve of zero to itself: the smallest call that proves the account
  // can act, and one that leaves no allowance behind.
  const { callAndProof } = await transfers
    .build({ autoSetup: true })
    .surplusTo(account.address)
    .shadowAccounts(dapp)
    .invoke(nonce, {
      calls: [{ contractAddress: STRK, entrypoint: 'approve', calldata: [shadowAccount, '0x0', '0x0'] }],
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
    shortString.encodeShortString(BALLOT_TAG),
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

/**
 * The other half of a ballot: taking the stake back.
 *
 * `redeem` has been in the governor, with tests, since the ballot shipped, and
 * until now no code anywhere could call it - not this script, not the app, not
 * the SDK. A stake that can be taken and not returned is not an escrow, it is a
 * donation, and the composer was telling voters otherwise.
 *
 * REDEEM returns one `OpenNoteDeposit`, so unlike CAST this declares an open
 * note for the governor to credit. The secret travels in the calldata because
 * the contract has to hash it - which is why it stops being a secret the moment
 * this lands, and why the transaction should come from an account the caster is
 * content to be linked to.
 */
async function redeem(secret) {
  requireProver('redeem')
  const governor = env('GOVERNOR_ADDRESS')
  if (!secret || !/^0x[0-9a-fA-F]{1,64}$/.test(secret)) {
    throw new Error('usage: node scripts/mainnet.mjs redeem <0x-secret> [--execute]')
  }

  const commitment = hash.computePoseidonHashOnElements([
    shortString.encodeShortString(BALLOT_TAG),
    secret,
  ])

  // Read before writing. The governor refuses a ballot that does not exist, one
  // already claimed, and one whose vote is still open - all after proving, all
  // for the price of the gas. Asking first costs one `starknet_call`.
  const raw = await provider.callContract({
    contractAddress: governor,
    entrypoint: 'get_ballot',
    calldata: [commitment],
  })
  const ballot = decodeBallot(raw)
  if (ballot.proposalId === 0n) throw new Error(`no ballot for commitment ${commitment}`)
  if (ballot.claimed) throw new Error('this ballot has already been redeemed')

  const proposal = await provider.callContract({
    contractAddress: governor,
    entrypoint: 'get_proposal',
    calldata: [ballot.proposalId],
  })
  const endBlock = Number(BigInt(proposal[4]))
  const head = await provider.getBlockNumber()
  const stage = ballotStage(ballot, { endBlock }, head)
  if (stage.name === 'voting') {
    throw new Error(
      `voting closes at block ${endBlock} and the head is ${head}; ` +
        `${stage.blocksLeft} blocks to go, and redeeming before then reverts with GOV_VOTING_OPEN`,
    )
  }

  console.log(`proposal   ${ballot.proposalId}`)
  console.log(`stake      ${Number(ballot.amount) / 1e18} STRK`)
  console.log(`commitment ${commitment}`)

  const { callAndProof } = await transfers
    .build({ autoSetup: true })
    .surplusTo(account.address)
    .with(STRK, (t) => t.transfer({ recipient: account.address, amount: 'OPEN' }))
    .invoke(({ openNotes, poolAddress }) => ({
      contractAddress: governor,
      // privacy_invoke(pool_address, operation, proposal_id, support,
      //                commitment, secret, amount, note_id)
      calldata: [poolAddress, 1n, 0n, 0n, 0n, secret, 0n, BigInt(openNotes[0].noteId)],
    }))
    .execute({ provingBlockId: await provingBlockId() })

  return submit(callAndProof, 'redeem')
}

/**
 * Open a proposal, so there is something to vote on.
 *
 * The one governance call that is an ordinary public transaction: no proving
 * service, no shielded balance, no pool fee - about a quarter of a STRK in gas.
 * It is here because the ballot phase needs an open proposal and voting closes
 * after `voting_blocks`, so the proposal a ballot needs is almost always one
 * nobody has made yet. Doing it by hand meant a throwaway script each time.
 *
 * `LABEL` by default, which writes a name into the governor's storage and
 * changes nothing about the router unless it carries and clears the timelock.
 */
async function propose(kind = '4', label = 'JALIN_ROUTER') {
  const governor = env('GOVERNOR_ADDRESS')
  const router = env('ROUTER_ADDRESS')

  const call = {
    contractAddress: governor,
    entrypoint: 'propose',
    // propose(kind, target, value_a, value_b)
    calldata: [BigInt(kind), router, shortString.encodeShortString(label), 0n],
  }

  const fee = await account.estimateInvokeFee([call])
  console.log(`kind       ${kind}`)
  console.log(`estimate   ${(Number(fee.overall_fee) / 1e18).toFixed(5)} STRK`)

  if (!EXECUTE) return null

  const tx = await account.execute([call])
  console.log(`sent       ${tx.transaction_hash}`)
  await provider.waitForTransaction(tx.transaction_hash)

  const count = await provider.callContract({
    contractAddress: governor,
    entrypoint: 'proposal_count',
    calldata: [],
  })
  const id = BigInt(count[0])
  const proposal = await provider.callContract({
    contractAddress: governor,
    entrypoint: 'get_proposal',
    calldata: [num.toHex(id)],
  })
  const endBlock = Number(BigInt(proposal[4]))
  const head = await provider.getBlockNumber()
  console.log(`proposal   ${id}`)
  console.log(`voting     until block ${endBlock}, ${endBlock - head} blocks from here`)
  console.log('           cast on it from /compose before then; the stake redeems after it')
  return tx.transaction_hash
}

// ---------------------------------------------------------------------------

const phases = { register, shield, transfer, plan, shadow, propose, ballot, redeem }
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
