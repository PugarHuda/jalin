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
 *
 * `load` is the same mistake one step down, which is why every `goto` in this
 * suite now passes `waitUntil: 'domcontentloaded'` and leaves the waiting to
 * this function. `load` waits for every subresource the document started, so a
 * single chunk request that never finishes holds the navigation open for as
 * long as you let it: Firefox hung there at 60 seconds, then at 120 when the
 * ceiling was raised, then again on a single-worker runner with nothing to
 * compete with - and passed in 1.7 seconds on the retry every time, while the
 * tests either side of it in the same file took 600ms. That is not a page being
 * slow. It is a wait with no relationship to whether the page works.
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

/**
 * A same-origin request WebKit cancelled, which it reports at console.error in
 * the words of a CORS failure: "Fetch API cannot load <our own url> due to
 * access control checks". It is neither CORS nor an error. Two things produce
 * it: the composer aborting in-flight reads because the plan changed under
 * them, which is the behaviour its effects are written to have, and Next
 * cancelling the header's link prefetches when a click interrupts them. A busy
 * `next start` makes the second one common, which is why this arrived as a
 * flake on a two-core runner rather than as a bug.
 *
 * Lived in composer.spec.ts and was matched with `startsWith`/`endsWith`, which
 * is how /governance kept failing on a message /compose already knew to ignore
 * and how the composer's own copy still fired: whatever WebKit puts around the
 * text does not survive being pinned at both ends. This matches the two stable
 * phrases and requires our own host between them, so a real access-control
 * failure against somebody else's host still fails the test.
 */
export function isCancelledSameOrigin(text: string): boolean {
  return (
    text.includes('Fetch API cannot load') &&
    text.includes('due to access control checks') &&
    (text.includes('127.0.0.1:') || text.includes('localhost:'))
  )
}
