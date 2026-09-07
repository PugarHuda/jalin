import { expect, test } from '@playwright/test'
import { isCancelledSameOrigin, settled } from './settled'

const ROUTER = '0x008498d79ca390b34a6416cc45fb375ad9b921eefd8d4531d99a2d775feb3a7e'

test.describe('governance', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/governance', { waitUntil: 'domcontentloaded' })
    await settled(page)
  })

  test('is not serving the failure fallback', async ({ page }) => {
    // This page once shipped "could not be read" as its prerendered HTML: a
    // blanket catch swallowed Next's dynamic-usage signal, so the route was
    // built static with the failure branch baked in.
    await expect(page.locator('main')).not.toContainText('could not be read')
    await expect(page.getByText('What the router is running on')).toBeVisible()
  })

  test('shows the parameters the router is actually running on', async ({ page }) => {
    // Read from the governor, not from a config file — so the page has to agree
    // with what the contract answers.
    await expect(page.getByText('max steps', { exact: true })).toBeVisible()
    await expect(page.getByText('max calldata', { exact: true })).toBeVisible()
    await expect(page.locator('main')).toContainText(/\d+ bps/)
    await expect(page.locator('main')).toContainText(/paused/)
  })

  test('lists the proposal that exists on chain', async ({ page }) => {
    // Proposal 1 is a real LABEL proposal made at block 13,771,935.
    await expect(page.getByText('#1 · label')).toBeVisible()
    await expect(page.locator('main')).toContainText('JALIN_ROUTER')
  })

  /**
   * The trust chain, asked rather than configured.
   *
   * Everything on this page is the governor's answer, and until this was read
   * the only evidence the router listens to that governor was an environment
   * variable. `router.governor()` has existed since the first deploy and was
   * read by nothing; the deploying doc told a human to check it by hand.
   */
  test('the router is asked which governor it reads', async ({ page }) => {
    await expect(page.getByTestId('bond')).toBeVisible()
    await expect(page.getByTestId('bond')).toContainText(
      /this governor|not the governor|unreadable/,
    )
  })

  test('says why a proposal cannot execute rather than only that it cannot', async ({ page }) => {
    // `.first()`: the governor has more than one closed proposal now, and the
    // assertion is that the page gives a reason rather than that it gives one
    // reason. It failed on strict mode the day a third proposal was opened.
    await expect(page.getByText(/rejected · nobody voted/).first()).toBeVisible()
  })

  test('admits the one parameter it cannot show', async ({ page }) => {
    // Quorum has no view on the governor. Saying so is better than omitting it.
    await expect(page.locator('main')).toContainText(/Quorum cannot be shown/)
  })

  test('the voting window and timelock are measured, not asserted', async ({ page }) => {
    await expect(page.getByText('voting window', { exact: true })).toBeVisible()
    await expect(page.getByText('timelock', { exact: true })).toBeVisible()
    await expect(page.locator('main')).toContainText(/measured, not configured here/)
  })

  test('builds a real propose call and shows it before signing', async ({ page }) => {
    await page.getByText('the exact call this would send').click()

    const call = page.locator('pre')

    /**
     * The Wallet API's `Call` is `{ contract_address, entry_point, calldata }`,
     * and `entry_point` holds the entrypoint's name. `entry_point_selector` is
     * the JSON-RPC spelling: correct in `lib/rpc`, refused here with
     * INVALID_REQUEST_PAYLOAD and no `data` to say which field was wrong.
     *
     * This test used to assert the RPC spelling, which made it a guarantee that
     * the payload stayed the one the wallet rejects. Both halves are asserted
     * now, because being right about the new name does not stop the old one
     * coming back beside it.
     */
    await expect(call).toContainText('"entry_point": "propose"')
    await expect(call).not.toContainText('entry_point_selector')

    // 0x4 is LABEL, the default tab, and the target defaults to our router.
    await expect(call).toContainText(ROUTER.replace(/^0x0*/, '').slice(0, 20))
  })

  test('a target that is not a felt is refused instead of encoded', async ({ page }) => {
    await page.getByLabel('target', { exact: true }).fill('not-a-felt')

    await expect(page.locator('main')).toContainText('target must be a felt')
    await expect(page.getByRole('button', { name: 'Sign and propose' })).toBeDisabled()
  })

  test('a numeric field refuses text', async ({ page }) => {
    await page.getByRole('button', { name: 'fee', exact: true }).click()
    await page.getByLabel('fee in bps').fill('lots')

    await expect(page.locator('main')).toContainText(/is not a whole number/)
    await expect(page.getByRole('button', { name: 'Sign and propose' })).toBeDisabled()
  })

  test('the limits kind asks for both bounds', async ({ page }) => {
    await page.getByRole('button', { name: 'limits', exact: true }).click()

    await expect(page.getByLabel('max steps')).toBeVisible()
    await expect(page.getByLabel('max calldata')).toBeVisible()
  })

  test('renders without a console error', async ({ page }) => {
    const errors: string[] = []
    page.on('console', (m) => {
      if (m.type() === 'error' && !isCancelledSameOrigin(m.text())) errors.push(m.text())
    })
    page.on('pageerror', (e) => {
      const text = String(e)
      if (!isCancelledSameOrigin(text)) errors.push(text)
    })

    await page.reload()
    await settled(page)
    await page.getByRole('button', { name: 'deny', exact: true }).click()
    expect(errors).toEqual([])
  })
})

