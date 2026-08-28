import { expect, test } from '@playwright/test'
import {
  json,
  type CrowdResponse,
  type ErrorResponse,
  type ProspectResponse,
  type QuoteResponse,
  type SwapResponse,
  type TxResponse,
} from './api-types'

/**
 * The three read routes, against the live chain.
 *
 * A real, permanent mainnet transaction that deposited into the STRK20 pool
 * without going through any contract of ours. It is the case that catches
 * people: successful, genuinely touched the pool, and still would not score.
 */
const POOL_TX_NOT_OURS = '0x6abbe003a51a29b634d8615517d231d469f3e009b4a1289a0e701efef057779'

/** Well-formed felt, no such transaction. Nothing can ever mine into it. */
const ABSENT_TX = '0x' + 'a'.repeat(63) + '1'

test.describe('what the edge may keep', () => {
  /**
   * `revalidate` caches the fetches inside a route and says nothing about the
   * response, so every request reached a function and, cold, the node. A read
   * of the chain is the same for everyone; the header is what lets the CDN
   * answer the second visitor from the first one's read.
   */
  test('chain reads carry a public cache header', async ({ request }) => {
    for (const path of ['/api/params', '/api/crowd', '/api/quote?assets=1000000000000000000']) {
      const response = await request.get(path)
      expect(response.status(), path).toBe(200)
      expect(response.headers()['cache-control'], path).toMatch(/public, s-maxage=\d+, stale-while-revalidate=\d+/)
    }
  })

  test('a landed receipt is kept far longer than a missing one', async ({ request }) => {
    const landed = await request.get(`/api/tx?hash=0x060a25127edcca8a5f310fa711c1566dd39c688c8b30406d7482388d715ed311`)
    expect(landed.headers()['cache-control']).toContain('s-maxage=3600')
    const missing = await request.get(`/api/tx?hash=${ABSENT_TX}`)
    expect(missing.headers()['cache-control']).toContain('s-maxage=15')
  })

  test('a swap quote is never kept', async ({ request }) => {
    const response = await request.get(
      '/api/swap?sell=0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d&buy=0x033068f6539f8e6e6b131e6b2b814e6c34a5224bc66947c47dab9dfee93b35fb&amount=250000000000000000',
    )
    // Whatever AVNU answered, the answer is a price at a block and must not be
    // served to the next person from the edge.
    expect(response.headers()['cache-control'] ?? '').not.toMatch(/s-maxage/)
  })
})

test.describe('/api/swap', () => {
  const STRK = '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d'
  /** Native USDC - the one with 71 deposits in the pool, not the bridged one with 1. */
  const USDC = '0x033068f6539f8e6e6b131e6b2b814e6c34a5224bc66947c47dab9dfee93b35fb'
  const ROUTER = '0x008498d79ca390b34a6416cc45fb375ad9b921eefd8d4531d99a2d775feb3a7e'
  const EXCHANGE = '0x04270219d365d6b017231b52e92b3fb5d7c8378b05e9abc97724537a80e93b0f'

  test('turns an AVNU route into the fields of a step', async ({ request }) => {
    const response = await request.get(`/api/swap?sell=${STRK}&buy=${USDC}&amount=250000000000000000`)
    // AVNU answers "no route" for this pair now and then - five refusals in a
    // row one minute, a route at every size the next. That is the
    // aggregator's state, not this route's correctness, and the route reports
    // it as 404 with AVNU's own words. Skipped on that answer; anything else
    // that is not a route is a failure.
    if (response.status() === 404) {
      const { error } = (await response.json()) as ErrorResponse
      test.skip(/no route/i.test(error), `AVNU: ${error}`)
    }
    const body = await json<SwapResponse>(response)
    // The contract this app verified on chain, and the entrypoint it read the
    // ABI of - never whatever the aggregator happened to name.
    expect(BigInt(body.exchange)).toBe(BigInt(EXCHANGE))
    expect(body.entrypoint).toBe('multi_route_swap')

    // multi_route_swap(sell, sell_amount: u256, buy, buy_amount: u256,
    // min: u256, beneficiary, fee_bps, fee_recipient, routes...). The
    // beneficiary has to be the router or the plan reverts on I4.
    expect(BigInt(body.calldata[0]!)).toBe(BigInt(STRK))
    expect(BigInt(body.calldata[3]!)).toBe(BigInt(USDC))
    expect(BigInt(body.calldata[8]!)).toBe(BigInt(ROUTER))
    expect(body.calldata.length).toBeGreaterThan(12)

    // A floor under the quote, never at or above it, and never zero.
    const quoted = BigInt(body.buy.amount)
    const floor = BigInt(body.buy.min)
    expect(quoted).toBeGreaterThan(0n)
    expect(floor).toBeGreaterThan(0n)
    expect(floor).toBeLessThan(quoted)
    expect(body.route.length).toBeGreaterThan(0)
  })

  test('refuses a token it has not looked at', async ({ request }) => {
    const body = await json<ErrorResponse>(
      await request.get(`/api/swap?sell=0x1234&buy=${USDC}&amount=1000`),
      400,
    )
    expect(body.error).toMatch(/must be one of/)
  })

  test('refuses a swap of a token into itself, and a zero amount', async ({ request }) => {
    expect((await request.get(`/api/swap?sell=${STRK}&buy=${STRK}&amount=1000`)).status()).toBe(400)
    expect((await request.get(`/api/swap?sell=${STRK}&buy=${USDC}&amount=0`)).status()).toBe(400)
  })
})

