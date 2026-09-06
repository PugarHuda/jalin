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
   * Pay for every page's first server render before the suite starts, so no
   * test is the one that waits on a cold read of the chain. See e2e/warm.ts.
   */
  globalSetup: './e2e/warm.ts',

  /**
   * Four, against a default of half the cores.
   *
   * One `next start` process serves all of them, and behind most requests is a
   * real call to a Starknet node. At eight workers the server started refusing
   * connections part way through a run and every test after that point failed
   * with "Could not connect" - which reads exactly like a broken page and is
   * not one. Four keeps the whole suite green on three engines.
   */
  /**
   * Three on CI. Four held while the suite was smaller; at 330-odd tests on
   * three engines, with /governance walking the governor's events on every
   * cold render through a public node, the runner's one `next start` began
   * dropping connections again - `page.goto` at the full 60 seconds on
   * Firefox, `TypeError: Load failed` from a fetch to our own API on WebKit,
   * two runs in three. Those are the server saturating, not the page, and
   * fewer workers is the honest fix; the retry in the composer is the other
   * half.
   */
  /**
   * Three everywhere now. The local four held until /slides took the suite to
   * 353, and then the same shape came back on this machine: a different
   * /governance test failing on Firefox in each of three consecutive full runs,
   * every one of them passing alone. That is the saturation this comment
   * already describes, arriving at a lower worker count because the suite got
   * bigger - so the number moves rather than the diagnosis.
   */
  /**
   * Two on CI, because `ubuntu-latest` is a two-core runner. Three workers plus
   * one `next start` on two vCPUs is oversubscribed before a single browser
   * starts, and it failed the way this comment keeps describing: a /governance
   * test dying on `page.goto` at the full sixty seconds, twice, while passing
   * alone locally in 15 seconds. The diagnosis has never changed - the machine
   * saturates and the page is blamed - so the number tracks the cores rather
   * than staying a constant that happens to fit one laptop.
   */
  /**
   * One on CI, chosen by measurement rather than by the theory of the week.
   *
   *   3 workers  suite fails outright
   *   2 workers  green, 2 flaky, browser job ~5-6 minutes
   *   1 worker   green, 0-1 flaky, browser job ~6-10 minutes
   *
   * Three minutes of runner time is worth less than a retry line nobody can
   * tell from a regression. Locally the machine is not shared and three is
   * fine.
   *
   * THE OPEN ONE, so the next person does not repeat this. About one run in two
   * has a single Firefox test consume its whole timeout inside `page.goto` and
   * pass in about two seconds on the retry, on a different page each time. The
   * retry catches it and the job is green; nothing below has ever made it
   * reliably absent. Ruled out, each by its own fix, each of which stayed
   * because it was independently right:
   *
   *   a slow render          event walks have budgets, independent reads overlap
   *   an impatient ceiling   at a 120s timeout it failed at 120s
   *   a busy machine         it survived at one worker with nothing competing
   *   waiting on subresources every goto is domcontentloaded now, and it failed
   *                          navigating to a page that does no server reads
   *   a keep-alive race      closed from the server side (--keepAliveTimeout)
   *                          and the client side (Firefox keep-alive off)
   *
   * What has not been tried: capturing the server's own access log for the
   * hung request, which would say whether it ever arrived. That is the next
   * step if it starts failing both attempts.
   */
  workers: process.env.CI ? 1 : 3,
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
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: [/ready\.spec\.ts/],
    },

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
      use: {
        ...devices['Desktop Firefox'],
        /**
         * No persistent connections, for this browser, in this suite only.
         *
         * Firefox is the only engine that produces the hang described above the
         * worker count, so this closes the connection-reuse window from the
         * client side after `--keepAliveTimeout` closed it from the server's.
         * It did not end the hang, and it is kept because a connection that is
         * never reused cannot be reused after it was closed - one fewer thing
         * between the test and the answer.
         *
         * It costs a TCP handshake per request against a server on loopback,
         * and it is a test-harness setting - nothing here changes what the
         * application sends or how a real browser talks to it.
         */
        launchOptions: { firefoxUserPrefs: { 'network.http.keep-alive': false } },
      },
      testIgnore: [/api\.spec\.ts/, /params\.spec\.ts/, /ready\.spec\.ts/],
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
      testIgnore: [/api\.spec\.ts/, /params\.spec\.ts/, /ready\.spec\.ts/],
    },

    /**
     * The real Ready extension, in its own headed Chromium. Only Chromium can
     * load an extension at all, and the spec builds its own context, so this
     * project exists to keep the file out of the other three rather than to
     * configure a browser for it. Skips itself where Ready is not installed.
     */
    { name: 'ready', testMatch: /ready\.spec\.ts/ },

    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /responsive\.spec\.ts/ },

    /** WebKit on a phone, which is every iPhone that will ever open this. */
    { name: 'mobile-safari', use: { ...devices['iPhone 14'] }, testMatch: /responsive\.spec\.ts/ },
  ],
  webServer: {
    // Builds as well as serves. NEXT_PUBLIC_* is inlined at build time, so a
    // server started over a build that did not have the router address would
    // test a different page than the one that is deployed.
    /**
     * `--keepAliveTimeout` above the test timeout, because node's default is
     * five seconds and that is a race the client loses in silence.
     *
     * When the server closes an idle keep-alive connection at the same moment a
     * browser sends its next request on it, the request is neither answered nor
     * refused - it is dropped, and nothing retries it. The symptom is a
     * navigation that hangs for the entire timeout and then succeeds instantly
     * on a fresh connection, which is the shape of the hang described above the
     * worker count. Raising this did not end that hang, so it is not the whole
     * story; it is kept because five seconds is a real window and closing it
     * costs nothing.
     */
    command: `npm run build --workspace app && npm run start --workspace app -- --port ${PORT} --keepAliveTimeout 72000`,
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