test('offers no execute button for a proposal that cannot execute', async ({ page }) => {
  await page.goto('/governance', { waitUntil: 'domcontentloaded' })

  /**
   * A rejected proposal has nothing to execute, so its own card offers no
   * button.
   *
   * Scoped to the card rather than the page, and this used to be neither: it
   * asserted one `rejected · nobody voted` on the whole document and zero
   * Execute buttons anywhere. Both broke the day a second proposal was made
   * - two matches is a strict-mode violation, and a *different* proposal
   * becoming executable would have failed this for a reason it is not about.
   */
  const rejected = page.locator('li', { hasText: /rejected · nobody voted/ }).first()
  await expect(rejected).toBeVisible()
  await expect(rejected.getByRole('button', { name: /^Execute #/ })).toHaveCount(0)
})

test.describe('stuck balances', () => {
  test('reports nothing stuck, and says what it checked', async ({ page }) => {
    await page.goto('/governance', { waitUntil: 'domcontentloaded' })

    // The router holds nothing today. The claim has to name both of its blind
    // spots: a contract cannot enumerate its own balances, and a token whose
    // balanceOf failed is unchecked rather than clear.
    await expect(page.locator('main')).toContainText(/Nothing stuck in the \d+ of \d+ tokens/)
    await expect(page.locator('main')).toContainText(/never heard of/)
    await expect(page.getByRole('button', { name: /^Sweep / })).toHaveCount(0)
  })

  test('explains why sweeping is safe to leave open to anyone', async ({ page }) => {
    await page.goto('/governance', { waitUntil: 'domcontentloaded' })
    await settled(page)
    await expect(page.locator('main')).toContainText(/anyone may call it/i)
    await expect(page.locator('main')).toContainText(/never profitable|not profitable/i)
  })
})

/**
 * The ballot redemption panel.
 *
 * The composer has minted ballot secrets since the day it shipped and told
 * voters the stake comes back with them. Nothing could spend one: `redeem` was
 * Cairo with no caller. These tests hold the two properties that make the panel
 * worth trusting - it asks the chain rather than assuming, and the secret does
 * not leave the browser until it is spent on chain.
 */
test.describe('redeeming a ballot stake', () => {
  /** A felt under the field prime that nobody has ever staked against. */
  const UNUSED_SECRET = '0x03' + 'a'.repeat(61) + '9'

  test('a secret nobody staked against is answered from the governor', async ({ page }) => {
    await page.goto('/governance', { waitUntil: 'domcontentloaded' })
    await settled(page)

    await page.getByLabel('Ballot secret').fill(UNUSED_SECRET)
    await page.getByRole('button', { name: 'Look it up' }).click()

    // Four chain reads behind one click, and CI's node is a public one.
    await expect(page.getByTestId('ballot-stage')).toContainText('No ballot', { timeout: 30_000 })
    // Nothing to redeem, so nothing is offered. A disabled button that reverts
    // on click is the thing this replaces.
    await expect(page.getByRole('button', { name: /^Redeem / })).toHaveCount(0)

    // The escrow, from the same lookup rather than from another one. The
    // deployed governor predates `outstanding()`, so either the page prints
    // what is owed or it says why it cannot - never a zero standing in for an
    // unanswerable question.
    await expect(page.locator('#redeem')).toContainText(/held|unreadable/)
  })

  test('the secret never reaches the network, only its hash does', async ({ page }) => {
    const secretsSeen: string[] = []
    page.on('request', (request) => {
      const url = request.url()
      const body = request.postData() ?? ''
      if (url.includes(UNUSED_SECRET.slice(2)) || body.includes(UNUSED_SECRET.slice(2))) {
        secretsSeen.push(url)
      }
    })

    await page.goto('/governance', { waitUntil: 'domcontentloaded' })
    await settled(page)
    await page.getByLabel('Ballot secret').fill(UNUSED_SECRET)
    await page.getByRole('button', { name: 'Look it up' }).click()
    await expect(page.getByTestId('ballot-stage')).toBeVisible({ timeout: 30_000 })

    expect(secretsSeen, 'the secret is a bearer instrument and left this machine').toEqual([])
  })

  test('a lookup that is not a felt is refused before any request is made', async ({ page }) => {
    await page.goto('/governance', { waitUntil: 'domcontentloaded' })
    await settled(page)

    let asked = 0
    page.on('request', (request) => {
      if (request.url().includes('/api/ballot')) asked += 1
    })

    await page.getByLabel('Ballot secret').fill('not-a-felt')
    await page.getByRole('button', { name: 'Look it up' }).click()

    // Scoped to the panel: Next's own route announcer is also role="alert".
    await expect(page.locator('#redeem').getByRole('alert')).toContainText('felt')
    expect(asked).toBe(0)
  })
})
