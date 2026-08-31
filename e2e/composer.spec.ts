import { expect, test } from '@playwright/test'
import { json, type ParamsResponse } from './api-types'
import { settled } from './settled'

const ENDUR_VAULT = '0x28d709c875c0ceac3dce7065bec5328186dc89fe254527084d1689910954b0a'

test.describe('composer', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/compose')
    await settled(page)
  })

  test('a preset loads real mainnet addresses, not example ones', async ({ page }) => {
    await page.getByRole('button', { name: 'Stake on Endur' }).click()

    // The vault the plan deposits into has to be the one that exists on chain.
    // A preset that looks right and points at 0xdead is worse than no preset.
    await page.getByRole('button', { name: 'calldata', exact: true }).click()
    await expect(page.locator('pre')).toContainText(ENDUR_VAULT.slice(2, 20))
  })

  test('submitting is refused while a step has no target', async ({ page }) => {
    await page.getByRole('button', { name: 'Stake on Endur' }).click()
    await page.getByRole('button', { name: '+ step' }).click()

    const submit = page.getByRole('button', { name: /Sign and submit|Check wallet support/ })
    await expect(submit).toBeDisabled()
    await expect(page.locator('main')).toContainText('no target yet')
  })

  test('filling in the target enables submitting', async ({ page }) => {
    await page.getByRole('button', { name: 'Stake on Endur' }).click()
    await page.getByLabel('Step 1 target').fill(ENDUR_VAULT)

    const submit = page.getByRole('button', { name: /Sign and submit|Check wallet support/ })
    await expect(submit).toBeEnabled()
  })

  test('an unparseable target is reported instead of silently encoded', async ({ page }) => {
    await page.getByRole('button', { name: 'Stake on Endur' }).click()
    await page.getByLabel('Step 1 target').fill('not-an-address')

    // The failure has to arrive here, not at the wallet. A plan carrying
    // nonsense that still offers a submit button is the worst of both.
    await expect(page.locator('main')).toContainText('not a felt')
    await expect(page.getByRole('button', { name: /Sign and submit/ })).toBeDisabled()
  })

  test('the disclosure panel separates what is hidden from what is public', async ({ page }) => {
    await page.getByRole('button', { name: 'Stake on Endur' }).click()

    await expect(page.getByText('Hidden', { exact: true })).toBeVisible()
    await expect(page.locator('main')).toContainText(/public|revealed|visible/i)
  })

  test('the three tabs each show something different', async ({ page }) => {
    await page.getByRole('button', { name: 'Stake on Endur' }).click()

    const seen: string[] = []
    for (const tab of ['What this reveals', 'calldata', 'actions'] as const) {
      await page.getByRole('button', { name: tab, exact: true }).click()
      seen.push(await page.locator('main').innerText())
    }
    expect(new Set(seen).size).toBe(3)
  })

  test('says how big the crowd for this exact deposit would be', async ({ page }) => {
    await page.getByRole('button', { name: 'Stake on Endur' }).click()

    // Measured against the chain for the amount in the box, not a pool-wide
    // headcount dressed up as an anonymity set.
    const panel = page.getByText('The crowd you would land in')
    await expect(panel).toBeVisible({ timeout: 20_000 })
    await expect(page.locator('main')).toContainText(/effective anonymity set would be \d+\.\d\d/)
  })

  test('changing the amount asks the question again', async ({ page }) => {
    await page.getByRole('button', { name: 'Stake on Endur' }).click()
    await expect(page.getByText('The crowd you would land in')).toBeVisible({ timeout: 20_000 })

    await page.getByLabel('Input amount').fill('98765')
    // Still answered, and still about the amount that is in the box now.
    await expect(page.locator('main')).toContainText(/effective anonymity set would be/, {
      timeout: 20_000,
    })
  })

  test('the mainnet run quotes the vault live', async ({ page }) => {
    // The floor under the Endur run comes from preview_deposit, not a constant.
    const quote = page.getByText(/vault quotes/)
    await expect(quote).toBeVisible()

    const shares = Number((await quote.innerText()).match(/quotes ([\d.]+) xSTRK/)?.[1])
    expect(shares).toBeGreaterThan(0)
  })

  test('the run buttons are live because the router is deployed', async ({ page }) => {
    await expect(page.getByRole('button', { name: /^shield · / })).toBeEnabled()

    const runs = page.getByRole('button', { name: /^run · / })
    await expect(runs).toHaveCount(3)

    /**
     * The first two only need the router, which is deployed. The third needs a
     * proposal taking votes, which is a property of the chain right now rather
     * than of the deployment - so it has its own tests and is not asserted
     * here. This test claimed all three and was right until the ballot stopped
     * pointing at a vote that had closed.
     */
    await expect(runs.nth(0)).toBeEnabled()
    await expect(runs.nth(1)).toBeEnabled()
  })

  test('the shield covers the pool fee on every operation it pays for', async ({ page }) => {
    /**
     * The shield used to be a flat 1 STRK, sized by counting the value the runs
     * move and forgetting what the pool charges to move it. On mainnet that is
     * 6 STRK per private operation, so the first spend failed for a shortfall
     * the page had built in and could not name.
     *
     * Asserted against the fee the pool reports rather than against 24.85,
     * because the fee is governed: a test pinned to today's number would go
     * green on a page that had gone wrong the moment it changed.
     */
    const params = await json<ParamsResponse>(await page.request.get('/api/params'))

    // When the pool would not answer, the shield is not offered either, so
    // there is nothing to check the sizing against. Skipped rather than failed:
    // a rate-limited node is not a broken page, and asserting here would only
    // make it look like one.
    test.skip(params.poolFee === null, 'the pool fee could not be read')

    const fee = BigInt(params.poolFee!)
    expect(fee).toBeGreaterThan(0n)

    const shield = page.getByRole('button', { name: /^shield · / })
    const shielded = Number((await shield.innerText()).match(/shield · ([\d.]+) STRK/)?.[1])

    const runs = await page.getByRole('button', { name: /^run · / }).allInnerTexts()
    const spent = runs.reduce((total, text) => total + Number(text.match(/([\d.]+) STRK/)![1]), 0)

    // One operation for the shield itself, one for each run it has to fund.
    const fees = (Number(fee) / 1e18) * (runs.length + 1)
    expect(shielded).toBeCloseTo(fees + spent, 6)
    expect(shielded).toBeGreaterThan(spent)
  })

  test('adding an output extends the plan', async ({ page }) => {
    await page.getByRole('button', { name: 'Stake on Endur' }).click()

    const outputs = page.getByLabel(/Output \d+ minimum amount/)
    const before = await outputs.count()
    await page.getByRole('button', { name: '+ output' }).click()
    await expect(outputs).toHaveCount(before + 1)
  })

  test('a swap route from AVNU becomes a step beside a stake', async ({ page }) => {
    await page.getByRole('button', { name: /Swap half on AVNU, stake half on Endur/ }).click()

    // Fetched, not written in: the route is a quote at a block. Either the
    // exchange lands in step 1's target, or AVNU said it had no route just
    // then - which it does, intermittently, for this pair at this size. The
    // second is the aggregator's answer and not the page's fault, so it skips
    // with the sentence the page showed rather than failing on it.
    const target = page.getByLabel('Step 1 target')
    const error = page.getByTestId('split-error')
    await expect(target.or(error)).toBeVisible({ timeout: 30_000 })
    await Promise.race([
      expect(target).toHaveValue(/4270219d365d6b017231b52e92b3fb5d7c8378b05e9abc97724537a80e93b0f$/, { timeout: 30_000 }),
      expect(error).toBeVisible({ timeout: 30_000 }),
    ])
    if (await error.count()) {
      const said = await error.innerText()
      test.skip(/no route/i.test(said), `AVNU: ${said}`)
      throw new Error(`the split preset failed for a reason that is not "no route": ${said}`)
    }
    await expect(page.getByLabel('Step 1 selector')).toHaveValue('multi_route_swap')
    // And the stake beside it, in the same plan - the composition nothing else can do.
    await expect(page.getByLabel('Step 2 target')).toHaveValue(/28d709c875c0ceac3dce7065bec5328186dc89fe254527084d1689910954b0a$/)

    // Two outputs, both with a floor: AVNU's own minimum for the USDC leg, so
    // it is a positive number and not a placeholder.
    const floors = page.getByLabel(/Output \d+ minimum amount/)
    await expect(floors).toHaveCount(2)
    expect(Number(await floors.nth(0).inputValue())).toBeGreaterThan(0)

    // The calldata the router will receive names both venues, because both are
    // public calls. The prose tab deliberately does not list addresses, so the
    // felts are where the claim is checked.
    await page.getByRole('button', { name: 'calldata', exact: true }).click()
    await expect(page.locator('pre')).toContainText(
      /0x0?4270219d365d6b017231b52e92b3fb5d7c8378b05e9abc97724537a80e93b0f/,
    )
    await expect(page.locator('pre')).toContainText(
      /0x0?28d709c875c0ceac3dce7065bec5328186dc89fe254527084d1689910954b0a/,
    )
    await expect(page.getByRole('button', { name: 'Dry run', exact: true })).toBeEnabled()
    await expect(page.getByTestId('split-error')).toHaveCount(0)
  })

  /**
   * WebKit reports a cancelled request at console.error, with the text of a CORS
   * failure: "Fetch API cannot load <same-origin url> due to access control
   * checks". It is neither CORS nor an error - it is the composer aborting three
   * in-flight reads because the plan changed under them, which is the behaviour
   * the effects are written to have.
   *
   * The alternative was to stop handing the signal to `fetch`, and the comment
   * beside those effects records why that is not better: without it WebKit logs
   * the abandoned fetch on navigation instead. It logs either way, so the
   * assertion is what has to learn the difference.
   *
   * Not only our own reads. Adding /slides to the header gave Next a fourth link
   * to prefetch, and a preset click cancels those too - the first version of this
   * filter matched `/api/` and missed `/?_rsc=`, `/slides?_rsc=` and the rest,
   * which is how it passed in isolation and failed in a full run. The origin is
   * what has to match, not the path: a real access-control failure against
   * somebody else's host still fails this test.
   */
  /**
   * Matched on its ends rather than with a pattern over the whole line. The
   * first attempt was a regex and it never fired: the runs that passed were the
   * runs where nothing happened to be in flight, which read as a fix for two
   * rounds. Whatever WebKit puts between "load" and the host does not survive
   * being guessed at, so this checks the two stable ends and requires our own
   * host in the middle.
   */
  const cancelledSameOrigin = (text: string) =>
    text.startsWith('Fetch API cannot load') &&
    text.endsWith('due to access control checks.') &&
    (text.includes('127.0.0.1:') || text.includes('localhost:'))

  test('renders without a console error', async ({ page }) => {
    const errors: string[] = []
    page.on('console', (m) => {
      if (m.type() === 'error' && !cancelledSameOrigin(m.text())) errors.push(m.text())
    })
    page.on('pageerror', (e) => errors.push(String(e)))

    await page.reload()
    await settled(page)
    await page.getByRole('button', { name: 'Two deposits, one invoke' }).click()
    expect(errors).toEqual([])
  })
})

