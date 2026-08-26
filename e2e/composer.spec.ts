import { expect, test } from '@playwright/test'

const ENDUR_VAULT = '0x28d709c875c0ceac3dce7065bec5328186dc89fe254527084d1689910954b0a'

test.describe('composer', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/compose')
  })

  test('a preset loads real mainnet addresses, not example ones', async ({ page }) => {
    await page.getByRole('button', { name: 'Stake on Endur' }).click()

    // The vault the plan deposits into has to be the one that exists on chain.
    // A preset that looks right and points at 0xdead is worse than no preset.
    await page.getByRole('button', { name: 'calldata', exact: true }).click()
    await expect(page.locator('pre')).toContainText(ENDUR_VAULT.slice(2, 20))
  })

  test('submitting is refused while a step has no target', async ({ page }) => {
    await page.getByRole('button', { name: 'Stake on Endur' }).click()
    await page.getByRole('button', { name: '+ step' }).click()

    const submit = page.getByRole('button', { name: /Sign and submit|Check wallet support/ })
    await expect(submit).toBeDisabled()
    await expect(page.locator('main')).toContainText('no target yet')
  })

  test('filling in the target enables submitting', async ({ page }) => {
    await page.getByRole('button', { name: 'Stake on Endur' }).click()
    await page.getByLabel('Step 1 target').fill(ENDUR_VAULT)

    const submit = page.getByRole('button', { name: /Sign and submit|Check wallet support/ })
    await expect(submit).toBeEnabled()
  })

  test('an unparseable target is reported instead of silently encoded', async ({ page }) => {
    await page.getByRole('button', { name: 'Stake on Endur' }).click()
    await page.getByLabel('Step 1 target').fill('not-an-address')

    // The failure has to arrive here, not at the wallet. A plan carrying
    // nonsense that still offers a submit button is the worst of both.
    await expect(page.locator('main')).toContainText('not a felt')
    await expect(page.getByRole('button', { name: /Sign and submit/ })).toBeDisabled()
  })

  test('the disclosure panel separates what is hidden from what is public', async ({ page }) => {
    await page.getByRole('button', { name: 'Stake on Endur' }).click()

    await expect(page.getByText('Hidden', { exact: true })).toBeVisible()
    await expect(page.locator('main')).toContainText(/public|revealed|visible/i)
  })

  test('the three tabs each show something different', async ({ page }) => {
    await page.getByRole('button', { name: 'Stake on Endur' }).click()

    const seen: string[] = []
    for (const tab of ['What this reveals', 'calldata', 'actions'] as const) {
      await page.getByRole('button', { name: tab, exact: true }).click()
      seen.push(await page.locator('main').innerText())
    }
    expect(new Set(seen).size).toBe(3)
  })

  test('says how big the crowd for this exact deposit would be', async ({ page }) => {
    await page.getByRole('button', { name: 'Stake on Endur' }).click()

    // Measured against the chain for the amount in the box, not a pool-wide
    // headcount dressed up as an anonymity set.
    const panel = page.getByText('The crowd you would land in')
    await expect(panel).toBeVisible({ timeout: 20_000 })
    await expect(page.locator('main')).toContainText(/effective anonymity set would be \d+\.\d\d/)
  })

  test('changing the amount asks the question again', async ({ page }) => {
    await page.getByRole('button', { name: 'Stake on Endur' }).click()
    await expect(page.getByText('The crowd you would land in')).toBeVisible({ timeout: 20_000 })

    await page.getByLabel('Input amount').fill('98765')
    // Still answered, and still about the amount that is in the box now.
    await expect(page.locator('main')).toContainText(/effective anonymity set would be/, {
      timeout: 20_000,
    })
  })

  test('the mainnet run quotes the vault live', async ({ page }) => {
    // The floor under the Endur run comes from preview_deposit, not a constant.
    const quote = page.getByText(/vault quotes/)
    await expect(quote).toBeVisible()

    const shares = Number((await quote.innerText()).match(/quotes ([\d.]+) xSTRK/)?.[1])
    expect(shares).toBeGreaterThan(0)
  })

  test('the run buttons are live because the router is deployed', async ({ page }) => {
    await expect(page.getByRole('button', { name: /^shield · / })).toBeEnabled()

    const runs = page.getByRole('button', { name: /^run · / })
    await expect(runs).toHaveCount(3)
    for (let i = 0; i < 3; i += 1) await expect(runs.nth(i)).toBeEnabled()
  })

  test('adding an output extends the plan', async ({ page }) => {
    await page.getByRole('button', { name: 'Stake on Endur' }).click()

    const outputs = page.getByLabel(/Output \d+ minimum amount/)
    const before = await outputs.count()
    await page.getByRole('button', { name: '+ output' }).click()
    await expect(outputs).toHaveCount(before + 1)
  })

  test('renders without a console error', async ({ page }) => {
    const errors: string[] = []
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text())
    })
    page.on('pageerror', (e) => errors.push(String(e)))

    await page.reload({ waitUntil: 'networkidle' })
    await page.getByRole('button', { name: 'Two deposits, one invoke' }).click()
    expect(errors).toEqual([])
  })
})

test.describe('without a wallet installed', () => {
  test('says so instead of throwing', async ({ page }) => {
    // No extension is injected in this browser, which is exactly what a judge
    // opening the link on a fresh profile will have.
    const crashes: string[] = []
    page.on('pageerror', (e) => crashes.push(String(e)))

    await page.goto('/compose')
    await page.getByRole('button', { name: /^shield · / }).click()

    await expect(page.locator('main')).toContainText(/wallet/i, { timeout: 15_000 })
    expect(crashes).toEqual([])
  })
})
