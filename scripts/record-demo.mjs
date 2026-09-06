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
import { mkdirSync, readFileSync, renameSync, readdirSync, writeFileSync } from 'node:fs'
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

/**
 * The rectangle an element occupies, as a fraction of the viewport.
 *
 * Measured against a probe pinned to the viewport rather than against
 * `documentElement.clientHeight`: the page is rendered with a CSS `zoom`, and a
 * rect and a clientHeight do not agree about what a pixel is under one. Two
 * rects from the same call always agree.
 */
async function rectOf(page, selector) {
  return page.locator(selector).first().evaluate((el) => {
    const probe = document.createElement('div')
    probe.style.cssText = 'position:fixed;inset:0;pointer-events:none;visibility:hidden'
    document.body.appendChild(probe)
    const v = probe.getBoundingClientRect()
    const r = el.getBoundingClientRect()
    probe.remove()
    return {
      x: (r.left - v.left) / v.width,
      y: (r.top - v.top) / v.height,
      w: r.width / v.width,
      h: r.height / v.height,
    }
  })
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
  'governor-bond': async (page) => {
    await glideTo(page, 'What the router is running on', 3000)
  },
  'governor-redeem': async (page) => {
    await page.locator('#redeem').evaluate((el) => el.scrollIntoView({ behavior: 'smooth', block: 'center' }))
    await wait(1500)
    // A secret nobody staked against, so the panel answers from the chain
    // without spending anything. The lookup is the point, not the redemption.
    const secret = page.getByLabel('Ballot secret')
    await secret.click()
    await secret.pressSequentially('0x03' + 'a'.repeat(61) + '9', { delay: 6 })
    await page.getByRole('button', { name: 'Look it up' }).click()
    await page.getByTestId('ballot-stage').waitFor({ timeout: 40_000 })
  },
  services: async (page) => {
    const panel = page.getByTestId('services')
    await panel.waitFor({ timeout: 40_000 })
    await panel.evaluate((el) => el.scrollIntoView({ behavior: 'smooth', block: 'center' }))
  },
  'verify-manifest': async (page) => {
    const field = page.getByLabel('owner/repo')
    await field.click()
    await field.pressSequentially('PugarHuda/jalin', { delay: 45 })
    await wait(500)
    await page.getByRole('button', { name: 'Read it' }).click()
    // `of 3` was in here, and it stopped matching the day a fourth
    // transaction landed - the shot timed out and the scene recorded a static
    // page. The verdict's shape is stable; its numbers are not.
    const answer = page.getByText(/\d+ of \d+ listed transactions would count/i).first()
    await answer.waitFor({ timeout: 40_000 })
    await answer.evaluate((el) => el.scrollIntoView({ behavior: 'smooth', block: 'center' }))
    await wait(4000)
    await page.evaluate(() => window.scrollBy({ top: 300, behavior: 'smooth' }))
  },
}

const measured = []
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

  /**
   * Where the pointer boxes go, measured rather than guessed.
   *
   * A highlight drawn at coordinates typed into a config file is wrong the
   * first time the layout moves, and nobody notices until the video is
   * rendered. These come from `getBoundingClientRect` on the real element in
   * the real recording, normalised against the viewport so the compositor can
   * scale them to the frame without knowing anything about the zoom.
   *
   * Measured after the shot has finished, while the page is holding still. The
   * compositor never shows a box before `settledAt` for the same reason: a box
   * pinned to an element that is still scrolling points at the wrong thing.
   */
  // `scrollIntoView({behavior:'smooth'})` returns before the scroll finishes,
  // so anything measured on the instant a shot returns is measured mid-glide.
  // Three boxes were dropped as "out of frame" while plainly on screen.
  await wait(1400)

  const settledAt = (Date.now() - started) / 1000
  const marks = []
  for (const target of scene.marks ?? []) {
    try {
      const box = await rectOf(page, target.selector)
      // Off screen: a box at the edge of the frame is worse than no box.
      if (box.y < -0.05 || box.y > 1 || box.w <= 0) {
        console.warn(`  ${scene.id}: ${target.selector} is out of frame, dropped`)
        continue
      }
      marks.push({ ...target, ...box })
    } catch {
      console.warn(`  ${scene.id}: ${target.selector} not found, dropped`)
    }
  }
  measured.push({ id: scene.id, settledAt, marks })

  const hold = scene.duration * 1000 + PAD - (Date.now() - started)
  if (hold > 0) await wait(hold)

  const video = page.video()
  await context.close()
  renameSync(await video.path(), join(out, `${scene.id}.webm`))
  console.log(`${scene.id.padEnd(16)} ${((Date.now() - started) / 1000).toFixed(1)}s recorded`)
}
await browser.close()
writeFileSync(join(work, 'marks.json'), JSON.stringify(measured, null, 1))
console.log(`${measured.reduce((n, m) => n + m.marks.length, 0)} pointer boxes measured`)
console.log(`\n${readdirSync(out).filter((f) => f.endsWith('.webm')).length} clips in ${out}`)
