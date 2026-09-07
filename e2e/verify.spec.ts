import { expect, test } from '@playwright/test'
import { settled } from './settled'

/** Real, permanent: a pool deposit that went through nobody's router. */
const POOL_TX = '0x6abbe003a51a29b634d8615517d231d469f3e009b4a1289a0e701efef057779'
const ROUTER = '0x008498d79ca390b34a6416cc45fb375ad9b921eefd8d4531d99a2d775feb3a7e'

test.describe('verify', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/verify', { waitUntil: 'domcontentloaded' })
    await settled(page)
  })

  test('cannot be run empty', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Check' })).toBeDisabled()
  })

  test('a pool transaction counts for a project that deployed nothing', async ({ page }) => {
    await page.getByLabel('transaction hashes').fill(POOL_TX)
    await page.getByRole('button', { name: 'Check' }).click()

    await expect(page.getByText('1 of 1 would count')).toBeVisible({ timeout: 20_000 })
    // The fourth rule does not apply, and the page says so rather than ticking
    // or crossing a box that has no answer.
    await expect(page.getByText('Not applicable')).toBeVisible()
  })

  test('the same transaction does not count once contracts are named', async ({ page }) => {
    await page.getByLabel('transaction hashes').fill(POOL_TX)
    await page.getByLabel(/deployed contracts/).fill(ROUTER)
    await page.getByRole('button', { name: 'Check' }).click()

    await expect(page.getByText('0 of 1 would count')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText(/not through a contract of ours/)).toBeVisible()
  })

  test('a hash that is not a felt is refused rather than sent', async ({ page }) => {
    await page.getByLabel('transaction hashes').fill('definitely-not-a-hash')
    await page.getByRole('button', { name: 'Check' }).click()

    await expect(page.getByText(/must be a felt/)).toBeVisible({ timeout: 20_000 })
  })

  test('reads several hashes at once, however they are separated', async ({ page }) => {
    await page.getByLabel('transaction hashes').fill(`${POOL_TX}\n${POOL_TX}, ${POOL_TX}`)
    await page.getByRole('button', { name: 'Check' }).click()

    await expect(page.getByText('3 of 3 would count')).toBeVisible({ timeout: 30_000 })
  })
})

test('refuses a batch larger than it will read', async ({ page }) => {
  await page.goto('/verify', { waitUntil: 'domcontentloaded' })
  await settled(page)

  // Each hash is a node call on a shared key. A public text box with no cap on
  // it is a public text box that gets handed a phone book.
  const many = Array.from({ length: 25 }, () => POOL_TX).join('\n')
  await page.getByLabel('transaction hashes').fill(many)
  await page.getByRole('button', { name: 'Check' }).click()

  await expect(page.getByText(/25 hashes at once/)).toBeVisible()
  // And nothing was sent.
  await expect(page.getByText(/would count/)).toHaveCount(0)
})

test('a batch at the cap still runs', async ({ page }) => {
  await page.goto('/verify', { waitUntil: 'domcontentloaded' })
  await settled(page)
  await page.getByLabel('transaction hashes').fill(Array.from({ length: 20 }, () => POOL_TX).join('\n'))
  await page.getByRole('button', { name: 'Check' }).click()

  await expect(page.getByText('20 of 20 would count')).toBeVisible({ timeout: 60_000 })
})

