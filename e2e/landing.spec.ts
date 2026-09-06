import { expect, test } from '@playwright/test'
import { json, type CrowdResponse } from './api-types'
import { isCancelledSameOrigin, settled } from './settled'

test.describe('landing', () => {
  test('states the thesis and names the pool it plugs into', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' })

    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page.locator('body')).toContainText('invoke')
    await expect(page.locator('body')).toContainText('STRK20')
  })

  test('shows chain state read at request time, not a hardcoded number', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' })

    // Whatever the page prints for the crowd has to agree with the route that
    // reads it. If someone replaces the reading with a nice-looking constant,
    // these two stop matching and this fails.
    const crowd = await json<CrowdResponse>(await page.request.get('/api/crowd'))
    await expect(page.locator('body')).toContainText(String(crowd.depositors))
  })

  test('does not claim a bigger crowd than the pool has', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' })

    const crowd = await json<CrowdResponse>(await page.request.get('/api/crowd'))
    // The honest number has to be on the page next to the flattering one.
    await expect(page.locator('body')).toContainText(
      crowd.cells.medianEffectiveSet.toFixed(2),
    )
    await expect(page.locator('body')).toContainText('hides in')
  })

  test('carries chain state rather than an empty shell', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' })

    // The whole block is conditional on the chain being reachable, so its
    // absence is how a page that failed to read looks - and it looks fine.
    await expect(page.getByText('plans executed, read from the router')).toBeVisible()
    await expect(page.getByText('governance proposals, read from the governor')).toBeVisible()
  })

  test('leads to the composer', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await page.getByRole('link', { name: /compose|open|try|composer/i }).first().click()
    await expect(page).toHaveURL(/\/compose/)
    await expect(page.getByRole('heading', { name: 'Composer' })).toBeVisible()
  })

  test('renders without a console error', async ({ page }) => {
    const errors: string[] = []
    page.on('console', (message) => {
      if (message.type() === 'error' && !isCancelledSameOrigin(message.text()))
        errors.push(message.text())
    })
    page.on('pageerror', (error) => {
      const text = String(error)
      if (!isCancelledSameOrigin(text)) errors.push(text)
    })

    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await settled(page)
    expect(errors).toEqual([])
  })

  test('an unknown path is a 404, not a crash', async ({ page }) => {
    const response = await page.goto('/does-not-exist', { waitUntil: 'domcontentloaded' })
    expect(response?.status()).toBe(404)
  })
})

test('navigation between pages does not reload the document', async ({ page }) => {
  // Every internal link is a client navigation. An <a> here would work and would
  // also throw away the React tree and re-download the page on each hop.
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await page.evaluate(() => {
    ;(window as unknown as { __kept: boolean }).__kept = true
  })

  await page.getByRole('link', { name: 'composer' }).first().click()
  await expect(page).toHaveURL(/\/compose/)
  await page.getByRole('link', { name: 'governance' }).first().click()
  await expect(page).toHaveURL(/\/governance/)

  const survived = await page.evaluate(
    () => (window as unknown as { __kept?: boolean }).__kept === true,
  )
  expect(survived, 'the document was replaced, so these were full page loads').toBe(true)
})

test('the trend plots time, not sample order', async ({ page, request }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await settled(page)

  const xs = await page.evaluate(() => {
    const path = document.querySelector('figure svg path')
    if (!path) return null
    return (path.getAttribute('d') ?? '')
      .split(/[ML]\s*/)
      .filter(Boolean)
      .map((pair) => Number(pair.trim().split(/\s+/)[0]))
  })

  expect(xs, 'the chart should be on the page').not.toBeNull()
  expect(xs!.length).toBeGreaterThan(3)

  /**
   * Each point sits where its block says, not where its turn says.
   *
   * This used to assert that the gaps were uneven, on the reasoning that two
   * windows in forty-four had no deposits. That is a fact about the pool on one
   * afternoon, not about the chart: measure the cell width from the chain and
   * the quiet windows can fall differently, and a run where every window
   * happens to be occupied failed a chart that was drawing exactly what it
   * should. The property is that x is a function of `fromBlock`, and it holds
   * whether or not the data has holes.
   */
  const { periods } = await json<CrowdResponse & { periods: { fromBlock: number }[] }>(
    await request.get('/api/crowd'),
  )
  test.skip(periods.length !== xs!.length, 'the page and this read saw different windows')

  const blockSpan = periods[periods.length - 1]!.fromBlock - periods[0]!.fromBlock
  const pixelSpan = xs![xs!.length - 1]! - xs![0]!
  test.skip(blockSpan === 0 || pixelSpan === 0, 'a single window has nothing to scale')

  for (const [index, period] of periods.entries()) {
    const expected =
      xs![0]! + ((period.fromBlock - periods[0]!.fromBlock) / blockSpan) * pixelSpan
    // A point placed by its index rather than its block would be off by a whole
    // gap wherever a window is missing; half a percent of the width is far
    // tighter than that and loose enough for rounding in the path data.
    expect(Math.abs(xs![index]! - expected), `point ${index}`).toBeLessThan(
      Math.abs(pixelSpan) * 0.005 + 0.5,
    )
  }
})
