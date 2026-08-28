import { AVNU_EXCHANGE, ROUTER_ADDRESS, TOKENS, tokenOf } from '@/lib/config'

/**
 * A DEX route as a step, from AVNU's own aggregator.
 *
 * The argument this project makes is that any contract with an ABI is
 * reachable from inside a private transaction without an adapter. Endur proved
 * it for a vault. A swap is the primitive every other DeFi action is built on,
 * and a venue's calldata is the part nobody wants to hand-encode: AVNU's
 * `multi_route_swap` carries the route it found, split across pools, with the
 * router named as beneficiary so the bought tokens land where the pool can
 * pull them from.
 *
 * So this asks AVNU for a quote with the router as taker, has AVNU build the
 * calls, and hands back the swap call's target, selector and calldata as the
 * fields of a step. The approve call AVNU also returns is dropped: the router
 * grants and resets approvals itself (I3), so the step declares the spend and
 * the router does the approving.
 *
 * This is not AVNU's private-swap route. That route is AVNU's own anonymizer,
 * one venue in the one invoke the pool allows. This is AVNU as one step among
 * several - a swap beside a stake, in the same invoke - which is the thing the
 * anonymizer cannot do.
 *
 * Nothing is cached: a quote is bound to a block and a price, and serving a
 * stale one would build a step whose floor no longer holds.
 */
export const dynamic = 'force-dynamic'

const AVNU = 'https://starknet.api.avnu.fi'

/** A felt AVNU's API compares as a string, so it is sent unpadded. */
const unpad = (address: string) => `0x${BigInt(address).toString(16)}`

interface Quote {
  quoteId: string
  buyAmount: string
  sellAmount: string
  routes?: { name?: string }[]
  sellAmountInUsd?: number
  buyAmountInUsd?: number
}

interface Built {
  calls?: { contractAddress: string; entrypoint: string; calldata: string[] }[]
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams
  const sell = tokenOf(params.get('sell') ?? '')
  const buy = tokenOf(params.get('buy') ?? '')
  const amount = params.get('amount') ?? ''
  const slippage = Number(params.get('slippage') ?? '0.01')

  // Only tokens this app knows. The route builds a step that spends whatever
  // it is told to, and an address nobody here has looked at is not something
  // to hand a router's approval to on a stranger's say-so.
  if (!sell || !buy) {
    return Response.json(
      { error: `sell and buy must be one of ${TOKENS.map((t) => t.symbol).join(', ')}` },
      { status: 400 },
    )
  }
  if (sell.address === buy.address) {
    return Response.json({ error: 'sell and buy must differ' }, { status: 400 })
  }
  if (!/^\d+$/.test(amount) || BigInt(amount) === 0n) {
    return Response.json({ error: 'amount must be an integer in base units' }, { status: 400 })
  }
  if (!(slippage > 0 && slippage < 0.5)) {
    return Response.json({ error: 'slippage must be between 0 and 0.5' }, { status: 400 })
  }
  if (!ROUTER_ADDRESS) {
    return Response.json({ error: 'no router deployed' }, { status: 503 })
  }

  try {
    const taker = unpad(ROUTER_ADDRESS)
    const quoteUrl =
      `${AVNU}/swap/v2/quotes?sellTokenAddress=${unpad(sell.address)}` +
      `&buyTokenAddress=${unpad(buy.address)}&sellAmount=0x${BigInt(amount).toString(16)}` +
      `&takerAddress=${taker}&size=1`
    const quotes = (await (
      await fetch(quoteUrl, { signal: AbortSignal.timeout(10_000), cache: 'no-store' })
    ).json()) as Quote[]
    const quote = quotes[0]
    if (!quote) {
      return Response.json(
        { error: `AVNU found no route from ${sell.symbol} to ${buy.symbol} for that amount` },
        { status: 404 },
      )
    }

    const built = (await (
      await fetch(`${AVNU}/swap/v2/build`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ quoteId: quote.quoteId, takerAddress: taker, slippage, includeApprove: false }),
        signal: AbortSignal.timeout(10_000),
        cache: 'no-store',
      })
    ).json()) as Built

    const swap = built.calls?.find((call) => call.entrypoint === 'multi_route_swap')
    if (!swap) {
      return Response.json({ error: 'AVNU built no multi_route_swap call' }, { status: 502 })
    }
    // The contract AVNU names must be the one this app verified. A different
    // one would still be a valid step; it would not be a step anyone here has
    // read the ABI of.
    if (BigInt(swap.contractAddress) !== BigInt(AVNU_EXCHANGE)) {
      return Response.json(
        { error: `AVNU built the swap against ${swap.contractAddress}, not the exchange this app knows` },
        { status: 502 },
      )
    }
    // The beneficiary must be the router, or the bought tokens land somewhere
    // the pool cannot pull them from and the plan reverts on I4.
    if (!swap.calldata.some((felt) => BigInt(felt) === BigInt(ROUTER_ADDRESS))) {
      return Response.json({ error: 'AVNU did not name the router as beneficiary' }, { status: 502 })
    }

    // The floor is AVNU's own minimum, which is buy_token_min_amount inside the
    // calldata: sell(3) buy(1) buyAmount(2) then min(2), so felts 6 and 7.
    const min = BigInt(swap.calldata[6]!) + (BigInt(swap.calldata[7] ?? '0x0') << 128n)

    return Response.json({
      exchange: AVNU_EXCHANGE,
      entrypoint: 'multi_route_swap',
      calldata: swap.calldata,
      sell: { token: sell.address, amount, usd: quote.sellAmountInUsd ?? null },
      buy: { token: buy.address, amount: BigInt(quote.buyAmount).toString(), min: min.toString(), usd: quote.buyAmountInUsd ?? null },
      route: (quote.routes ?? []).map((r) => r.name ?? 'unknown'),
      slippage,
    })
  } catch (error) {
    return Response.json({ error: String((error as Error).message) }, { status: 502 })
  }
}
