import { prospectFor } from '@jalin/sdk'
import { readCrowd, readDeposits } from '@/lib/crowd-source'

/**
 * The crowd, for the composer. The counting itself lives in lib/crowd-source so
 * the landing page can call it without asking this route over HTTP.
 *
 * With `asset` and `amount` it answers a sharper question: how many people are
 * already in the cell this particular deposit would land in. That is the number
 * that describes your transaction, where the pool-wide count describes the
 * pool's history.
 */
export const revalidate = 300

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams
  const asset = params.get('asset')
  const amount = params.get('amount')

  if (asset === null && amount === null) {
    const crowd = await readCrowd(revalidate)
    if (!crowd) return Response.json({ error: 'pool unreachable' }, { status: 502 })
    return Response.json(crowd)
  }

  if (!asset || !/^0x[0-9a-fA-F]{1,64}$/.test(asset)) {
    return Response.json({ error: 'asset must be a felt' }, { status: 400 })
  }
  if (!amount || !/^\d+$/.test(amount)) {
    return Response.json({ error: 'amount must be an integer in base units' }, { status: 400 })
  }

  const reading = await readDeposits(revalidate)
  if (!reading) return Response.json({ error: 'pool unreachable' }, { status: 502 })

  return Response.json(
    prospectFor(reading.events, { asset, amount: BigInt(amount), atBlock: reading.head }),
  )
}
