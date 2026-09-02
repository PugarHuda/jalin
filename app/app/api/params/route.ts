import { RpcError, rpc, secondsPerBlock } from '@/lib/rpc'
import { cached } from '@/lib/cache'
import { GOVERNOR_ADDRESS, POOL_ADDRESS, SHADOW_ANONYMIZER } from '@/lib/config'

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
      //
      // Caught rather than awaited bare. Inside `Promise.all` a rejection here
      // takes the whole route to 502, which is what this one extra call did
      // under CI's load: the composer's background reads started logging
      // failures and a console-error test went red for a fee it does not need.
      // What the router is running on is answerable without it, so it answers.
      rpc.call(POOL_ADDRESS, 'get_fee_amount', [], revalidate).catch(() => null),
    ])

    // How fast the chain is moving, so "closes in 1,900 blocks" can be said in
    // minutes without a literal that was right on the day it was written. Null
    // when the node will not answer; the page then says blocks and nothing more.
    const blockTime = await secondsPerBlock(head, revalidate).catch(() => null)

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

    /**
     * What the shadow-account anonymizer says about itself.
     *
     * The address is the one constant this app does not read from the chain,
     * so the page does not take it on trust either: it asks the contract which
     * pool it is bound to and shows the answer beside our own pool address. A
     * mismatch, or a contract that is not there, is reported rather than
     * hidden - which is the only reason a hardcoded address is allowed here.
     */
    const shadow = await (async () => {
      try {
        const [pool] = await rpc.call(SHADOW_ANONYMIZER, 'get_privacy_contract', [], revalidate)
        const [accountClass] = await rpc.call(
          SHADOW_ANONYMIZER,
          'get_shadow_account_class_hash',
          [],
          revalidate,
        )
        return {
          address: SHADOW_ANONYMIZER,
          pool: pool ?? null,
          boundToOurPool: !!pool && BigInt(pool) === BigInt(POOL_ADDRESS),
          accountClass: accountClass ?? null,
        }
      } catch {
        // Not reachable is an answer. The page says the route could not be
        // checked, which is different from saying it does not exist.
        return null
      }
    })()

    return cached({
      paused: BigInt(raw[0] ?? '0x0') !== 0n,
      openProposal,
      maxSteps: Number(BigInt(raw[1] ?? '0x0')),
      maxCalldata: Number(BigInt(raw[2] ?? '0x0')),
      feeBps: Number(BigInt(raw[3] ?? '0x0')),
      // A string, because it is 6e18 and JSON numbers lose felts this size.
      // Null when the pool would not answer, which the shield reads as "do not
      // offer an amount" rather than as a fee of zero.
      poolFee: rawPoolFee ? BigInt(rawPoolFee[0] ?? '0x0').toString() : null,
      secondsPerBlock: blockTime,
      denied,
      shadow,
    }, revalidate)
  } catch (error) {
    if (error instanceof RpcError && error.kind === 'unconfigured') {
      return Response.json({ error: 'no rpc configured' }, { status: 503 })
    }
    return Response.json({ error: String((error as Error).message) }, { status: 502 })
  }
}
