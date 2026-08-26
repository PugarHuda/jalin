import { RpcError, rpc } from '@/lib/rpc'
import { u256 } from '@jalin/sdk'
import { ENDUR_VAULT } from '@/lib/config'

/**
 * What a deposit is worth right now, from the vault itself.
 *
 * The floor on a plan output used to be a constant chosen because it looked
 * safe. A constant cannot know the share price moved, so it is either too loose
 * to guard anything or tight enough to revert for no reason.
 */
/**
 * Cached for half a minute. A vault share price moves with staking rewards, not
 * with the page load, so re-asking on every render only spends the node's quota
 * - and the quota is a shared key that anyone reloading the page can drain.
 */
export const revalidate = 30

export async function GET(request: Request) {
  const assets = new URL(request.url).searchParams.get('assets')
  if (!assets || !/^\d+$/.test(assets)) {
    return Response.json({ error: 'assets must be an integer in base units' }, { status: 400 })
  }

  const amount = BigInt(assets)
  try {
    const result = await rpc.call(ENDUR_VAULT, 'preview_deposit', u256(amount), revalidate)
    const shares = BigInt(result[0]!) + (BigInt(result[1] ?? '0x0') << 128n)
    return Response.json({ assets: amount.toString(), shares: shares.toString() })
  } catch (error) {
    if (error instanceof RpcError && error.kind === 'unconfigured') {
      return Response.json({ error: 'no rpc configured' }, { status: 503 })
    }
    // The node's own message, rather than a summary that hides which field it
    // disliked.
    return Response.json({ error: String((error as Error).message) }, { status: 502 })
  }
}
