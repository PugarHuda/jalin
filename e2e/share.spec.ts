import { expect, test } from '@playwright/test'
import { settled } from './settled'

const ENDUR = '0x28d709c875c0ceac3dce7065bec5328186dc89fe254527084d1689910954b0a'

test.describe('a plan as a link', () => {
  test('a shared link reopens the plan it encoded', async ({ page, context }) => {
    await page.goto('/compose')
    await settled(page)

    // Change the plan away from the default, so the link is carrying something
    // the destination could not have guessed.
    await page.getByLabel('Input amount').fill('0.0777')
    await page.getByLabel('Step 1 target').fill(ENDUR)
    await page.getByRole('button', { name: 'copy as a link' }).click()

    // Read off the page rather than out of the clipboard. Playwright can only
    // grant clipboard permission on Chromium, and the URL a person can see and
    // copy by hand is the thing worth asserting anyway.
    // The URL is shown whether or not the clipboard accepted it, which is the
    // point: WebKit and Firefox refuse the write here and a person still needs
    // the link.
    const link = await page.locator('p.select-all').innerText()
    expect(link).toContain('/compose?plan=')

    // Open it as a stranger would: a fresh page, nothing but the URL.
    const fresh = await context.newPage()
    await fresh.goto(link)
    await settled(fresh)

    await expect(fresh.getByLabel('Input amount')).toHaveValue('0.0777')
    await expect(fresh.getByLabel('Step 1 target')).toHaveValue(ENDUR)
    await fresh.close()
  })

  test('says whether the clipboard actually took it', async ({ page }) => {
    await page.goto('/compose')
    await settled(page)
    await page.getByRole('button', { name: 'copy as a link' }).click()

    // One of the two, never both, and never "copied" when it was refused.
    const label = await page.getByText(/^(copied ·|the clipboard was refused)/).innerText()
    expect(label).toMatch(/^copied ·$|^the clipboard was refused/)
    await expect(page.locator('p.select-all')).toContainText('/compose?plan=')
  })

  test('a damaged link opens the composer rather than an error', async ({ page }) => {
    // Chat clients truncate. A person who loses the last characters should get
    // a working composer, not a stack trace.
    await page.goto('/compose?plan=this-is-not-a-plan')
    await settled(page)

    await expect(page.getByRole('heading', { name: 'Composer' })).toBeVisible()
    await expect(page.getByLabel('Input amount')).toHaveValue('0.25')
  })

  test('an empty plan parameter is ignored', async ({ page }) => {
    await page.goto('/compose?plan=')
    await settled(page)
    await expect(page.getByLabel('Input amount')).toHaveValue('0.25')
  })

  test('the link survives a reload, because it is the whole state', async ({ page }) => {
    await page.goto('/compose')
    await settled(page)
    await page.getByLabel('Input amount').fill('1.5')
    await page.getByRole('button', { name: 'copy as a link' }).click()

    const link = await page.locator('p.select-all').innerText()
    await page.goto(link)
    await settled(page)
    await page.reload()
    await settled(page)

    await expect(page.getByLabel('Input amount')).toHaveValue('1.5')
  })
})
