/**
 * The governor's two ballot operations, as wallet actions.
 *
 * `JalinGovernor::privacy_invoke` takes a fixed eight-felt argument list and
 * switches on the first of them:
 *
 *   privacy_invoke(pool_address, operation, proposal_id, support,
 *                  commitment, secret, amount, note_id)
 *
 * `CAST` reads `proposal_id`, `support`, `commitment` and `amount`, and returns
 * an empty span - the stake stays in the governor, so there is nothing to credit
 * back and no open note to declare. `REDEEM` reads `secret` and `note_id` and
 * returns one `OpenNoteDeposit`, so it needs exactly one open note.
 *
 * That asymmetry is the whole reason this module exists. The cast half was
 * hand-encoded in two places - the composer and `scripts/mainnet.mjs` - with the
 * argument order written out in a comment beside each. The redeem half was
 * written in Cairo, tested in Cairo, and then encoded nowhere at all, which made
 * every ballot cast so far a stake with no way back. One encoder, one test, both
 * operations.
 *
 * The commitment is an argument rather than something computed here. It is
 * `poseidon_hash_span([BALLOT_TAG, secret])`, and Poseidon over the Starknet
 * field is a dependency this package does not have and will not take on for one
 * hash. The caller has starknet.js; `BALLOT_TAG` is exported so the two agree on
 * the tag rather than each carrying its own copy of the string.
 */

import { openNote, POOL_ADDRESS, type Felt } from './plan.ts'
import { toFelt, feltsToStrings, type Strk20Action } from './wallet.ts'

/** Domain separator the governor hashes with the secret. Matches `BALLOT_TAG`. */
export const BALLOT_TAG = 'JALIN_BALLOT:V1'

/** `operation` in `privacy_invoke`. Matches `types::ops`. */
export const BALLOT_OPS = { CAST: 0n, REDEEM: 1n } as const

/** `support` in `privacy_invoke`. Anything non-zero is a yes to the contract. */
export const BALLOT_SUPPORT = { NO: 0n, YES: 1n } as const

export interface CastBallotArgs {
  /** Deployed JalinGovernor address. */
  governor: string
  /** The open proposal being voted on. Zero is not a proposal. */
  proposalId: bigint
  /** Weight staked, in the governor's ballot token. */
  amount: bigint
  /** `poseidon_hash_span([BALLOT_TAG, secret])`, computed by the caller. */
  commitment: Felt
  /** The ballot token the pool withdraws to the governor. */
  ballotToken: string
  /** Yes unless told otherwise; a ballot nobody meant to cast is a no. */
  support?: bigint
}

/**
 * Stake, then vote, in one pool transaction.
 *
 * The withdraw sends the stake to the *governor*, not to the router: the
 * governor holds its own escrow, and `cast` checks its token balance covers
 * `outstanding + amount` before it counts the weight. A vote whose funds went
 * somewhere else is the unbacked-weight defect this ordering exists to prevent.
 */
export function castBallotActions(args: CastBallotArgs): Strk20Action[] {
  if (args.proposalId <= 0n) {
    throw new RangeError(`proposal id must be positive, got ${args.proposalId}`)
  }
  if (args.amount <= 0n) {
    throw new RangeError(`a ballot stakes a positive amount, got ${args.amount}`)
  }

  const support = args.support ?? BALLOT_SUPPORT.YES

  return [
    {
      type: 'withdraw',
      token: toFelt(args.ballotToken),
      amount: toFelt(args.amount),
      recipient: toFelt(args.governor),
    },
    {
      type: 'invoke',
      contract: toFelt(args.governor),
      calldata: feltsToStrings([
        POOL_ADDRESS,
        BALLOT_OPS.CAST,
        args.proposalId,
        support,
        args.commitment,
        // The secret never leaves the voter. Sending it here would publish the
        // bearer instrument in the calldata of the transaction that created it.
        0n,
        args.amount,
        0n,
      ]),
    },
  ]
}

export interface RedeemBallotArgs {
  /** Deployed JalinGovernor address. */
  governor: string
  /** The secret held since the ballot was cast. Sent on chain by this action. */
  secret: Felt
  /** The ballot token the stake comes back as. */
  ballotToken: string
  /** Who the returned note belongs to - normally the connected account. */
  recipient: string
}

/**
 * Take the stake back, once voting has closed.
 *
 * Two things about this are worth knowing before it is sent. The secret appears
 * in the calldata, which is public: after redemption the commitment is linkable
 * to whoever submitted this transaction, so redeeming from the account that cast
 * the ballot rejoins the two halves the commitment separated. And the governor
 * refuses while `block_number <= proposal.end_block`, so an early attempt costs
 * gas and reverts with `GOV_VOTING_OPEN`.
 *
 * The open note is declared, not optional: `redeem` returns one
 * `OpenNoteDeposit` naming `note_id`, and a transaction that returns a deposit
 * without an open note to credit is rejected by the pool.
 */
export function redeemBallotActions(args: RedeemBallotArgs): Strk20Action[] {
  if (BigInt(args.secret) === 0n) {
    throw new RangeError('zero is not a ballot secret')
  }

  return [
    {
      type: 'transfer',
      token: toFelt(args.ballotToken),
      amount: 'OPEN',
      recipient: toFelt(args.recipient),
    },
    {
      type: 'invoke',
      contract: toFelt(args.governor),
      calldata: feltsToStrings([
        POOL_ADDRESS,
        BALLOT_OPS.REDEEM,
        // proposal_id, support and commitment are read only by CAST. The
        // governor finds the ballot by hashing the secret.
        0n,
        0n,
        0n,
        args.secret,
        0n,
        openNote(0),
      ]),
    },
  ]
}

/** What `get_ballot(commitment)` returns, decoded. */
export interface Ballot {
  proposalId: bigint
  amount: bigint
  claimed: boolean
}

/**
 * `Ballot` from the three felts the view returns.
 *
 * A commitment nobody has staked against reads back as all zeros rather than as
 * an error, so `proposalId === 0n` is the honest test for "no such ballot" -
 * proposals are numbered from one for exactly this reason.
 */
export function decodeBallot(felts: (string | bigint)[]): Ballot {
  if (felts.length < 3) {
    throw new Error(`get_ballot returns three felts, got ${felts.length}`)
  }
  return {
    proposalId: BigInt(felts[0]!),
    amount: BigInt(felts[1]!),
    claimed: BigInt(felts[2]!) !== 0n,
  }
}

export type BallotStage =
  /** No ballot was ever cast against this commitment. */
  | { name: 'unknown' }
  /** Cast, and voting is still open. `blocksLeft` until it closes. */
  | { name: 'voting'; blocksLeft: number }
  /** Voting has closed and the stake is redeemable now. */
  | { name: 'redeemable' }
  /** Already taken back. The secret is spent. */
  | { name: 'claimed' }

/**
 * What a holder of this secret can do right now.
 *
 * The rule is the contract's, not this page's: `redeem` asserts
 * `get_block_number() > proposal.end_block`, so the last votable block is
 * `end_block` itself and redemption opens at `end_block + 1`.
 */
export function ballotStage(
  ballot: Ballot,
  proposal: { endBlock: number },
  head: number,
): BallotStage {
  if (ballot.proposalId === 0n) return { name: 'unknown' }
  if (ballot.claimed) return { name: 'claimed' }
  if (head <= proposal.endBlock) return { name: 'voting', blocksLeft: proposal.endBlock - head + 1 }
  return { name: 'redeemable' }
}
