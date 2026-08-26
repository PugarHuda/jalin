import { expect, test } from '@playwright/test'

for (const path of ['/', '/compose']) {
  test(`${path} shows where the keyboard is`, async ({ page }) => {
    await page.goto(path)
    await page.keyboard.press('Tab')

    const focused = page.locator(':focus')
    await expect(focused).toBeVisible()

    // A focus ring you cannot see is the same as no focus ring. The browser
    // default counts; what fails here is `outline: none` with nothing put back.
    const ring = await focused.evaluate((el) => {
      const style = getComputedStyle(el)
      return {
        outline: style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0,
        shadow: style.boxShadow !== 'none',
      }
    })
    expect(ring.outline || ring.shadow).toBe(true)
  })

  test(`${path} has one h1 and no skipped heading levels`, async ({ page }) => {
    await page.goto(path)

    const levels = await page.evaluate(() =>
      [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].map((h) => Number(h.tagName[1])),
    )
    expect(levels.filter((level) => level === 1)).toHaveLength(1)

    for (let i = 1; i < levels.length; i += 1) {
      expect(
        levels[i]! - levels[i - 1]!,
        `after h${levels[i - 1]} came h${levels[i]}`,
      ).toBeLessThanOrEqual(1)
    }
  })

  test(`${path} names every control`, async ({ page }) => {
    await page.goto(path)

    const unnamed = await page.evaluate(() =>
      [...document.querySelectorAll('button, input, select, a')]
        .filter((el) => {
          const name =
            el.getAttribute('aria-label') ||
            el.getAttribute('title') ||
            (el as HTMLElement).innerText
          return !name?.trim()
        })
        .map((el) => el.outerHTML.slice(0, 80)),
    )
    expect(unnamed).toEqual([])
  })
}
