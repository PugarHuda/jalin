import { cached } from '@/lib/cache'
import { RpcError, rpc } from '@/lib/rpc'
import { TOKENS } from '@/lib/config'

/**
 * An account's public STRK balance.
 *
 * The one number this app needed and did not have. Every run is gated on the
 * shielded balance, which the wallet reports, and the shield was gated on
 * nothing at all — so the page offered a "shield 12.1 STRK" button to an
 * account holding 4.3, and the first thing that knew better was Ready,
 * after the click, with "Transaction failed".
 *
 * Public, so this needs no viewing key and no wallet: it is an ERC-20
 * `balanceOf` anyone can make, which is precisely why the pool exists.
 */
export const revalidate = 10

const STRK = TOKENS[0]!.address

export async function GET(request: Request) {
  const address = new URL(request.url).searchParams.get('address')
  if (!address || !/^0x[0-9a-fA-F]{1,64}$/.test(address)) {
    return Response.json({ error: 'address must be a felt' }, { status: 400 })
  }

  try {
    const result = await rpc.call(STRK, 'balanceOf', [address], revalidate)
    // u256: low then high. A STRK balance never reaches the high word, and
    // reading only the low one is how a balance silently wraps.
    const balance = BigInt(result[0]!) + (BigInt(result[1] ?? '0x0') << 128n)
    return cached({ address, token: STRK, balance: balance.toString() }, revalidate)
  } catch (error) {
    if (error instanceof RpcError && error.kind === 'unconfigured') {
      return Response.json({ error: 'no rpc configured' }, { status: 503 })
    }
    return Response.json({ error: String((error as Error).message) }, { status: 502 })
  }
}
