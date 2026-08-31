import { expect, test } from '@playwright/test'
import { settled } from './settled'

/**
 * The wallet surface, from a browser with no wallet in it.
 *
 * That is the one thing this suite cannot have: a private key. So every test
 * here stops where the wallet would take over and asserts what the page does
 * up to that line - which buttons exist, what each one asks for, and that
 * nothing on the page invents a number the wallet has not given it. A balance,
 * a commitment or a dry-run result rendered without a wallet would be a fixture
 * wearing the clothes of a feature, and there is none.
 */
test.describe('the wallet surface', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/compose')
    await settled(page)
  })

  test('offers to connect before anything is signed', async ({ page }) => {
    const connect = page.getByRole('button', { name: 'connect Ready' })
    await expect(connect).toBeVisible()
    await connect.click()

    // The same honest sentence every other button gives on a wallet-less
    // browser, and rendered at the header where the click was.
    await expect(page.locator('main')).toContainText(/This demo signs with Ready/, {
      timeout: 20_000,
    })
  })

  test('shows no shielded balance and no shadow account until a wallet has said so', async ({
    page,
  }) => {
    // Both panels are gated on the wallet's own answers. With no wallet there
    // is no answer, so there is no panel - not an empty one, not a placeholder.
    await expect(page.getByTestId('shielded')).toHaveCount(0)
    await expect(page.getByTestId('shadow')).toHaveCount(0)
    await expect(page.locator('main')).not.toContainText(/partial commitment/)
  })

  test('every run can be dry-run, and the draft plan too', async ({ page }) => {
    const dryRuns = page.getByRole('button', { name: /^dry run$/i })
    // The ballot and the editor's own. It was four while two of the runs were
    // the presets under numbers.
    await expect(dryRuns).toHaveCount(2)

    // The draft's dry run is live: the default preset is a complete plan.
    // `exact`, because role names match case-insensitively by substring and
    // the ballot's button is also called "dry run".
    await expect(page.getByRole('button', { name: 'Dry run', exact: true })).toBeEnabled()

    // The ballot's exists. Whether it is enabled follows the chain - a
    // proposal has to be taking votes - so that is asserted where the ballot
    // is tested, not here.
    await expect(page.getByRole('button', { name: 'dry run', exact: true })).toHaveCount(1)
  })

  test('a dry run asks for a wallet and says what it would assemble', async ({ page }) => {
    await page.getByRole('button', { name: 'Dry run', exact: true }).click()

    /**
     * No wallet, so the request stops at the picker's honest answer - and it
     * lands under the thing that asked rather than anywhere on the page. This
     * used to press the first numbered run's dry run; that run was a preset
     * under a number and went, and the ballot that replaced it as "first" is
     * gated on a proposal being open, which would have made this test follow
     * the chain instead of the wiring.
     */
    await expect(page.getByTestId('asked-draft')).toContainText(
      /This demo signs with Ready/,
      { timeout: 20_000 },
    )
    await expect(page.getByTestId('dry-run')).toHaveCount(0)
  })

  test('a background read that drops twice is tried a third time, and one that keeps dropping says so', async ({
    page,
  }) => {
    // Two connection failures, then the real answer. The page used to give up
    // on the first and leave the shield button reading "reading the pool fee…"
    // for the rest of the visit - a spinner for a read that had already failed.
    let attempts = 0
    await page.route('**/api/params**', async (route) => {
      attempts += 1
      if (attempts <= 2) return route.abort('connectionfailed')
      return route.continue()
    })
    await page.goto('/compose')
    await settled(page)

    const shield = page.getByRole('button', { name: /^shield · / })
    await expect(shield).toBeEnabled({ timeout: 30_000 })
    expect(attempts).toBeGreaterThanOrEqual(3)

    // And when every attempt drops, the button says the read failed rather than
    // that it is still reading.
    await page.unroute('**/api/params**')
    await page.route('**/api/params**', (route) => route.abort('connectionfailed'))
    await page.goto('/compose')
    await settled(page)
    await expect(page.getByRole('button', { name: /could not be read/ })).toBeVisible({ timeout: 30_000 })
  })

  test('a keyboard alone reaches a run and gets the same answer', async ({ page }) => {
    // Tab until the first dry-run button has focus, press Enter, and the
    // wallet's answer lands under that run - the same path a mouse takes, with
    // nothing on it that needs a pointer. Bounded, because a page that needs
    // more than a hundred tabs to reach its first action has a different bug.
    const target = page.getByRole('button', { name: 'Dry run', exact: true })
    for (let i = 0; i < 120; i += 1) {
      await page.keyboard.press('Tab')
      if (await target.evaluate((el) => el === document.activeElement)) break
    }
    await expect(target).toBeFocused()
    await page.keyboard.press('Enter')

    await expect(page.getByTestId('asked-draft')).toContainText(
      /This demo signs with Ready/,
      { timeout: 20_000 },
    )
  })

  test('the run buttons are not gated on a balance nobody has read', async ({ page }) => {
    // Without a wallet the page knows nothing about the account, so it must
    // not claim a shortfall. The gate only closes on the wallet's numbers.
    await expect(page.locator('main')).not.toContainText(/Short by/)

    // The shield, because it is the one button here that no chain condition
    // gates - the ballot needs an open proposal, so its state says nothing
    // about whether a balance was assumed.
    await expect(page.getByRole('button', { name: /^shield · / })).toBeEnabled()
  })
})
