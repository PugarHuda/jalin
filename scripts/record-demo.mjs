/**
 * Record the demo video against the deployed app.
 *
 * The footage is the real product on its real URL, driven by the same selectors
 * the end-to-end suite uses. Nothing here is staged: the transaction it checks
 * is one this project actually sent to Starknet mainnet, and the verdict on
 * screen is computed from the chain while the recording runs.
 *
 * One browser context per scene, because Playwright writes one video per
 * context. Each runs a little longer than its narration and is trimmed to the
 * exact audio length when the scenes are joined, so a slow network shifts a cut
 * rather than desynchronising the voice.
 *
 *   node scripts/record-demo.mjs <work-dir> [baseURL]
 *
 * <work-dir> holds timed.json, written by the voiceover step.
 */
import { chromium } from '@playwright/test'
import { mkdirSync, readFileSync, renameSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const work = process.argv[2]
const base = process.argv[3] ?? 'https://jalin-five.vercel.app'
if (!work) throw new Error('usage: node scripts/record-demo.mjs <work-dir> [baseURL]')

const scenes = JSON.parse(readFileSync(join(work, 'timed.json'), 'utf8'))
const out = join(work, 'clips')
mkdirSync(out, { recursive: true })

/** A real mainnet transaction of this project's, listed in strk20.json. */
const HASH = '0x060a25127edcca8a5f310fa711c1566dd39c688c8b30406d7482388d715ed311'
const SIZE = { width: 1920, height: 1080 }

/**
 * The page is a centred column. Left alone at this viewport it fills a third of
 * the frame with body text at fourteen pixels, which is a demo nobody can read.
 * Zooming the document renders the same layout half again as large and still
 * natively, where a smaller capture upscaled afterwards would only be soft.
 * deviceScaleFactor does not do this: the recorder matches the CSS viewport, so
 * it just parks a small picture in the corner of a large canvas.
 */
const ZOOM = 1.5
const PAD = 2000

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

/** Scroll so a heading sits a third down the screen, slowly enough to read. */
async function glideTo(page, text, ms = 2500) {
  await page.evaluate(
    async ([needle, duration]) => {
      const target = [...document.querySelectorAll('h1,h2,h3')].find((h) =>
        h.textContent?.toLowerCase().includes(needle.toLowerCase()),
      )
      if (!target) return
      const to = window.scrollY + target.getBoundingClientRect().top - window.innerHeight / 3
      const from = window.scrollY
      const start = performance.now()
      await new Promise((done) => {
        const step = (now) => {
          const p = Math.min(1, (now - start) / duration)
          // ease-in-out, so the scroll starts and stops without a jerk
          const e = p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2
          window.scrollTo(0, from + (to - from) * e)
          if (p < 1) requestAnimationFrame(step)
          else done()
        }
        requestAnimationFrame(step)
      })
    },
    [text, ms],
  )
}

const shots = {
  hero: async (page) => {
    await wait(2000)
    await page.evaluate(() => window.scrollBy({ top: 220, behavior: 'smooth' }))
  },
  constraint: async (page) => {
    await glideTo(page, 'The constraint', 3000)
  },
  plan: async (page) => {
    await glideTo(page, 'A plan, not a parameter list', 3000)
  },
  composer: async (page) => {
    await page.getByRole('button', { name: 'Stake on Endur' }).click()
    await wait(2500)
    await page.getByRole('button', { name: '+ step' }).click()
  },
  'composer-detail': async (page) => {
    await page.getByRole('button', { name: 'Stake on Endur' }).click()
    await wait(2000)
    await page.getByRole('button', { name: 'calldata', exact: true }).click()
    await wait(1200)
    await page
      .locator('pre')
      .first()
      .evaluate((el) => el.scrollIntoView({ behavior: 'smooth', block: 'center' }))
  },
  'verify-hash': async (page) => {
    const field = page.getByLabel('transaction hashes')
    await field.click()
    // Typed rather than filled, so the recording shows a person using it.
    await field.pressSequentially(HASH, { delay: 12 })
    await wait(700)
    await page.getByRole('button', { name: 'Check' }).click()
    const verdict = page.getByText(/would count/).first()
    await verdict.waitFor({ timeout: 30_000 })
    // The verdict is the point of the scene and the zoom puts it below the fold.
    await verdict.evaluate((el) => el.scrollIntoView({ behavior: 'smooth', block: 'center' }))
  },
  'verify-manifest': async (page) => {
    const field = page.getByLabel('owner/repo')
    await field.click()
    await field.pressSequentially('PugarHuda/jalin', { delay: 45 })
    await wait(500)
    await page.getByRole('button', { name: 'Read it' }).click()
    const answer = page.getByText(/counted|of 3/i).first()
    await answer.waitFor({ timeout: 40_000 })
    await answer.evaluate((el) => el.scrollIntoView({ behavior: 'smooth', block: 'center' }))
    await wait(4000)
    await page.evaluate(() => window.scrollBy({ top: 300, behavior: 'smooth' }))
  },
}

const browser = await chromium.launch()
for (const scene of scenes) {
  const started = Date.now()
  const context = await browser.newContext({
    viewport: SIZE,
    recordVideo: { dir: out, size: SIZE },
    deviceScaleFactor: 1,
    reducedMotion: 'no-preference',
  })
  const page = await context.newPage()
  await page.goto(base + scene.url, { waitUntil: 'networkidle', timeout: 60_000 })
  await page.evaluate((z) => { document.documentElement.style.zoom = String(z) }, ZOOM)

  try {
    await shots[scene.shot](page)
  } catch (error) {
    // A shot that cannot run is a scene of a static page, not a failed render.
    console.warn(`  ${scene.id}: ${scene.shot} did not complete - ${error.message.split('\n')[0]}`)
  }

  const hold = scene.duration * 1000 + PAD - (Date.now() - started)
  if (hold > 0) await wait(hold)

  const video = page.video()
  await context.close()
  renameSync(await video.path(), join(out, `${scene.id}.webm`))
  console.log(`${scene.id.padEnd(16)} ${((Date.now() - started) / 1000).toFixed(1)}s recorded`)
}
await browser.close()
console.log(`\n${readdirSync(out).filter((f) => f.endsWith('.webm')).length} clips in ${out}`)
