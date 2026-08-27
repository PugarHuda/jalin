import { RpcError, rpc } from '@/lib/rpc'
import { GOVERNOR_ADDRESS, POOL_ADDRESS } from '@/lib/config'

/**
 * What the router is running on right now.
 *
 * The composer used to validate plans against constants compiled into the SDK.
 * They matched the chain on the day they were written, which is the problem:
 * every one of them is owned by a vote. A plan that passed a stale bound gets a
 * proof generated for it and then reverts, thirty seconds later, on chain.
 *
 * `denied` answers the same question for specific targets, because the router
 * refuses a denied target and nothing in the composer could see that either.
 *
 * `openProposal` is the same problem one layer up. A ballot is only castable
 * while its proposal's voting window is open, and the composer used to name a
 * proposal id compiled into it - which closed after 2000 blocks and left the
 * run pointing at a certain revert, thirty seconds of proving later.
 */
export const revalidate = 30

const MAX_TARGETS = 8

export async function GET(request: Request) {
  if (!GOVERNOR_ADDRESS) {
    return Response.json({ error: 'no governor deployed' }, { status: 503 })
  }

  const asked = (new URL(request.url).searchParams.get('targets') ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)

  if (asked.length > MAX_TARGETS) {
    return Response.json({ error: `at most ${MAX_TARGETS} targets` }, { status: 400 })
  }
  const bad = asked.find((entry) => !/^0x[0-9a-fA-F]{1,64}$/.test(entry))
  if (bad) return Response.json({ error: `${bad} is not a felt` }, { status: 400 })

  try {
    const [raw, head, rawCount, rawPoolFee] = await Promise.all([
      rpc.call(GOVERNOR_ADDRESS, 'params', [], revalidate),
      rpc.blockNumber(revalidate),
      rpc.call(GOVERNOR_ADDRESS, 'proposal_count', [], revalidate),
      // The pool's own flat charge per private operation, and nothing to do
      // with the router's feeBps above. It is read rather than assumed because
      // assuming it is what broke the mainnet run: the shield was sized at 1
      // STRK against a fee that has been 6 STRK on mainnet all along, so the
      // first spend failed for a reason no screen here could name. The skill
      // shipped with this repository says 4; the chain says otherwise, which
      // is the whole argument for reading it.
      rpc.call(POOL_ADDRESS, 'get_fee_amount', [], revalidate),
    ])

    const denied: Record<string, boolean> = {}
    for (const target of asked) {
      const answer = await rpc.call(GOVERNOR_ADDRESS, 'is_denied', [target], revalidate)
      denied[target] = BigInt(answer[0] ?? '0x0') !== 0n
    }

    /**
     * The newest proposal still taking votes, searched newest first.
     *
     * Bounded to the last few: a ballot is worth casting on something current,
     * and walking the whole history to find one would be a request per
     * proposal for an answer nobody wants.
     */
    const count = Number(BigInt(rawCount[0] ?? '0x0'))
    let openProposal: { id: number; endBlock: number; blocksLeft: number } | null = null

    for (let id = count; id > 0 && id > count - 5; id -= 1) {
      const proposal = await rpc.call(GOVERNOR_ADDRESS, 'get_proposal', [BigInt(id)], revalidate)
      const endBlock = Number(BigInt(proposal[4] ?? '0x0'))

      // end_block of zero means no such proposal; the contract uses it as the
      // existence check too.
      if (endBlock === 0 || head > endBlock) continue
      openProposal = { id, endBlock, blocksLeft: endBlock - head }
      break
    }

    return Response.json({
      paused: BigInt(raw[0] ?? '0x0') !== 0n,
      openProposal,
      maxSteps: Number(BigInt(raw[1] ?? '0x0')),
      maxCalldata: Number(BigInt(raw[2] ?? '0x0')),
      feeBps: Number(BigInt(raw[3] ?? '0x0')),
      // A string, because it is 6e18 and JSON numbers lose felts this size.
      poolFee: BigInt(rawPoolFee[0] ?? '0x0').toString(),
      denied,
    })
  } catch (error) {
    if (error instanceof RpcError && error.kind === 'unconfigured') {
      return Response.json({ error: 'no rpc configured' }, { status: 503 })
    }
    return Response.json({ error: String((error as Error).message) }, { status: 502 })
  }
}
