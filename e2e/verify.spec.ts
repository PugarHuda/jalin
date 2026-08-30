import { expect, test } from '@playwright/test'
import { settled } from './settled'

/** Real, permanent: a pool deposit that went through nobody's router. */
const POOL_TX = '0x6abbe003a51a29b634d8615517d231d469f3e009b4a1289a0e701efef057779'
const ROUTER = '0x008498d79ca390b34a6416cc45fb375ad9b921eefd8d4531d99a2d775feb3a7e'

test.describe('verify', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/verify')
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
  await page.goto('/verify')
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
  await page.goto('/verify')
  await settled(page)
  await page.getByLabel('transaction hashes').fill(Array.from({ length: 20 }, () => POOL_TX).join('\n'))
  await page.getByRole('button', { name: 'Check' }).click()

  await expect(page.getByText('20 of 20 would count')).toBeVisible({ timeout: 60_000 })
})

test.describe('reading a whole submission', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/verify')
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
    // The sprint hub's own verdict, beside ours. For this repository the two
    // must agree: the hub's verifier and this page apply the same four rules
    // to the same three hashes, and a disagreement would be a bug in one of
    // them that the panel would meet before we did.
    const hub = page.getByTestId('hub-verdict')
    await expect(hub).toBeVisible({ timeout: 30_000 })
    await expect(hub).toContainText(/the hub counts \d+ · agrees/)
    await expect(hub).toContainText(/mainnet ✓/)

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
  await page.goto('/verify')
  await settled(page)

  // A naive counter says "3 of 3 would count" here, which is exactly the answer
  // that gets a team rejected.
  await page.getByLabel('transaction hashes').fill([POOL_TX, POOL_TX, POOL_TX].join('\n'))
  await page.getByRole('button', { name: 'Check' }).click()

  await expect(page.getByText('3 of 3 would count')).toBeVisible({ timeout: 30_000 })
})
