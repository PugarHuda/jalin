import { RpcError, rpc } from '@/lib/rpc'
import { GOVERNOR_ADDRESS } from '@/lib/config'

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
    const raw = await rpc.call(GOVERNOR_ADDRESS, 'params', [], revalidate)

    const denied: Record<string, boolean> = {}
    for (const target of asked) {
      const answer = await rpc.call(GOVERNOR_ADDRESS, 'is_denied', [target], revalidate)
      denied[target] = BigInt(answer[0] ?? '0x0') !== 0n
    }

    return Response.json({
      paused: BigInt(raw[0] ?? '0x0') !== 0n,
      maxSteps: Number(BigInt(raw[1] ?? '0x0')),
      maxCalldata: Number(BigInt(raw[2] ?? '0x0')),
      feeBps: Number(BigInt(raw[3] ?? '0x0')),
      denied,
    })
  } catch (error) {
    if (error instanceof RpcError && error.kind === 'unconfigured') {
      return Response.json({ error: 'no rpc configured' }, { status: 503 })
    }
    return Response.json({ error: String((error as Error).message) }, { status: 502 })
  }
}