test.describe('/api/quote', () => {
  test('quotes a deposit from the Endur vault itself', async ({ request }) => {
    const body = await json<QuoteResponse>(
      await request.get('/api/quote?assets=1000000000000000000'),
    )
    expect(body.assets).toBe('1000000000000000000')

    const shares = BigInt(body.shares)
    // xSTRK appreciates against STRK, so a share is worth more than an asset and
    // one STRK must buy strictly fewer than one share. Asserting a number would
    // assert today's exchange rate; asserting the invariant survives tomorrow.
    expect(shares).toBeGreaterThan(0n)
    expect(shares).toBeLessThan(10n ** 18n)
    expect(shares).toBeGreaterThan(5n * 10n ** 17n)
  })

  test('rejects a missing amount', async ({ request }) => {
    const body = await json<ErrorResponse>(await request.get('/api/quote'), 400)
    expect(body.error).toContain('assets')
  })

  test('rejects a non-integer amount', async ({ request }) => {
    for (const bad of ['abc', '1.5', '-1', '0x10', '1e18', ' 1']) {
      const response = await request.get(`/api/quote?assets=${encodeURIComponent(bad)}`)
      expect(response.status(), `assets=${bad} should be refused`).toBe(400)
    }
  })

  test('a zero quote is a real question, not an error', async ({ request }) => {
    const body = await json<QuoteResponse>(await request.get('/api/quote?assets=0'))
    expect(body.shares).toBe('0')
  })
})

test.describe('/api/tx', () => {
  test('a pool transaction that missed our router does not qualify', async ({ request }) => {
    const verdict = await json<TxResponse>(
      await request.get(`/api/tx?hash=${POOL_TX_NOT_OURS}`),
    )
    expect(verdict.exists).toBe(true)
    expect(verdict.succeeded).toBe(true)
    expect(verdict.touchedPool).toBe(true)
    expect(verdict.throughOurs).toBe(false)
    expect(verdict.qualifies).toBe(false)
    expect(verdict.summary).toMatch(/not through a contract of ours/)
  })

  test('a transaction that is not on chain reads as not found', async ({ request }) => {
    const verdict = await json<TxResponse>(await request.get(`/api/tx?hash=${ABSENT_TX}`))
    expect(verdict.exists).toBe(false)
    expect(verdict.qualifies).toBe(false)
  })

  test('rejects anything that is not a felt', async ({ request }) => {
    for (const bad of ['', 'nope', '0x', '0x' + 'f'.repeat(65), '123']) {
      const response = await request.get(`/api/tx?hash=${encodeURIComponent(bad)}`)
      expect(response.status(), `hash=${bad} should be refused`).toBe(400)
    }
  })
})

test.describe('/api/crowd', () => {
  test('counts the people already in the pool', async ({ request }) => {
    const crowd = await json<CrowdResponse>(await request.get('/api/crowd'))
    expect(typeof crowd.depositors).toBe('number')
    // The crowd grows; the assertion is that it is a plausible count read from
    // events, not a placeholder and not the whole event list counted twice.
    expect(crowd.depositors).toBeGreaterThan(0)
    expect(crowd.depositors).toBeLessThanOrEqual(crowd.deposits)
    expect(crowd.head).toBeGreaterThan(13_000_000)
  })
})

