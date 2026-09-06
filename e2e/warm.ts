import { request } from '@playwright/test'

/**
 * One cold render per page, before any test is watching.
 *
 * Every page here is server-rendered against a Starknet node, and the first
 * request for one pays for that read while every request after it is served
 * from the revalidate cache and refreshed in the background. Under three
 * engines sharing one `next start` on a two-core runner, whichever test drew
 * the cold render waited on the node with a 60 second budget and the ones
 * behind it queued: three Firefox tests died at exactly 1.0 minute in the run
 * that prompted this and passed in under three seconds on the retry, and WebKit
 * reported the queued RSC prefetches as "Fetch API cannot load ... due to
 * access control checks", which reads as a CORS bug and is a busy server.
 *
 * Warming is not hiding the latency: `readGovernance` now has its own budget,
 * and a page that cannot render still fails its own test. This only stops one
 * arbitrary test from being the one that pays.
 */
const PORT = Number(process.env.E2E_PORT ?? 3100)

export default async function warmPages() {
  const context = await request.newContext({ baseURL: `http://127.0.0.1:${PORT}` })

  // Sequential. Asking for five cold server renders at once is the pile-up this
  // exists to prevent.
  for (const path of ['/', '/compose', '/governance', '/verify', '/slides']) {
    try {
      await context.get(path, { timeout: 120_000 })
    } catch {
      // A page that will not warm is a page whose own test is about to say so,
      // with a better message than this file could write.
    }
  }

  await context.dispose()
}
