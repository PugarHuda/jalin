import { expect, test } from '@playwright/test'

/**
 * Contrast, computed rather than guessed.
 *
 * axe cannot judge this page's contrast. The content sits over `.warp`, a fixed
 * decorative layer of masked gradient stripes, and axe answers "cannot tell"
 * for text whose background it cannot resolve to one opaque colour — locally as
 * `incomplete`, and on a Linux runner as a violation. Neither answer is a
 * measurement, so `color-contrast` is turned off in the axe run and replaced by
 * this: the palette read out of the live page, and every pair that actually
 * occurs put through the WCAG formula, including the worst case where a warp
 * stripe falls behind small text.
 */

const AA_NORMAL = 4.5
const AA_LARGE = 3

type Rgb = [number, number, number]

function parse(colour: string): Rgb {
  const hex = colour.trim().replace('#', '')
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as Rgb
}

function luminance([r, g, b]: Rgb): number {
  const [rl, gl, bl] = [r, g, b].map((v) => {
    const channel = v / 255
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * rl! + 0.7152 * gl! + 0.0722 * bl!
}

function contrast(foreground: Rgb, background: Rgb): number {
  const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a)
  return (light! + 0.05) / (dark! + 0.05)
}

/** `over` at `alpha` composited on `under`, which is what a warp stripe is. */
function blend(over: Rgb, under: Rgb, alpha: number): Rgb {
  return over.map((v, i) => Math.round(v * alpha + under[i]! * (1 - alpha))) as Rgb
}

test('every colour pair on the page meets WCAG AA', async ({ page }) => {
  await page.goto('/')

  // Read the tokens off the live document, so this measures the palette that
  // shipped rather than a copy of it that can drift.
  const tokens = await page.evaluate(() => {
    const style = getComputedStyle(document.documentElement)
    const read = (name: string) => style.getPropertyValue(name).trim()
    return {
      ground: read('--ground'),
      raised: read('--raised'),
      thread: read('--thread'),
      cloth: read('--cloth'),
      muted: read('--muted'),
      gold: read('--gold'),
      hidden: read('--hidden'),
    }
  })

  for (const [name, value] of Object.entries(tokens)) {
    expect(value, `--${name} is defined`).toMatch(/^#[0-9a-fA-F]{3,8}$/)
  }

  const c = Object.fromEntries(
    Object.entries(tokens).map(([name, value]) => [name, parse(value)]),
  ) as Record<keyof typeof tokens, Rgb>

  // The warp is `color-mix(in srgb, var(--thread) 55%, transparent)` over the
  // ground, and it is the darkest thing text ever lands on.
  const stripe = blend(c.thread, c.ground, 0.55)

  const failures: string[] = []
  const check = (fg: keyof typeof tokens, bg: string, colour: Rgb, floor: number) => {
    const ratio = contrast(c[fg], colour)
    if (ratio < floor) failures.push(`${fg} on ${bg}: ${ratio.toFixed(2)}, needs ${floor}`)
  }

  for (const background of [
    ['ground', c.ground],
    ['raised', c.raised],
    ['warp stripe', stripe],
  ] as const) {
    for (const foreground of ['cloth', 'muted', 'gold', 'hidden'] as const) {
      check(foreground, background[0], background[1], AA_NORMAL)
    }
  }

  // The one inverted pair: the call to action is the ground colour on gold.
  const onGold = contrast(c.ground, c.gold)
  if (onGold < AA_NORMAL) failures.push(`ground on gold: ${onGold.toFixed(2)}`)

  expect(failures).toEqual([])
})

/**
 * WCAG 1.4.11. A control's own boundary is a UI component: if the border is
 * what tells you where the text field is, it has to be visible. This reads the
 * borders the browser actually computed rather than asserting a token, so
 * putting a control back on the decorative `--thread` fails here.
 */
for (const path of ['/', '/compose', '/verify']) {
  test(`${path} draws every control's edge visibly`, async ({ page }) => {
    await page.goto(path)
    await page.waitForLoadState('networkidle')

    const borders = await page.evaluate(() =>
      [...document.querySelectorAll('input, select, textarea, button')]
        .filter((el) => {
          const style = getComputedStyle(el)
          return style.borderTopWidth !== '0px' && style.borderTopStyle !== 'none'
        })
        .map((el) => {
          const style = getComputedStyle(el)
          // Walk up for the nearest painted background; the page ground is the
          // last resort because everything sits on it.
          let node: HTMLElement | null = el as HTMLElement
          let behind = 'rgb(0, 0, 0)'
          while (node) {
            const bg = getComputedStyle(node).backgroundColor
            if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
              behind = bg
              break
            }
            node = node.parentElement
          }
          return {
            what: `${el.tagName.toLowerCase()} ${(el.textContent ?? '').trim().slice(0, 24)}`,
            border: style.borderTopColor,
            behind,
          }
        }),
    )

    const rgb = (value: string) =>
      value.match(/\d+/g)!.slice(0, 3).map(Number) as [number, number, number]

    const tooFaint = borders
      .map((b) => ({ ...b, ratio: contrast(rgb(b.border), rgb(b.behind)) }))
      .filter((b) => b.ratio < AA_LARGE)
      .map((b) => `${b.what}: ${b.ratio.toFixed(2)}`)

    expect(tooFaint).toEqual([])
  })
}
