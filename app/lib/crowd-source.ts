import 'server-only'
import { unstable_rethrow } from 'next/navigation'
import { hash, num } from 'starknet'
import {
  countDepositors,
  measureCells,
  measurePeriods,
  summariseCells,
  type Crowd,
  type CellSummary,
  type Period,
  type PoolEvent,
} from 'jalin-sdk'
import { POOL_ADDRESS } from './config'
import { rpc } from './rpc'

/**
 * Reads the pool's deposits and counts the crowd.
 *
 * Lives here rather than in the route so both the route and the landing page can
 * call it directly. The landing used to fetch its own /api/crowd over HTTP,
 * building the URL from the incoming Host header — which is attacker-controlled,
 * so a request carrying `Host: elsewhere` had the server fetch elsewhere and
 * render the answer. Calling the function removes the request, and with it the
 * whole class of problem.
 */

/**
 * The recent crowd, not the pool's whole history - and this comment said the
 * opposite until someone checked.
 *
 * The pool's contract has been on chain since block 8,978,970. On 6 September
 * the head was 14,443,446, so its life is five and a half million blocks and
 * this window is eleven days of it: 506 deposits from 214 addresses inside the
 * window against 994 and 699 behind it, and the walk from the deployment block
 * hits the ten page cap before it finishes counting.
 *
 * A window is still the right shape - what protects a deposit is the crowd it
 * can plausibly be confused with, and an address that shielded in June is not
 * that crowd. What was wrong was calling it the pool. Everything reading this
 * number now says which window it counted.
 *
 * It used to be 50k, which is under a day - a window that made the crowd look
 * like whoever happened to be around this afternoon.
 */
const CROWD_WINDOW_BLOCKS = 600_000

/** Relays gasless pool transactions; its deposits are not a person arriving. */
const PAYMASTER = BigInt('0x127021a1b5a52d3174c2ab077c2b043c80369250d29428cee956d76ee51584f')

const MAX_PAGES = 10

/**
 * A ceiling on the deposit walk as a whole, the way `readGovernance` has one.
 *
 * Ten pages, each capped at 15 seconds by `rpc` and now each allowed one retry,
 * is a worst case of five minutes for a page render whose test gives up at
 * sixty seconds - and `page.goto` dying at exactly 1.0 minute on Firefox, then
 * passing in 1.5 on the retry, has been the most persistent failure in this
 * suite. The retry above is what makes a stalled chunk survivable; this is what
 * stops the survival from costing more than the failure did. A walk that runs
 * out of budget reports a floor, which the page already knows how to say.
 */
const DEPOSIT_SCAN_BUDGET_MS = 20_000


export interface CrowdReading extends Crowd {
  windowBlocks: number
  head: number
  /**
   * True when the page cap was reached and there were still events left. The
   * count is then a floor, not a total, and the page has to say so - a silent
   * cap reads as "we counted everything" when it did not.
   */
  truncated: boolean
  /**
   * The number that actually describes a deposit. `depositors` is the pool's
   * headcount, which is not the crowd anyone hides in: an observer of the
   * public leg sees asset, magnitude and roughly when, so only deposits
   * agreeing on all three hide each other.
   */
  cells: CellSummary
  /** The same measurement per six-hour slot, oldest first. */
  periods: Period[]
}

export interface DepositReading {
  events: PoolEvent[]
  head: number
  truncated: boolean
  feeCollector?: string
}

/** Every Deposit in the window, read once so callers do not each fetch them. */
export async function readDeposits(revalidate = 300): Promise<DepositReading | null> {
  try {
    const head = await rpc.blockNumber(revalidate)
    const selector = num.toHex(hash.starknetKeccak('Deposit'))

    // Read the fee collector rather than hardcoding it, so the exclusion stays
    // right if governance moves it.
    const collector = await rpc.call(POOL_ADDRESS, 'get_fee_collector', [], revalidate)

    const events: PoolEvent[] = []
    let token: string | undefined
    let pages = 0

    /**
     * A page that fails is not a crowd that failed.
     *
     * This walk used to be one `try` around the whole function, so a single
     * slow chunk - the node taking longer than the 15 second cap on one request
     * out of eight - threw away every deposit already counted and the landing
     * page lost its headcount, its median and the trend chart with it. That
     * happened on a rerun of an unchanged commit: two tests failed twice each,
     * both of them about a crowd the page could no longer describe.
     *
     * One retry, because the node answers the second ask in a couple of seconds
     * about as often as it stalls on the first. After that the walk keeps what
     * it has and says it is a floor, which is the same thing it already says
     * when it runs out of pages.
     */
    let stalled = false
    const scanUntil = Date.now() + DEPOSIT_SCAN_BUDGET_MS

    while (pages < MAX_PAGES && Date.now() < scanUntil) {
      let page: Awaited<ReturnType<typeof rpc.events>> | null = null

      for (const attempt of [0, 1]) {
        try {
          page = await rpc.events(
            {
              address: POOL_ADDRESS,
              keys: [[selector]],
              from_block: { block_number: Math.max(0, head - CROWD_WINDOW_BLOCKS) },
              to_block: 'latest',
              chunk_size: 1000,
              ...(token ? { continuation_token: token } : {}),
            },
            revalidate,
          )
          break
        } catch (error) {
          unstable_rethrow(error)
          if (attempt === 1) stalled = true
        }
      }

      if (stalled || !page?.events) break
      events.push(...(page.events as PoolEvent[]))
      token = page.continuation_token
      pages += 1
      if (!token) break
    }
    const truncated = stalled || Boolean(token)

    return { events, head, truncated, feeCollector: collector?.[0] }
  } catch (error) {
    // Next signals "this route is dynamic" by throwing. Swallowing that leaves
    // it thinking the page is static, and it ships this function's failure
    // fallback as the prerendered HTML - which is how /governance shipped
    // "could not be read" to every first visitor.
    unstable_rethrow(error)
    return null
  }
}

export async function readCrowd(revalidate = 300): Promise<CrowdReading | null> {
  const reading = await readDeposits(revalidate)
  if (!reading) return null

  const crowd = countDepositors(reading.events, {
    paymaster: num.toHex(PAYMASTER),
    feeCollector: reading.feeCollector,
  })

  const cells = measureCells(reading.events)

  return {
    ...crowd,
    windowBlocks: CROWD_WINDOW_BLOCKS,
    head: reading.head,
    truncated: reading.truncated,
    cells: summariseCells(cells),
    periods: measurePeriods(cells),
  }
}
