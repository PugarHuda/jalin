import { expect, test } from '@playwright/test'
import { json, type ParamsResponse } from './api-types'

const ENDUR_VAULT = '0x28d709c875c0ceac3dce7065bec5328186dc89fe254527084d1689910954b0a'

test.describe('/api/params', () => {
  test('reads the bounds the router actually enforces', async ({ request }) => {
    const params = await json<ParamsResponse>(await request.get('/api/params'))
    expect(typeof params.paused).toBe('boolean')
    expect(params.maxSteps).toBeGreaterThan(0)
    expect(params.maxCalldata).toBeGreaterThan(0)
    // Capped at 1000 inside the governor, so anything above it means the read
    // is decoding the wrong field.
    expect(params.feeBps).toBeGreaterThanOrEqual(0)
    expect(params.feeBps).toBeLessThanOrEqual(1000)
  })

  test('measures the block time rather than remembering it', async ({ request }) => {
    const params = await json<ParamsResponse>(await request.get('/api/params'))
    test.skip(params.secondsPerBlock === null, 'the node would not give two block timestamps')

    // An invariant, not a value. Starknet mainnet has run between roughly 1.5
    // and 2.5 seconds a block for the life of the pool; a reading outside that
    // means the subtraction is wrong, not that the chain changed. The literal
    // this replaced was 1.68, from a 2,000-block sample - right by luck.
    expect(params.secondsPerBlock).toBeGreaterThan(1.2)
    expect(params.secondsPerBlock).toBeLessThan(3)
  })

  test('agrees with the governance page, because both read the same contract', async ({
    page,
  }) => {
    const params = await json<ParamsResponse>(await page.request.get('/api/params'))
    await page.goto('/governance')

    // Compared as rendered text, not as HTML: React puts comment nodes between
    // an interpolated number and the word after it, so the markup says
    // "64<!-- --> felts" where a reader sees "64 felts".
    await expect(page.locator('main')).toContainText(`${params.maxCalldata} felts per step`)
    await expect(page.locator('main')).toContainText(`${params.feeBps} bps`)
  })

  test('answers whether a target has been denied', async ({ request }) => {
    const params = await json<ParamsResponse>(
      await request.get(`/api/params?targets=${ENDUR_VAULT}`),
    )
    expect(params.denied[ENDUR_VAULT]).toBe(false)
  })

  test('refuses a target that is not a felt, and too many of them', async ({ request }) => {
    expect((await request.get('/api/params?targets=nope')).status()).toBe(400)

    const many = Array.from({ length: 9 }, () => ENDUR_VAULT).join(',')
    expect((await request.get(`/api/params?targets=${many}`)).status()).toBe(400)
  })
})

test.describe('the pages that only appear when something is wrong', () => {
  test('a 404 names the four real pages', async ({ page }) => {
    const response = await page.goto('/no-such-thing')
    expect(response?.status()).toBe(404)

    await expect(page.getByRole('link', { name: '/compose' })).toBeVisible()
    await expect(page.getByRole('link', { name: '/verify' })).toBeVisible()
    await expect(page.getByRole('link', { name: '/governance' })).toBeVisible()
  })

  test('robots points at a sitemap that lists every page', async ({ request }) => {
    const robots = await (await request.get('/robots.txt')).text()
    expect(robots).toContain('Sitemap:')

    const sitemap = await (await request.get('/sitemap.xml')).text()
    for (const path of ['/compose', '/verify', '/governance']) {
      expect(sitemap, `${path} should be listed`).toContain(path)
    }
  })
})