test.describe('reading a whole submission', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/verify', { waitUntil: 'domcontentloaded' })
    await settled(page)
  })

  test('reads a real repository’s manifest from GitHub', async ({ page }) => {
    await page.getByLabel('owner/repo').fill('PugarHuda/jalin')
    await page.getByRole('button', { name: 'Read it' }).click()

    // Our own manifest, judged by the rule it will be judged by. This used to
    // assert "the sprint asks for three" - the sentence shown while fewer than
    // three were listed - and went red the day the third landed, which is the
    // one day a test on the submission should be green. What must hold at any
    // point is that every transaction we list counts: N of N, never N of M.
    const verdict = page.getByText(/(\d+) of (\d+) listed transactions would count/)
    await expect(verdict).toBeVisible({ timeout: 30_000 })
    const [, counted, listed] = (await verdict.innerText()).match(/(\d+) of (\d+) listed/)!
    expect(counted).toBe(listed)
    expect(Number(listed)).toBeGreaterThan(0)
    await expect(page.locator('main')).toContainText('2 contracts declared')
    /**
     * The sprint hub's own verdict, beside ours.
     *
     * This asserted that the two always agree, and that was a false invariant
     * rather than a strict one: the hub re-reads a repository on its own
     * schedule, so the hour after a fourth hash was pushed it read "the hub
     * counts 3 · this page counts 4" and this test went red for the page
     * telling the truth.
     *
     * What must hold is that the page never claims agreement it does not have.
     * Agreement is one legitimate state and a lagging hub is the other, and in
     * the second the page has to name both numbers and say why they differ.
     */
    const hub = page.getByTestId('hub-verdict')
    await expect(hub).toBeVisible({ timeout: 30_000 })
    await expect(hub).toContainText(
      /the hub counts \d+ · (agrees|this page counts \d+)/,
    )
    if (!/· agrees/.test(await hub.innerText())) {
      await expect(hub).toContainText(/re-reads a repository on its own schedule/)
    }
    // Whichever tick the hub gave. `mainnet ✓` was asserted here until the
    // hub's default node was discontinued and every project on it read
    // `mainnet ✗` for an afternoon; this page's job is to print that verdict
    // beside its own, not to promise the hub agrees.
    await expect(hub).toContainText(/mainnet [✓✗]/)
    if (/mainnet ✗/.test(await hub.innerText())) {
      // Then it had better be saying so out loud, with our count next to it.
      await expect(hub).toContainText(/this page counts \d+/)
    }

    // The demo URL is what a panel opens first, so it is a link here - and only
    // a link: the server never fetches what a manifest names. Since the demo
    // video is served from the app itself, two links in this panel share that
    // host and matching on it alone is ambiguous. Name each one.
    const demoLinks = page.getByTestId('demo-links')
    await expect(
      demoLinks.getByRole('link', { name: 'https://jalin-five.vercel.app', exact: true }),
    ).toBeVisible()
    await expect(demoLinks.getByRole('link', { name: /jalin-demo\.mp4$/ })).toBeVisible()
    // The video is the one field still allowed to be missing while this is
    // written; whichever it is, the page must say which.
    await expect(page.locator('main')).toContainText(/demo video (present|missing)/)
  })

  /**
   * A count made from reads that failed is not a count.
   *
   * `checkReceipt(null)` says "no such transaction", and every transport
   * failure used to be handed to it - so a node that stopped answering turned a
   * qualifying submission into "would not count" on the one page a team checks
   * before submitting. The route now reports which hashes it could not read and
   * the page says the number is a floor.
   */
  test('a node that stops answering is not a shortfall', async ({ page }) => {
    // The manifest itself still loads; the receipts behind it are what fail.
    interface ManifestBody {
      unread: string[]
      counted: number
      results: { hash: string; qualifies: boolean }[]
    }

    await page.route('**/api/manifest**', async (route) => {
      const response = await route.fetch()
      const body = (await response.json()) as ManifestBody
      // Whatever the live answer was, this is the shape the page must handle:
      // some hashes unread, and a count that is therefore a floor.
      const unread = body.results.slice(0, 2)
      const read = body.results.slice(2)
      return route.fulfill({
        response,
        json: {
          ...body,
          unread: unread.map((result) => result.hash),
          results: read,
          counted: read.filter((result) => result.qualifies).length,
        },
      })
    })

    await page.getByLabel('owner/repo').fill('PugarHuda/jalin')
    await page.getByRole('button', { name: 'Read it' }).click()

    await expect(page.locator('main')).toContainText(/went unread/, { timeout: 30_000 })
    await expect(page.locator('main')).toContainText(/floor rather than a verdict/)
    // And it must not also be telling them they are short.
    await expect(page.locator('main')).not.toContainText('the sprint asks for three')
  })

  test('an unreadable hub is not reported as an unregistered repository', async ({ page }) => {
    await page.route('**/api/hub**', (route) => route.fulfill({ status: 502, json: {} }))

    await page.getByLabel('owner/repo').fill('PugarHuda/jalin')
    await page.getByRole('button', { name: 'Read it' }).click()

    await expect(page.getByTestId('hub-error')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('hub-error')).toContainText('not the same as not being registered')
    // And the panel that would have claimed a registration is absent, not empty.
    await expect(page.getByTestId('hub-verdict')).toHaveCount(0)
  })

  test('says so when the repository has no manifest', async ({ page }) => {
    await page.getByLabel('owner/repo').fill('PugarHuda/jalin@no-such-branch')
    await page.getByRole('button', { name: 'Read it' }).click()

    await expect(page.getByText(/no strk20.json/)).toBeVisible({ timeout: 30_000 })
  })

  test('refuses something that is not owner/repo before sending anything', async ({ page }) => {
    const calls: string[] = []
    page.on('request', (request) => {
      if (request.url().includes('/api/manifest')) calls.push(request.url())
    })

    await page.getByLabel('owner/repo').fill('https://example.com/whatever')
    await page.getByRole('button', { name: 'Read it' }).click()

    await expect(page.getByText(/Write it as owner\/repo/)).toBeVisible()
    expect(calls, 'nothing should reach the server').toEqual([])
  })

  test('cannot be run empty', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Read it' })).toBeDisabled()
  })
})

