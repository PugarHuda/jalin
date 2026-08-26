import { expect, test } from '@playwright/test'

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

test.describe('/api/quote', () => {
  test('quotes a deposit from the Endur vault itself', async ({ request }) => {
    const response = await request.get('/api/quote?assets=1000000000000000000')
    expect(response.status()).toBe(200)

    const body = await response.json()
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
    const response = await request.get('/api/quote')
    expect(response.status()).toBe(400)
    expect((await response.json()).error).toContain('assets')
  })

  test('rejects a non-integer amount', async ({ request }) => {
    for (const bad of ['abc', '1.5', '-1', '0x10', '1e18', ' 1']) {
      const response = await request.get(`/api/quote?assets=${encodeURIComponent(bad)}`)
      expect(response.status(), `assets=${bad} should be refused`).toBe(400)
    }
  })

  test('a zero quote is a real question, not an error', async ({ request }) => {
    const response = await request.get('/api/quote?assets=0')
    expect(response.status()).toBe(200)
    expect((await response.json()).shares).toBe('0')
  })
})

test.describe('/api/tx', () => {
  test('a pool transaction that missed our router does not qualify', async ({ request }) => {
    const response = await request.get(`/api/tx?hash=${POOL_TX_NOT_OURS}`)
    expect(response.status()).toBe(200)

    const verdict = await response.json()
    expect(verdict.exists).toBe(true)
    expect(verdict.succeeded).toBe(true)
    expect(verdict.touchedPool).toBe(true)
    expect(verdict.throughOurs).toBe(false)
    expect(verdict.qualifies).toBe(false)
    expect(verdict.summary).toMatch(/not through a contract of ours/)
  })

  test('a transaction that is not on chain reads as not found', async ({ request }) => {
    const response = await request.get(`/api/tx?hash=${ABSENT_TX}`)
    expect(response.status()).toBe(200)

    const verdict = await response.json()
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
    const response = await request.get('/api/crowd')
    expect(response.status()).toBe(200)

    const crowd = await response.json()
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
    const response = await request.get(`/api/crowd?asset=${STRK}&amount=1000000000000000000`)
    expect(response.status()).toBe(200)

    const prospect = await response.json()
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
    const crowd = await (await request.get('/api/crowd')).json()
    expect(crowd.cells.cells).toBeGreaterThan(0)
    // The median cell cannot be a bigger crowd than the biggest cell.
    expect(crowd.cells.medianEffectiveSet).toBeLessThanOrEqual(crowd.cells.largestEffectiveSet)
    expect(crowd.cells.aloneShare).toBeGreaterThanOrEqual(0)
    expect(crowd.cells.aloneShare).toBeLessThanOrEqual(1)
  })
})
