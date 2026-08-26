import { expect, test } from '@playwright/test'
import { json, type CrowdResponse } from './api-types'
import { settled } from './settled'

test.describe('landing', () => {
  test('states the thesis and names the pool it plugs into', async ({ page }) => {
    await page.goto('/')

    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page.locator('body')).toContainText('invoke')
    await expect(page.locator('body')).toContainText('STRK20')
  })

  test('shows chain state read at request time, not a hardcoded number', async ({ page }) => {
    await page.goto('/')

    // Whatever the page prints for the crowd has to agree with the route that
    // reads it. If someone replaces the reading with a nice-looking constant,
    // these two stop matching and this fails.
    const crowd = await json<CrowdResponse>(await page.request.get('/api/crowd'))
    await expect(page.locator('body')).toContainText(String(crowd.depositors))
  })

  test('does not claim a bigger crowd than the pool has', async ({ page }) => {
    await page.goto('/')

    const crowd = await json<CrowdResponse>(await page.request.get('/api/crowd'))
    // The honest number has to be on the page next to the flattering one.
    await expect(page.locator('body')).toContainText(
      crowd.cells.medianEffectiveSet.toFixed(2),
    )
    await expect(page.locator('body')).toContainText('hides in')
  })

  test('carries chain state rather than an empty shell', async ({ page }) => {
    await page.goto('/')

    // The whole block is conditional on the chain being reachable, so its
    // absence is how a page that failed to read looks - and it looks fine.
    await expect(page.getByText('plans executed, read from the router')).toBeVisible()
    await expect(page.getByText('governance proposals, read from the governor')).toBeVisible()
  })

  test('leads to the composer', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('link', { name: /compose|open|try|composer/i }).first().click()
    await expect(page).toHaveURL(/\/compose/)
    await expect(page.getByRole('heading', { name: 'Composer' })).toBeVisible()
  })

  test('renders without a console error', async ({ page }) => {
    const errors: string[] = []
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text())
    })
    page.on('pageerror', (error) => errors.push(String(error)))

    await page.goto('/')
    await settled(page)
    expect(errors).toEqual([])
  })

  test('an unknown path is a 404, not a crash', async ({ page }) => {
    const response = await page.goto('/does-not-exist')
    expect(response?.status()).toBe(404)
  })
})

test('navigation between pages does not reload the document', async ({ page }) => {
  // Every internal link is a client navigation. An <a> here would work and would
  // also throw away the React tree and re-download the page on each hop.
  await page.goto('/')
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

test('the trend plots time, not sample order', async ({ page }) => {
  await page.goto('/')
  await settled(page)

  // Windows with no deposits are absent from the series. Spacing points evenly
  // would draw those quiet stretches as if no time passed - the one thing a
  // chart about a trend over time must not do.
  const spacing = await page.evaluate(() => {
    const path = document.querySelector('figure svg path')
    if (!path) return null

    const xs = (path.getAttribute('d') ?? '')
      .split(/[ML]\s*/)
      .filter(Boolean)
      .map((pair) => Number(pair.trim().split(/\s+/)[0]))

    const gaps = xs.slice(1).map((value, i) => Number((value - xs[i]!).toFixed(1)))
    return { points: xs.length, distinct: new Set(gaps).size }
  })

  expect(spacing, 'the chart should be on the page').not.toBeNull()
  expect(spacing!.points).toBeGreaterThan(3)
  // Evenly spaced points would give exactly one distinct gap. Real data has
  // two missing windows in forty-four, so there is more than one.
  expect(spacing!.distinct).toBeGreaterThan(1)
})
