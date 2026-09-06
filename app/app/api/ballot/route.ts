import { ballotStage, decodeBallot, FIELD_PRIME } from 'jalin-sdk'
import { cached } from '@/lib/cache'
import { GOVERNOR_ADDRESS, TOKENS } from '@/lib/config'
import { RpcError, rpc } from '@/lib/rpc'

/**
 * What a ballot commitment is worth right now, read from the governor.
 *
 * The composer mints a secret when a ballot is cast and tells the voter that it
 * is the only way to get the stake back. Until this route existed there was no
 * way to ask whether that was true of a particular secret: `get_ballot`,
 * `ballot_commitment` and `outstanding` were all implemented on chain and read
 * by nothing.
 *
 * **The commitment is the argument, and the secret must never be.** They are
 * `poseidon_hash_span([BALLOT_TAG, secret])` apart, and the hash is what the
 * governor stores. A route that took the secret would put the bearer instrument
 * in a URL, a server log and a CDN cache in one request, which is why the page
 * hashes it in the browser and sends only the result. The commitment discloses
 * that somebody is asking about *a* ballot; the secret would hand over the
 * stake.
 *
 * The escrow figures come back with it, because a redeemer's real question is
 * whether the governor can pay: `outstanding()` is what it owes every unclaimed
 * ballot, and `balanceOf(governor)` is what it holds against that.
 */
export const revalidate = 15

const STRK = TOKENS[0]!.address

/**
 * `outstanding()`, or null because the deployed governor does not have it.
 *
 * The view was added with the unbacked-weight fix, and that fix is source and
 * tests rather than an address: the governor at `0x05bd985e…` predates it and
 * answers `Requested entrypoint does not exist in the contract`. Reporting zero
 * there would be the worst possible answer — it reads as "nothing is owed" when
 * what happened is that nobody can ask. Null, and the page says which.
 *
 * Only that one refusal is swallowed. A node that is down, or an entrypoint
 * that exists and reverts, still fails the request.
 */
async function readOutstanding(): Promise<string | null> {
  try {
    const raw = await rpc.call(GOVERNOR_ADDRESS, 'outstanding', [], revalidate)
    return BigInt(raw[0]!).toString()
  } catch (error) {
    if (error instanceof RpcError && /entrypoint/i.test(error.message)) return null
    throw error
  }
}

export async function GET(request: Request) {
  const commitment = new URL(request.url).searchParams.get('commitment')
  if (!commitment || !/^0x[0-9a-fA-F]{1,64}$/.test(commitment)) {
    return Response.json({ error: 'commitment must be a felt' }, { status: 400 })
  }
  // 64 hex digits is not the same as a felt: everything above the field prime
  // is the right shape and not a field element. The node answers that with
  // `Invalid params`, which arrives here as a 502 - a bad request reported as
  // somebody else's fault.
  if (BigInt(commitment) >= FIELD_PRIME) {
    return Response.json({ error: 'commitment is larger than the field prime' }, { status: 400 })
  }
  if (!GOVERNOR_ADDRESS) {
    return Response.json({ error: 'no governor configured' }, { status: 503 })
  }

  try {
    // The governor's own accounting first, in parallel: nothing here depends on
    // anything else here, and the page renders all of it at once.
    const [rawBallot, head, outstanding, rawHeld] = await Promise.all([
      rpc.call(GOVERNOR_ADDRESS, 'get_ballot', [commitment], revalidate),
      rpc.blockNumber(revalidate),
      readOutstanding(),
      rpc.call(STRK, 'balanceOf', [GOVERNOR_ADDRESS], revalidate),
    ])

    const ballot = decodeBallot(rawBallot)
    const escrow = {
      outstanding,
      // u256, low then high. The high word is not optional just because this
      // balance is small today.
      held: (BigInt(rawHeld[0]!) + (BigInt(rawHeld[1] ?? '0x0') << 128n)).toString(),
      token: STRK,
    }

    // A commitment nobody staked against reads back as zeros, and asking the
    // governor for proposal 0 would answer with zeros too - so this stops here
    // rather than reporting a proposal that does not exist.
    if (ballot.proposalId === 0n) {
      return cached(
        {
          commitment,
          stage: { name: 'unknown' as const },
          ballot: { proposalId: '0', amount: '0', claimed: false },
          proposal: null,
          head,
          escrow,
        },
        revalidate,
      )
    }

    const rawProposal = await rpc.call(
      GOVERNOR_ADDRESS,
      'get_proposal',
      [ballot.proposalId],
      revalidate,
    )
    const proposal = {
      id: ballot.proposalId.toString(),
      endBlock: Number(BigInt(rawProposal[4]!)),
      eta: Number(BigInt(rawProposal[5]!)),
      executed: BigInt(rawProposal[8]!) !== 0n,
    }

    return cached(
      {
        commitment,
        stage: ballotStage(ballot, proposal, head),
        ballot: {
          proposalId: ballot.proposalId.toString(),
          amount: ballot.amount.toString(),
          claimed: ballot.claimed,
        },
        proposal,
        head,
        escrow,
      },
      revalidate,
    )
  } catch (error) {
    if (error instanceof RpcError && error.kind === 'unconfigured') {
      return Response.json({ error: 'no rpc configured' }, { status: 503 })
    }
    return Response.json({ error: String((error as Error).message) }, { status: 502 })
  }
}
