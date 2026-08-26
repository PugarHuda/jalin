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

    // Our own manifest: two contracts declared, no transactions listed yet.
    await expect(page.getByText(/listed transactions would count/)).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('main')).toContainText('2 contracts declared')
    await expect(page.locator('main')).toContainText('the sprint asks for three')
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
