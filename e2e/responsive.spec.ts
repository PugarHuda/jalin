import { expect, test } from '@playwright/test'

/**
 * Nothing may scroll sideways. This caught three separate causes once — a grid
 * child with min-width auto, a flex row that would not wrap, and an unbreakable
 * 66-character hex string — none of which were visible at desktop width.
 */
for (const path of ['/', '/compose', '/verify', '/governance']) {
  test(`${path} does not scroll sideways on a phone`, async ({ page }) => {
    await page.goto(path)
    await page.waitForLoadState('networkidle')

    const width = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }))
    expect(width.scroll - width.client).toBeLessThanOrEqual(1)
  })

  test(`${path} keeps every element inside the viewport`, async ({ page }) => {
    await page.goto(path)
    await page.waitForLoadState('networkidle')

    const strays = await page.evaluate(() => {
      const width = document.documentElement.clientWidth
      return [...document.querySelectorAll('body *')]
        .filter((el) => el.getBoundingClientRect().right > width + 1)
        .map((el) => `${el.tagName}.${String(el.className).slice(0, 40)}`)
        .slice(0, 5)
    })
    expect(strays).toEqual([])
  })
}

test('the composer is usable on a phone', async ({ page }) => {
  await page.goto('/compose')
  await page.getByRole('button', { name: 'Stake on Endur' }).click()

  await expect(page.getByLabel('Input amount')).toBeVisible()
  await expect(page.getByRole('button', { name: /^shield · / })).toBeVisible()
})
