import { checkReceipt, describeVerdict } from '@jalin/sdk'
import { RpcError, rpc } from '@/lib/rpc'
import { GOVERNOR_ADDRESS, POOL_ADDRESS, ROUTER_ADDRESS } from '@/lib/config'

/**
 * Judge a transaction by the sprint's own rules, so the demo can say whether
 * what you signed would count rather than handing you a hash and a block
 * explorer. The rules live in the SDK, shared with the manifest verifier.
 */
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const hash = new URL(request.url).searchParams.get('hash')
  if (!hash || !/^0x[0-9a-fA-F]{1,64}$/.test(hash)) {
    return Response.json({ error: 'hash must be a felt' }, { status: 400 })
  }

  let receipt: unknown = null
  try {
    receipt = await rpc.receipt(hash)
  } catch (error) {
    if (error instanceof RpcError && error.kind === 'unconfigured') {
      return Response.json({ error: 'no rpc configured' }, { status: 503 })
    }
    // A transaction that is not on chain yet is a verdict, not a failure: the
    // demo polls this while the wallet is still proving.
  }

  const verdict = checkReceipt(receipt as never, {
    pool: POOL_ADDRESS,
    ours: [ROUTER_ADDRESS, GOVERNOR_ADDRESS].filter(Boolean),
  })
  return Response.json({ ...verdict, summary: describeVerdict(verdict) })
}
