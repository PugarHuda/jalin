import { hash } from 'starknet'
import { ENDUR_VAULT } from '@/lib/config'

/**
 * What a deposit is worth right now, straight from the vault.
 *
 * The floor on a plan output used to be a constant - 78% of assets, chosen
 * because it looked safe. A constant cannot know that the share price moved, so
 * it is either too loose to protect anything or tight enough to revert for no
 * reason. `preview_deposit` is the vault's own answer to the same question.
 *
 * Server-side because the RPC URL carries an API key. The quote itself is
 * public, but the key that fetches it should not be.
 */
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const rpc = process.env.STARKNET_RPC_URL
  if (!rpc) {
    return Response.json({ error: 'no rpc configured' }, { status: 503 })
  }

  const assets = new URL(request.url).searchParams.get('assets')
  if (!assets || !/^\d+$/.test(assets)) {
    return Response.json({ error: 'assets must be an integer in base units' }, { status: 400 })
  }

  const amount = BigInt(assets)
  // Hex, not decimal. starknet.js normalises felts for you; a raw fetch does not,
  // and the node answers a decimal calldata entry with a bare failure.
  const low = `0x${(amount & ((1n << 128n) - 1n)).toString(16)}`
  const high = `0x${(amount >> 128n).toString(16)}`

  try {
    const response = await fetch(rpc, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 1,
        jsonrpc: '2.0',
        method: 'starknet_call',
        params: {
          block_id: 'latest',
          request: {
            contract_address: ENDUR_VAULT,
            entry_point_selector: hash.getSelectorFromName('preview_deposit'),
            calldata: [low, high],
          },
        },
      }),
      cache: 'no-store',
    })

    const body = (await response.json()) as { result?: string[]; error?: unknown }
    if (!body.result) return Response.json({ error: 'vault call failed' }, { status: 502 })

    const shares = BigInt(body.result[0]!) + (BigInt(body.result[1] ?? '0x0') << 128n)
    return Response.json({ assets: amount.toString(), shares: shares.toString() })
  } catch {
    return Response.json({ error: 'vault unreachable' }, { status: 502 })
  }
}
