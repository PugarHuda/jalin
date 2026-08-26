import { checkReceipt, describeVerdict } from '@jalin/sdk'
import { GOVERNOR_ADDRESS, POOL_ADDRESS, ROUTER_ADDRESS } from '@/lib/config'

/**
 * Judge a transaction by the sprint's own rules, so the demo can tell you
 * whether what you just signed would count instead of showing a hash and
 * leaving you to check a block explorer.
 *
 * The rules live in the SDK, shared with scripts/verify-transactions.mjs. Two
 * copies of a rule are two rules.
 */
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const rpc = process.env.STARKNET_RPC_URL
  if (!rpc) return Response.json({ error: 'no rpc configured' }, { status: 503 })

  const hash = new URL(request.url).searchParams.get('hash')
  if (!hash || !/^0x[0-9a-fA-F]{1,64}$/.test(hash)) {
    return Response.json({ error: 'hash must be a felt' }, { status: 400 })
  }

  try {
    const response = await fetch(rpc, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 1,
        jsonrpc: '2.0',
        method: 'starknet_getTransactionReceipt',
        params: { transaction_hash: hash },
      }),
      cache: 'no-store',
    })
    const body = (await response.json()) as { result?: unknown }
    const verdict = checkReceipt(body.result as never, {
      pool: POOL_ADDRESS,
      ours: [ROUTER_ADDRESS, GOVERNOR_ADDRESS].filter(Boolean),
    })
    return Response.json({ ...verdict, summary: describeVerdict(verdict) })
  } catch {
    return Response.json({ error: 'chain unreachable' }, { status: 502 })
  }
}
