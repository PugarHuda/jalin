import { expect, type Page } from '@playwright/test'

/**
 * Waits for a page to be usable, without waiting for the network to go quiet.
 *
 * `networkidle` is a timer, not a condition: it resolves when nothing has been
 * requested for half a second. These pages debounce three separate background
 * reads, so on a slow runner there is always something in flight and the wait
 * runs to the test timeout instead. It failed in CI for exactly that reason,
 * having passed locally, which is the signature of the heuristic rather than a
 * bug in the page.
 *
 * The heading is the honest condition. Every page here renders exactly one h1,
 * and it renders on the server, so its presence means the document is parsed
 * and hydrating rather than that some arbitrary quiet period has elapsed.
 */
export async function settled(page: Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

  // And interactive. A controlled input discards anything typed before React
  // takes over, so filling a form before this resolves is a race the test loses
  // silently - the value lands in the DOM, hydration wipes it, and the button
  // that watches React state never enables.
  await page.waitForFunction(() => document.documentElement.dataset.hydrated === 'true')
}
