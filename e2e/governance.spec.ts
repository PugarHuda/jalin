import { expect, test } from '@playwright/test'

const ROUTER = '0x008498d79ca390b34a6416cc45fb375ad9b921eefd8d4531d99a2d775feb3a7e'

test.describe('governance', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/governance')
  })

  test('shows the parameters the router is actually running on', async ({ page }) => {
    // Read from the governor, not from a config file — so the page has to agree
    // with what the contract answers.
    await expect(page.getByText('max steps', { exact: true })).toBeVisible()
    await expect(page.getByText('max calldata', { exact: true })).toBeVisible()
    await expect(page.locator('main')).toContainText(/\d+ bps/)
    await expect(page.locator('main')).toContainText(/paused/)
  })

  test('lists the proposal that exists on chain', async ({ page }) => {
    // Proposal 1 is a real LABEL proposal made at block 13,771,935.
    await expect(page.getByText('#1 · label')).toBeVisible()
    await expect(page.locator('main')).toContainText('JALIN_ROUTER')
  })

  test('says why a proposal cannot execute rather than only that it cannot', async ({ page }) => {
    await expect(page.getByText(/rejected · nobody voted/)).toBeVisible()
  })

  test('admits the one parameter it cannot show', async ({ page }) => {
    // Quorum has no view on the governor. Saying so is better than omitting it.
    await expect(page.locator('main')).toContainText(/Quorum cannot be shown/)
  })

  test('the voting window and timelock are measured, not asserted', async ({ page }) => {
    await expect(page.getByText('voting window', { exact: true })).toBeVisible()
    await expect(page.getByText('timelock', { exact: true })).toBeVisible()
    await expect(page.locator('main')).toContainText(/measured, not configured here/)
  })

  test('builds a real propose call and shows it before signing', async ({ page }) => {
    await page.getByText('the exact call this would send').click()

    const call = page.locator('pre')
    await expect(call).toContainText('entry_point_selector')
    // 0x4 is LABEL, the default tab, and the target defaults to our router.
    await expect(call).toContainText(ROUTER.replace(/^0x0*/, '').slice(0, 20))
  })

  test('a target that is not a felt is refused instead of encoded', async ({ page }) => {
    await page.getByLabel('target', { exact: true }).fill('not-a-felt')

    await expect(page.locator('main')).toContainText('target must be a felt')
    await expect(page.getByRole('button', { name: 'Sign and propose' })).toBeDisabled()
  })

  test('a numeric field refuses text', async ({ page }) => {
    await page.getByRole('button', { name: 'fee', exact: true }).click()
    await page.getByLabel('fee in bps').fill('lots')

    await expect(page.locator('main')).toContainText(/is not a whole number/)
    await expect(page.getByRole('button', { name: 'Sign and propose' })).toBeDisabled()
  })

  test('the limits kind asks for both bounds', async ({ page }) => {
    await page.getByRole('button', { name: 'limits', exact: true }).click()

    await expect(page.getByLabel('max steps')).toBeVisible()
    await expect(page.getByLabel('max calldata')).toBeVisible()
  })

  test('renders without a console error', async ({ page }) => {
    const errors: string[] = []
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text())
    })
    page.on('pageerror', (e) => errors.push(String(e)))

    await page.reload({ waitUntil: 'networkidle' })
    await page.getByRole('button', { name: 'deny', exact: true }).click()
    expect(errors).toEqual([])
  })
})
