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

const PORT = 3100
const baseURL = `http://127.0.0.1:${PORT}`

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /responsive\.spec\.ts/ },
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
