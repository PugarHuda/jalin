import { chromium, expect, test, type BrowserContext } from '@playwright/test'
import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * The wallet surface with a real wallet in the browser.
 *
 * `wallet.spec.ts` asserts what the page does with no wallet at all, and says
 * plainly that it cannot have a private key. This is the other half: Ready,
 * the actual extension, loaded into a real Chromium profile. Nothing here is
 * stubbed - there is no injected `window.starknet` written by the test, no
 * fixture standing in for a capability answer.
 *
 * It is skipped wherever the extension is not installed, which includes CI.
 * A test that silently passes because it found nothing to drive is worse than
 * one that says it did not run.
 *
 *   READY_EXTENSION_PATH=/path/to/unpacked npx playwright test e2e/ready.spec.ts --project=ready
 */

/** Ready X, formerly Argent X. The id is stable across versions. */
const EXTENSION_ID = 'dlcobpjiigpikoobohmabehhmhfoodbb'

function findExtension(): string | null {
  const explicit = process.env.READY_EXTENSION_PATH
  if (explicit) return existsSync(explicit) ? explicit : null

  const roots = [
    join(homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'User Data', 'Default', 'Extensions'),
    join(homedir(), 'Library', 'Application Support', 'Google', 'Chrome', 'Default', 'Extensions'),
    join(homedir(), '.config', 'google-chrome', 'Default', 'Extensions'),
  ]
  for (const root of roots) {
    const base = join(root, EXTENSION_ID)
    if (!existsSync(base)) continue
    // Chrome keeps one directory per installed version; take the newest.
    const versions = readdirSync(base).sort()
    const newest = versions[versions.length - 1]
    if (newest && existsSync(join(base, newest, 'manifest.json'))) return join(base, newest)
  }
  return null
}

const extension = findExtension()

test.describe('the wallet surface, with Ready actually installed', () => {
  test.skip(!extension, 'Ready is not installed on this machine')
  // One headed Chromium with an extension in it, shared by the file. Manifest
  // V3 runs the wallet as a service worker, and that needs a real browser.
  test.describe.configure({ mode: 'serial' })

  let context: BrowserContext

  test.beforeAll(async () => {
    context = await chromium.launchPersistentContext('', {
      // launchPersistentContext builds its own context, so nothing from
      // `use` in the config reaches it - baseURL included.
      baseURL: `http://127.0.0.1:${process.env.E2E_PORT ?? 3100}`,
      headless: false,
      args: [
        `--disable-extensions-except=${extension}`,
        `--load-extension=${extension}`,
        '--no-first-run',
      ],
    })
  })

  test.afterAll(async () => {
    await context?.close()
  })

  test('the extension is really running, not merely on disk', async () => {
    const page = await context.newPage()
    await page.goto('/compose', { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(4000)

    // Manifest V3 runs the wallet as a service worker. If it is not up, the
    // extension was copied into the profile and never started, and everything
    // below would pass against an empty browser.
    const workers = context.serviceWorkers().map((w) => w.url())
    expect(workers.some((u) => u.includes(EXTENSION_ID))).toBe(true)

    // And its content script reached this page.
    const injected = await page.evaluate(() =>
      Object.keys(window).some((k) => k.includes('argent_x_extension')),
    )
    expect(injected, 'the wallet content script did not run in the page').toBe(true)

    // What is deliberately NOT asserted: a `window.starknet_*` handle. A wallet
    // in a fresh profile has not been through onboarding, so it exposes no
    // provider and opens its own setup page instead. Asserting the handle here
    // would only be asserting that somebody had set this machine up by hand.
    await page.close()
  })

  test('the composer offers to connect and does not invent an answer for it', async () => {
    const page = await context.newPage()
    await page.goto('/compose', { waitUntil: 'domcontentloaded' })

    await expect(page.getByRole('button', { name: 'connect Ready' })).toBeVisible()

    // Until the wallet has answered, the panels that render its answers must
    // not exist. A locked extension is still a wallet that has said nothing,
    // and the page must not fill that silence with a constant.
    await expect(page.getByTestId('shielded')).toHaveCount(0)
    await expect(page.getByTestId('shadow')).toHaveCount(0)
    await page.close()
  })
})