test.describe('without a wallet installed', () => {
  test('says so instead of throwing', async ({ page }) => {
    // No extension is injected in this browser, which is exactly what a judge
    // opening the link on a fresh profile will have.
    const crashes: string[] = []
    page.on('pageerror', (e) => crashes.push(String(e)))

    await page.goto('/compose')
    await page.getByRole('button', { name: /^shield · / }).click()

    await expect(page.locator('main')).toContainText(/wallet/i, { timeout: 15_000 })
    expect(crashes).toEqual([])
  })
})

test.describe('what governance owns', () => {
  test('the plan is checked against the bounds the chain reports', async ({ page }) => {
    await page.goto('/compose')
    const params = await json<ParamsResponse>(await page.request.get('/api/params'))

    // Add steps until one over the live bound, then the composer has to refuse
    // with the number it read rather than a number compiled into the SDK.
    await page.getByRole('button', { name: 'Stake on Endur' }).click()
    for (let i = 1; i <= params.maxSteps; i += 1) {
      await page.getByRole('button', { name: '+ step' }).click()
    }

    await expect(page.locator('main')).toContainText(`the router allows ${params.maxSteps}`)
  })

  test('a denied target would be reported, and none is denied today', async ({ page }) => {
    await page.goto('/compose')
    const params = await json<ParamsResponse>(await page.request.get('/api/params'))
    expect(params.paused).toBe(false)

    // Nothing is denied on mainnet right now, so the warning must be absent —
    // a warning that shows unconditionally teaches people to ignore it.
    await expect(page.locator('main')).not.toContainText('Governance has denied')
    await expect(page.locator('main')).not.toContainText('has the router paused')
  })
})

