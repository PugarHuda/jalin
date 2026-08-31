import 'server-only'
import { unstable_rethrow } from 'next/navigation'
import { GOVERNOR_ADDRESS, ROUTER_ADDRESS } from './config'
import { readCrowd } from './crowd-source'
import { rpc } from './rpc'

/**
 * Live contract state, read on the server.
 *
 * The RPC URL stays server-side: it carries an API key, and a key in
 * NEXT_PUBLIC_ is a key anyone can lift out of the bundle and spend. Reads
 * happen on request rather than at build, so the page shows what the contracts
 * say now and not what they said when it was compiled.
 */

/** A read that answers null instead of throwing: a page still has a thesis. */
async function read(contract: string, entrypoint: string): Promise<string[] | null> {
  if (!contract) return null
  try {
    return await rpc.call(contract, entrypoint, [], 60)
  } catch (error) {
    unstable_rethrow(error)
    return null
  }
}

export interface ChainState {
  plansExecuted: number | null
  proposalCount: number | null
  depositors: number | null
  /** The crowd count hit the page cap, so it is a floor rather than a total. */
  depositorsAreAFloor: boolean
  /** Median effective anonymity set across every cell. Null if unreadable. */
  medianEffectiveSet: number | null
  /** Share of cells holding exactly one depositor. */
  aloneShare: number | null
  /** The biggest crowd anywhere in the pool. */
  largestEffectiveSet: number | null
  /** Median effective set per six-hour slot, oldest first. */
  periods: { fromBlock: number; medianEffectiveSet: number; bestEffectiveSet: number }[]
  /**
   * The head these reads were made against.
   *
   * Without it the page said the figures were read "when this page was served",
   * which is true of the render and reads as "now" to somebody who does not know
   * the route revalidates every sixty seconds. A block number is checkable, and
   * a reader who wants to can go and read the same call at the same height.
   */
  blockHeight: number | null
  reachable: boolean
}

export async function readChainState(): Promise<ChainState> {
  const [plans, proposals, crowd, head] = await Promise.all([
    read(ROUTER_ADDRESS, 'plans_executed'),
    read(GOVERNOR_ADDRESS, 'proposal_count'),
    readCrowd(),
    rpc.blockNumber(60).catch((error: unknown) => {
      unstable_rethrow(error)
      return null
    }),
  ])
  return {
    plansExecuted: plans?.[0] ? Number(BigInt(plans[0])) : null,
    proposalCount: proposals?.[0] ? Number(BigInt(proposals[0])) : null,
    depositors: crowd?.depositors ?? null,
    depositorsAreAFloor: crowd?.truncated ?? false,
    medianEffectiveSet: crowd?.cells.medianEffectiveSet ?? null,
    aloneShare: crowd?.cells.aloneShare ?? null,
    largestEffectiveSet: crowd?.cells.largestEffectiveSet ?? null,
    periods: crowd?.periods ?? [],
    blockHeight: head,
    reachable: plans !== null || proposals !== null,
  }
}
