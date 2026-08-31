import { expect, test } from '@playwright/test'
import { settled } from './settled'

for (const path of ['/', '/compose', '/verify', '/governance', '/slides']) {
  test(`${path} shows where the keyboard is`, async ({ page }) => {
    await page.goto(path)
    await settled(page)

    /**
     * Driven by real Tab presses, which is the only way this can be true.
     *
     * The rule the page relies on is `:focus-visible`, and `:focus-visible` is
     * defined not to match when script calls `.focus()` - that is the whole
     * point of it existing beside `:focus`. Testing with `.focus()` therefore
     * asks a question the CSS is designed to answer "no" to, and reported the
     * one control that happened to be reached that way as unmarked.
     *
     * Tab visits exactly what a keyboard user visits. WebKit skips links unless
     * full keyboard access is on, so it simply sees fewer elements - and every
     * element it does see is checked.
     */
    const unmarked: string[] = []

    for (let i = 0; i < 12; i += 1) {
      await page.keyboard.press('Tab')

      const result = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null
        if (!el || el === document.body) return null

        const style = getComputedStyle(el)
        const outlined = style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0
        const shadowed = style.boxShadow !== 'none'
        return {
          marked: outlined || shadowed,
          what: `${el.tagName.toLowerCase()} ${(el.textContent ?? '').trim().slice(0, 24)}`,
        }
      })

      if (!result) continue
      if (!result.marked) unmarked.push(result.what)
    }

    expect(unmarked).toEqual([])
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

    // Stricter than axe on purpose: axe accepts a placeholder as a name, and a
    // placeholder disappears the moment you type. Everything else here is the
    // ordinary accessible-name computation - aria-label, aria-labelledby, a
    // wrapping <label>, a <label for>, title, then the element's own text.
    const unnamed = await page.evaluate(() =>
      [...document.querySelectorAll('button, input, select, textarea, a')]
        .filter((el) => {
          const labelledBy = el.getAttribute('aria-labelledby')
          const referenced = labelledBy
            ? labelledBy
                .split(/\s+/)
                .map((id) => document.getElementById(id)?.textContent ?? '')
                .join(' ')
            : ''
          const wrapping = el.closest('label')?.textContent ?? ''
          const bound = el.id
            ? (document.querySelector(`label[for="${el.id}"]`)?.textContent ?? '')
            : ''

          const name =
            el.getAttribute('aria-label') ||
            referenced ||
            wrapping ||
            bound ||
            el.getAttribute('title') ||
            (el as HTMLElement).innerText
          return !name?.trim()
        })
        .map((el) => el.outerHTML.slice(0, 80)),
    )
    expect(unnamed).toEqual([])
  })
}

/**
 * Deque's axe, the same engine behind most accessibility audits. The hand-written
 * checks above encode what this project got wrong before; axe covers the long
 * tail nobody thinks to check — ARIA that contradicts itself, landmarks, form
 * associations, links distinguished only by colour.
 *
 * `color-contrast` is off here and measured in contrast.spec.ts instead. The
 * content sits over `.warp`, a fixed layer of masked gradient stripes, and axe
 * cannot resolve that to one opaque background: it answered `incomplete` on one
 * machine and `violation` on another for the same pixels. Neither is a
 * measurement. The replacement reads the palette off the live page and puts
 * every pair through the WCAG formula, worst case included.
 */
for (const path of ['/', '/compose', '/verify', '/governance', '/slides']) {
  test(`${path} passes axe at WCAG 2.1 AA`, async ({ page }) => {
    // axe injects and walks the whole tree. On a machine running three engines
    // at once that overran the default budget on Firefox, which is a fact about
    // the machine rather than about the page.
    test.slow()

    await page.goto(path)
    await settled(page)

    const { default: AxeBuilder } = await import('@axe-core/playwright')
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .disableRules(['color-contrast'])
      .analyze()

    // Named rather than counted: a number tells you it broke, the list tells you
    // what and where.
    const violations = results.violations.map((v) => ({
      rule: v.id,
      impact: v.impact,
      nodes: v.nodes.map((n) => n.target.join(' ')).slice(0, 3),
    }))
    expect(violations).toEqual([])
  })
}