test('typing an address does not fire a request per keystroke', async ({ page }) => {
  const calls: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('/api/params')) calls.push(request.url())
  })

  await page.goto('/compose')
  await settled(page)
  const before = calls.length

  // Every prefix of a felt is a felt, so an undebounced read fires on each of
  // these characters.
  // Typed as fast as the engine will deliver, with no artificial delay.
  //
  // That matters: with a delay between keystrokes the count measures how fast
  // the engine types, not what the debounce does - a threshold tuned on
  // Chromium read 7 requests for 18 characters on WebKit, which is the debounce
  // working and the test asking the wrong question. A burst lands inside one or
  // two windows on any engine, so what is left to measure is the debounce.
  const typed = '0x28d709c875c0ceac'
  await page.getByLabel('Step 1 target').fill('')
  await page.getByLabel('Step 1 target').pressSequentially(typed)
  await page.waitForTimeout(1500)

  const fired = calls.length - before
  expect(fired, `${fired} requests for ${typed.length} characters typed at once`).toBeLessThanOrEqual(3)
})

test.describe('the ballot run', () => {
  test('is refused while no proposal is taking votes', async ({ page }) => {
    await page.goto('/compose')
    await settled(page)

    // A proposal takes votes for about an hour. Offering the button outside
    // that window charges somebody to discover a revert after proving.
    const params = await json<ParamsResponse>(await page.request.get('/api/params'))
    const ballot = page.getByRole('button', { name: /^run · 0\.1 STRK/ })

    if (params.openProposal === null) {
      await expect(ballot).toBeDisabled()
      await expect(page.locator('main')).toContainText('No proposal is taking votes')
      await expect(page.getByRole('link', { name: 'governance page' })).toBeVisible()
    } else {
      await expect(ballot).toBeEnabled()
      await expect(page.locator('main')).toContainText(
        `voting on proposal ${params.openProposal.id}`,
      )
    }
  })

  test('never names a proposal the chain does not have open', async ({ page }) => {
    await page.goto('/compose')
    await settled(page)

    const params = await json<ParamsResponse>(await page.request.get('/api/params'))
    if (params.openProposal === null) return

    // Whatever it names has to be a proposal whose window is still open.
    expect(params.openProposal.blocksLeft).toBeGreaterThan(0)
    await expect(page.locator('main')).toContainText(
      `closes in ${params.openProposal.blocksLeft.toLocaleString()} blocks`,
    )
  })
})

test.describe('the wallet flow', () => {
  test('offers somewhere to go when no wallet is installed', async ({ page }) => {
    // The browser in this suite has no extension, which is exactly what a judge
    // opening the link on a fresh profile has. A dead end here is a dead end
    // for them.
    await page.goto('/compose')
    await settled(page)
    await page.getByRole('button', { name: /^shield · / }).click()

    await expect(page.locator('main')).toContainText(/No Starknet wallet/, { timeout: 20_000 })
    // The demo signs with Ready alone, and says so rather than listing a wallet
    // it has never been run against. Whether Ready can be installed still comes
    // from the library's own discovery list rather than from one written here.
    await expect(page.locator('main')).toContainText(/This demo signs with Ready/)
  })

  test('shows no connection state until there is a connection', async ({ page }) => {
    await page.goto('/compose')
    await settled(page)

    // Nothing is connected, so nothing claims to be - and there is no
    // disconnect button for a connection that does not exist.
    await expect(page.getByRole('button', { name: 'disconnect' })).toHaveCount(0)
  })
})
