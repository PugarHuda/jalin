import 'server-only'
import { hash, num } from 'starknet'
import {
  countDepositors,
  measureCells,
  summariseCells,
  type Crowd,
  type CellSummary,
  type PoolEvent,
} from '@jalin/sdk'
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
 * Roughly the pool's whole life. Starknet mainnet averages 1.68s a block, so
 * 600k blocks is about eleven days and the pool opened on 14 August 2026.
 *
 * It used to be 50k, which is under a day - a window that made the crowd look
 * like whoever happened to be around this afternoon. All of it fits in one
 * page: 343 deposits so far.
 */
export const CROWD_WINDOW_BLOCKS = 600_000

/** Relays gasless pool transactions; its deposits are not a person arriving. */
const PAYMASTER = BigInt('0x127021a1b5a52d3174c2ab077c2b043c80369250d29428cee956d76ee51584f')

const MAX_PAGES = 10


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
    const head = await rpc.blockNumber()
    const selector = num.toHex(hash.starknetKeccak('Deposit'))

    // Read the fee collector rather than hardcoding it, so the exclusion stays
    // right if governance moves it.
    const collector = await rpc.call(POOL_ADDRESS, 'get_fee_collector', [], revalidate)

    const events: PoolEvent[] = []
    let token: string | undefined
    let pages = 0

    while (pages < MAX_PAGES) {
      const page = await rpc.events(
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

      if (!page?.events) break
      events.push(...(page.events as PoolEvent[]))
      token = page.continuation_token
      pages += 1
      if (!token) break
    }
    const truncated = Boolean(token)

    return { events, head, truncated, feeCollector: collector?.[0] }
  } catch {
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

  return {
    ...crowd,
    windowBlocks: CROWD_WINDOW_BLOCKS,
    head: reading.head,
    truncated: reading.truncated,
    cells: summariseCells(measureCells(reading.events)),
  }
}
