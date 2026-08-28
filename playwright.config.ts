import { defineConfig, devices } from '@playwright/test'
import { loadEnv } from './scripts/lib/env.mjs'

/**
 * End-to-end against a real build, reading the real chain.
 *
 * Nothing here is stubbed. The API routes talk to a Starknet mainnet node and
 * the assertions are written to hold against live data rather than a fixture:
 * the crowd count changes between runs, so the test asserts it is a number in a
 * sane range, not a value. A test that asserts a fixture only proves the fixture
 * was loaded.
 *
 * The one thing a browser cannot do here is sign. The private key lives in a
 * wallet extension, so the signing tests stop at the point where the wallet
 * would take over and assert what the page does when no wallet is installed —
 * which is itself a path a judge will hit.
 */
loadEnv()

/**
 * 3100 by default, overridable, because "already used" was the whole answer the
 * suite gave on a machine where another project's server held the port - and
 * the suite is the thing you want running while that other project is too.
 */
const PORT = Number(process.env.E2E_PORT ?? 3100)
const baseURL = `http://127.0.0.1:${PORT}`

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,

  /**
   * Four, against a default of half the cores.
   *
   * One `next start` process serves all of them, and behind most requests is a
   * real call to a Starknet node. At eight workers the server started refusing
   * connections part way through a run and every test after that point failed
   * with "Could not connect" - which reads exactly like a broken page and is
   * not one. Four keeps the whole suite green on three engines.
   */
  workers: 4,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  /**
   * 60 seconds, not 30. Every test here talks to a real Starknet node and three
   * engines share one machine; the failures that budget produced were all
   * `browserContext.close` and `page.goto` timing out under load, never an
   * assertion. A timeout that fires on machine pressure teaches you to rerun
   * rather than to read.
   */
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },

    /**
     * Three engines, not one. Chromium alone cannot see a Gecko or WebKit
     * layout difference, and this page leans on grid, `color-mix`, `mask-image`
     * and a masked SVG - all places the three disagree. The API tests are
     * excluded from these two because a route's JSON does not vary by browser
     * and asking a mainnet node for it three times over is rude to a public
     * endpoint.
     */
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
      testIgnore: [/api\.spec\.ts/, /params\.spec\.ts/],
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
      testIgnore: [/api\.spec\.ts/, /params\.spec\.ts/],
    },

    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /responsive\.spec\.ts/ },

    /** WebKit on a phone, which is every iPhone that will ever open this. */
    { name: 'mobile-safari', use: { ...devices['iPhone 14'] }, testMatch: /responsive\.spec\.ts/ },
  ],
  webServer: {
    // Builds as well as serves. NEXT_PUBLIC_* is inlined at build time, so a
    // server started over a build that did not have the router address would
    // test a different page than the one that is deployed.
    command: `npm run build --workspace app && npm run start --workspace app -- --port ${PORT}`,
    url: baseURL,
    // Never reused. A server left over from an earlier run serves HTML that
    // names chunk files a later build has replaced, and with nosniff on, the
    // browser then refuses the stylesheet - which reads as a CSS bug in the
    // application rather than a stale process. Rebuilding costs a few seconds
    // and buys a result that means what it says.
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      STARKNET_RPC_URL: process.env.STARKNET_RPC_URL ?? '',
      NEXT_PUBLIC_ROUTER_ADDRESS: process.env.ROUTER_ADDRESS ?? '',
      NEXT_PUBLIC_GOVERNOR_ADDRESS: process.env.GOVERNOR_ADDRESS ?? '',
    },
  },
})
