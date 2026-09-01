import { expect, test } from '@playwright/test'
import { settled } from './settled'

const ROUTER = '0x008498d79ca390b34a6416cc45fb375ad9b921eefd8d4531d99a2d775feb3a7e'

test.describe('governance', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/governance')
    await settled(page)
  })

  test('is not serving the failure fallback', async ({ page }) => {
    // This page once shipped "could not be read" as its prerendered HTML: a
    // blanket catch swallowed Next's dynamic-usage signal, so the route was
    // built static with the failure branch baked in.
    await expect(page.locator('main')).not.toContainText('could not be read')
    await expect(page.getByText('What the router is running on')).toBeVisible()
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

    /**
     * The Wallet API's `Call` is `{ contract_address, entry_point, calldata }`,
     * and `entry_point` holds the entrypoint's name. `entry_point_selector` is
     * the JSON-RPC spelling: correct in `lib/rpc`, refused here with
     * INVALID_REQUEST_PAYLOAD and no `data` to say which field was wrong.
     *
     * This test used to assert the RPC spelling, which made it a guarantee that
     * the payload stayed the one the wallet rejects. Both halves are asserted
     * now, because being right about the new name does not stop the old one
     * coming back beside it.
     */
    await expect(call).toContainText('"entry_point": "propose"')
    await expect(call).not.toContainText('entry_point_selector')

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

    await page.reload()
    await settled(page)
    await page.getByRole('button', { name: 'deny', exact: true }).click()
    expect(errors).toEqual([])
  })
})

test('offers no execute button for a proposal that cannot execute', async ({ page }) => {
  await page.goto('/governance')

  /**
   * A rejected proposal has nothing to execute, so its own card offers no
   * button.
   *
   * Scoped to the card rather than the page, and this used to be neither: it
   * asserted one `rejected · nobody voted` on the whole document and zero
   * Execute buttons anywhere. Both broke the day a second proposal was made
   * - two matches is a strict-mode violation, and a *different* proposal
   * becoming executable would have failed this for a reason it is not about.
   */
  const rejected = page.locator('li', { hasText: /rejected · nobody voted/ }).first()
  await expect(rejected).toBeVisible()
  await expect(rejected.getByRole('button', { name: /^Execute #/ })).toHaveCount(0)
})

test.describe('stuck balances', () => {
  test('reports nothing stuck, and says what it checked', async ({ page }) => {
    await page.goto('/governance')

    // The router holds nothing today. The claim has to name its own blind spot:
    // a contract cannot enumerate its own balances, so this covers only the
    // tokens the app knows.
    await expect(page.getByText('Nothing stuck.')).toBeVisible()
    await expect(page.locator('main')).toContainText(/tokens this app knows/)
    await expect(page.getByRole('button', { name: /^Sweep / })).toHaveCount(0)
  })

  test('explains why sweeping is safe to leave open to anyone', async ({ page }) => {
    await page.goto('/governance')
    await settled(page)
    await expect(page.locator('main')).toContainText(/anyone may call it/i)
    await expect(page.locator('main')).toContainText(/never profitable|not profitable/i)
  })
})
