import { expect, test } from '@playwright/test'

/** Real, permanent: a pool deposit that went through nobody's router. */
const POOL_TX = '0x6abbe003a51a29b634d8615517d231d469f3e009b4a1289a0e701efef057779'
const ROUTER = '0x008498d79ca390b34a6416cc45fb375ad9b921eefd8d4531d99a2d775feb3a7e'

test.describe('verify', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/verify')
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
