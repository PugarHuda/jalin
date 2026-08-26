import { expect, test } from '@playwright/test'

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
    const crowd = await (await page.request.get('/api/crowd')).json()
    await expect(page.locator('body')).toContainText(String(crowd.depositors))
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

    await page.goto('/', { waitUntil: 'networkidle' })
    expect(errors).toEqual([])
  })

  test('an unknown path is a 404, not a crash', async ({ page }) => {
    const response = await page.goto('/does-not-exist')
    expect(response?.status()).toBe(404)
  })
})