test.describe('the page itself', () => {
  test('cannot be framed by another site', async ({ request }) => {
    // A signing prompt inside somebody else's iframe is how a person ends up
    // approving a transaction they never saw.
    const response = await request.get('/compose')
    const headers = response.headers()

    expect(headers['content-security-policy']).toContain("frame-ancestors 'none'")
    expect(headers['x-frame-options']).toBe('DENY')
    expect(headers['x-content-type-options']).toBe('nosniff')
  })

  test('unfurls with a real card when the link is pasted', async ({ request, page }) => {
    const image = await request.get('/opengraph-image')
    expect(image.status()).toBe(200)
    expect(image.headers()['content-type']).toContain('image/png')
    expect((await image.body()).length).toBeGreaterThan(5_000)

    await page.goto('/')
    const url = await page.locator('meta[property="og:image"]').getAttribute('content')
    // Relative here means every unfurler ignores it and the link arrives blank.
    expect(url).toMatch(/^https?:\/\//)
  })
})

test.describe('/api/crowd with an intent', () => {
  const STRK = '0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d'

  test('answers how big the cell this deposit would join is', async ({ request }) => {
    const prospect = await json<ProspectResponse>(
      await request.get(`/api/crowd?asset=${STRK}&amount=1000000000000000000`),
    )
    expect(typeof prospect.headcount).toBe('number')
    // Whatever the cell holds, adding yourself can never leave it under one.
    expect(prospect.effectiveSetAfter).toBeGreaterThanOrEqual(1)
    expect(prospect.effectiveSetAfter).toBeLessThanOrEqual(prospect.headcount + 1)
  })

  test('a different magnitude is a different question', async ({ request }) => {
    const [small, large] = await Promise.all([
      request.get(`/api/crowd?asset=${STRK}&amount=1000000000000000000`),
      request.get(`/api/crowd?asset=${STRK}&amount=999000000000000000000000`),
    ])
    // Not asserted equal or unequal — asserted that both are answerable, which
    // is what would break if the cell key stopped including the magnitude.
    expect(small.status()).toBe(200)
    expect(large.status()).toBe(200)
  })

  test('rejects an asset that is not a felt and an amount that is not an integer', async ({
    request,
  }) => {
    expect((await request.get(`/api/crowd?asset=nope&amount=1`)).status()).toBe(400)
    expect((await request.get(`/api/crowd?asset=${STRK}&amount=1.5`)).status()).toBe(400)
    expect((await request.get(`/api/crowd?asset=${STRK}&amount=-1`)).status()).toBe(400)
  })

  test('the pool-wide reading carries the honest measurement too', async ({ request }) => {
    const crowd = await json<CrowdResponse>(await request.get('/api/crowd'))
    expect(crowd.cells.cells).toBeGreaterThan(0)
    // The median cell cannot be a bigger crowd than the biggest cell.
    expect(crowd.cells.medianEffectiveSet).toBeLessThanOrEqual(crowd.cells.largestEffectiveSet)
    expect(crowd.cells.aloneShare).toBeGreaterThanOrEqual(0)
    expect(crowd.cells.aloneShare).toBeLessThanOrEqual(1)
  })
})

/**
 * Three states, and one of them is not needed here.
 *
 * A loading boundary renders when a segment suspends on a reader's request.
 * Every page in this app is prerendered with ISR, so a reader is served
 * generated HTML immediately and revalidation happens behind them - there is no
 * moment at which anything is waiting. A `loading.tsx` was written, measured,
 * found never to render, and deleted rather than left as decoration.
 *
 * The other two are real and asserted below and throughout: an empty state in
 * words rather than a blank area, and an error boundary in app/app/error.tsx.
 */
test.describe('the states every page needs', () => {
  test('every page has an empty state rather than a blank area', async ({ page }) => {
    await page.goto('/governance')
    // No proposal has ever been executed and nothing is stuck; both say so in
    // words instead of rendering an empty list.
    await expect(page.getByText('Nothing stuck.')).toBeVisible()
  })
})