test('the same hash pasted three times is one transaction, not three', async ({ page }) => {
  await page.goto('/verify', { waitUntil: 'domcontentloaded' })
  await settled(page)

  // A naive counter says "3 of 3 would count" here, which is exactly the answer
  // that gets a team rejected.
  await page.getByLabel('transaction hashes').fill([POOL_TX, POOL_TX, POOL_TX].join('\n'))
  await page.getByRole('button', { name: 'Check' }).click()

  await expect(page.getByText('3 of 3 would count')).toBeVisible({ timeout: 30_000 })
})

/**
 * The service panel. It is the document's claim, checked on every load.
 */
test.describe('the services underneath', () => {
  test('asks all three and shows what each answered', async ({ page }) => {
    await page.goto('/verify', { waitUntil: 'domcontentloaded' })
    await settled(page)

    const list = page.getByTestId('services')
    await expect(list).toBeVisible({ timeout: 30_000 })
    await expect(list).toContainText('proving service')
    await expect(list).toContainText('note discovery')
    await expect(list).toContainText('avnu paymaster')
  })

  test('a service that is down is named, and does not take the page with it', async ({ page }) => {
    await page.route('**/api/services', (route) =>
      route.fulfill({
        json: {
          prover: { name: 'proving service', url: 'https://p', ok: false, detail: 'unreachable' },
          discovery: {
            name: 'note discovery',
            url: 'https://d',
            ok: true,
            detail: null,
            lagSeconds: 7,
            chainHead: 14_400_000,
          },
          paymaster: {
            name: 'avnu paymaster',
            url: 'https://a',
            ok: true,
            detail: null,
            gasTokens: ['STRK'],
          },
          checkedAt: new Date().toISOString(),
        },
      }),
    )

    await page.goto('/verify', { waitUntil: 'domcontentloaded' })
    await settled(page)

    const list = page.getByTestId('services')
    await expect(list).toContainText('unreachable')
    // The other two still report, and the verdict form above is untouched.
    await expect(list).toContainText('7s behind the chain')
    await expect(page.getByLabel('owner/repo')).toBeVisible()
  })

  test('the panel says so when its own check fails', async ({ page }) => {
    await page.route('**/api/services', (route) => route.fulfill({ status: 502, json: {} }))

    await page.goto('/verify', { waitUntil: 'domcontentloaded' })
    await settled(page)

    // Scoped: Next's own route announcer is also role="alert".
    await expect(page.locator('section').filter({ hasText: 'The services underneath' })
      .getByRole('alert')).toContainText('did not run')
  })
})
