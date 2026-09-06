import 'server-only'
import { unstable_rethrow } from 'next/navigation'
import { hash, num, shortString } from 'starknet'
import { GOVERNOR_ADDRESS, KINDS, ROUTER_ADDRESS, TOKENS } from './config'
import { rpc } from './rpc'

/**
 * The governor, read from the chain.
 *
 * Every router parameter is owned here rather than by an admin key, which is
 * only worth claiming if somebody can check it. Until this page there was no
 * way to: the contract was deployed, governed and invisible.
 */

type Kind = (typeof KINDS)[number]

interface RouterParams {
  paused: boolean
  maxSteps: number
  maxCalldata: number
  feeBps: number
  feeRecipient: string
}

export type Stage =
  | { name: 'voting'; blocksLeft: number }
  | { name: 'timelocked'; blocksLeft: number }
  | { name: 'executable' }
  | { name: 'rejected'; because: string }
  | { name: 'executed' }

export interface Proposal {
  id: number
  kind: Kind
  kindCode: number
  target: string
  valueA: string
  valueB: string
  /** `value_a` read as a short string when the kind makes that meaningful. */
  label: string | null
  endBlock: number
  eta: number
  yes: bigint
  no: bigint
  executed: boolean
  stage: Stage
  /** Block the Proposed event landed in, so the voting window is measured. */
  proposedAt: number | null
}

interface Stuck {
  symbol: string
  address: string
  amount: bigint
  decimals: number
}

export interface Governance {
  head: number
  /**
   * Tokens sitting on the router. Any balance here makes I4 unsatisfiable for
   * that token, so every future plan touching it reverts until somebody sweeps.
   * Only the tokens the app knows: a contract cannot enumerate its own
   * balances, and neither can this.
   */
  stuck: Stuck[]
  /**
   * Tokens whose balance could not be read at all, by symbol.
   *
   * Separate from `stuck` because an empty `stuck` is a claim - "nothing is
   * wedged" - and a failed read is not evidence for it. The two were the same
   * value here: a `balanceOf` that threw was mapped to null, filtered out, and
   * the page then printed "Nothing stuck. Checked against the 6 tokens this app
   * knows" having checked fewer.
   */
  unreadable: string[]
  /**
   * The governor the router actually reads, from `router.governor()`, and the
   * label the governor has applied to the router, from `label_of`.
   *
   * Both entrypoints existed and neither was read by anything. The first is the
   * whole trust chain of this page in one felt: everything below is the
   * governor's answer, and until this was read there was nothing but an
   * environment variable saying the router listens to it. `docs/deploying.md`
   * told a human to check it by hand with sncast.
   *
   * The label is the other half. `LABEL` is the default kind in the propose
   * form, so it is the most likely proposal a visitor makes, and the applied
   * label was written into storage that no surface displayed.
   */
  bond: { governor: string | null; matches: boolean | null; label: string | null }
  params: RouterParams
  proposals: Proposal[]
  /** eta - endBlock, taken from a real proposal rather than from a config file. */
  timelockBlocks: number | null
  /** endBlock - proposedAt, likewise. */
  votingBlocks: number | null
}

const u = (felt: string | undefined) => BigInt(felt ?? '0x0')

/**
 * A ceiling on the event walk as a whole, not on each request in it.
 *
 * `rpc` gives every single call 15 seconds, and the page count below caps the
 * walk at 20 pages, so the worst case those two agree on is five minutes of a
 * render nobody is going to wait for. That worst case arrived: on a slow public
 * node `/governance` held `page.goto` past its full sixty seconds, and the same
 * request served from the revalidate cache a moment later took two. The dates
 * this walk collects are the softest thing on the page: `proposedAt` is already
 * nullable, and the only thing it feeds is the measured voting window, which the
 * page omits rather than fakes when it is missing. Running out of budget costs
 * that one line; running out of time costs the whole page.
 */
const EVENT_SCAN_BUDGET_MS = 15_000

/**
 * How far below a proposal's `end_block` its `Proposed` event can be.
 *
 * `end_block` is `proposed_at + voting_blocks`, and the governor takes
 * `voting_blocks` at construction with no view to read it back, so the exact
 * distance is not on chain anywhere this page can reach. The live governor was
 * deployed with 2,000, which is a little under a day; 50,000 blocks of room is
 * a couple of weeks of voting and still one or two pages of events, so a
 * governor deployed with a far longer window than this one would still be dated
 * correctly. Too small and the oldest proposal loses its date; too large only
 * costs a page.
 */
const PROPOSAL_LOOKBACK_BLOCKS = 50_000

function stageOf(
  proposal: { endBlock: number; eta: number; yes: bigint; no: bigint; executed: boolean },
  head: number,
): Stage {
  if (proposal.executed) return { name: 'executed' }
  if (head <= proposal.endBlock) return { name: 'voting', blocksLeft: proposal.endBlock - head }

  // Voting is over, so the ballot is decided even while the timelock runs.
  if (proposal.yes <= proposal.no) {
    return {
      name: 'rejected',
      because: proposal.yes === 0n && proposal.no === 0n ? 'nobody voted' : 'more against than for',
    }
  }
  if (head < proposal.eta) return { name: 'timelocked', blocksLeft: proposal.eta - head }

  // Quorum is not exposed as a view, so this cannot promise execution will
  // succeed — only that nothing else stands in its way. See the page.
  return { name: 'executable' }
}

export async function readGovernance(revalidate = 60): Promise<Governance | null> {
  if (!GOVERNOR_ADDRESS) return null

  try {
    const [head, rawParams, rawCount, rawBond, rawLabel] = await Promise.all([
      rpc.blockNumber(revalidate),
      rpc.call(GOVERNOR_ADDRESS, 'params', [], revalidate),
      rpc.call(GOVERNOR_ADDRESS, 'proposal_count', [], revalidate),
      // Both optional: a router that is not deployed, or a governor class
      // without these views, is a page with one less fact rather than no page.
      ROUTER_ADDRESS
        ? rpc.call(ROUTER_ADDRESS, 'governor', [], revalidate).catch(() => null)
        : Promise.resolve(null),
      ROUTER_ADDRESS
        ? rpc.call(GOVERNOR_ADDRESS, 'label_of', [ROUTER_ADDRESS], revalidate).catch(() => null)
        : Promise.resolve(null),
    ])

    const bondGovernor = rawBond?.[0] ? num.toHex(u(rawBond[0])) : null
    const labelFelt = rawLabel?.[0] ? u(rawLabel[0]) : 0n
    const bond = {
      governor: bondGovernor,
      matches: bondGovernor === null ? null : BigInt(bondGovernor) === BigInt(GOVERNOR_ADDRESS),
      label: labelFelt === 0n ? null : readShortString(num.toHex(labelFelt)),
    }

    const params: RouterParams = {
      paused: u(rawParams[0]) !== 0n,
      maxSteps: Number(u(rawParams[1])),
      maxCalldata: Number(u(rawParams[2])),
      feeBps: Number(u(rawParams[3])),
      feeRecipient: num.toHex(u(rawParams[4])),
    }

    const count = Number(u(rawCount[0]))
    const ids = Array.from({ length: count }, (_, i) => i + 1)

    // One request per proposal, all at once. Awaiting them in a loop made the
    // page's latency the sum of every proposal's round trip - the N+1 shape,
    // with the network as the query - and under parallel test load that was
    // enough for the server to stop answering.
    const raws = await Promise.all(
      ids.map((id) => rpc.call(GOVERNOR_ADDRESS, 'get_proposal', [BigInt(id)], revalidate)),
    )

    // When each proposal was made, so the voting window is measured rather than
    // copied out of the deploy script.
    //
    // The range is anchored to the proposals themselves, not to today. It used
    // to start at `head - 600_000`, and a window measured backwards from the
    // chain head walks off the oldest proposal the moment the chain outgrows
    // it: proposal 1 was made in block 13,771,935, and by 6 September that
    // window began at 13,843,257. The page was reading a governor whose first
    // proposal it could no longer see, so the measured voting window vanished
    // and all three engines failed the test that asks for it. Every `Proposed`
    // sits below its own `end_block`, so the earliest end_block bounds the
    // search from beneath and the latest bounds it from above - a range that
    // stays the same size as the chain grows rather than sliding off the
    // history it is meant to cover.
    //
    // Paginated, because a wide range returns an empty first chunk and a
    // continuation token rather than the events. Reading only that chunk is how
    // this quietly answered "no proposals were ever made".
    /**
     * Started here, awaited below, because it needs nothing the event walk
     * produces and the walk is the slowest thing on this page. In series the
     * two of them plus the reads above added up to a render that could reach
     * the sixty seconds `page.goto` allows it, which is the timeout this
     * suite's Firefox failures keep landing on.
     *
     * The first proposal, not the newest, because `proposals` is reversed
     * below. A donation to the router wedges every future plan touching that
     * token. The threat model describes the escape hatch; this is what makes it
     * reachable, and reads zero when there is nothing to reach for.
     */
    const balancesPromise = ROUTER_ADDRESS
      ? Promise.all(
          TOKENS.map(async (token) => {
            try {
              const balance = await rpc.call(
                token.address,
                'balanceOf',
                [ROUTER_ADDRESS],
                revalidate,
              )
              return { token, amount: u(balance[0]) + (u(balance[1]) << 128n) }
            } catch {
              // One unreadable token must not take the whole page with it - but
              // it must not vanish either. The symbol travels so the page can
              // name what it did not manage to check.
              return { token, amount: null }
            }
          }),
        )
      : Promise.resolve([] as { token: (typeof TOKENS)[number]; amount: bigint | null }[])

    const endBlocks = raws.map((raw) => Number(u(raw[4])))
    const proposedAt = new Map<number, number>()

    if (endBlocks.length > 0) {
      const from = Math.max(0, Math.min(...endBlocks) - PROPOSAL_LOOKBACK_BLOCKS)
      // An open proposal's end_block is in the future, and a node will not take
      // a to_block it has not mined.
      const to = Math.min(Math.max(...endBlocks), head)
      let cursor: string | undefined
      let pages = 0
      const scanUntil = Date.now() + EVENT_SCAN_BUDGET_MS

      while (pages < 20 && Date.now() < scanUntil) {
        const page = await rpc.events(
          {
            address: GOVERNOR_ADDRESS,
            keys: [[num.toHex(hash.starknetKeccak('Proposed'))]],
            from_block: { block_number: from },
            to_block: { block_number: to },
            chunk_size: 100,
            ...(cursor ? { continuation_token: cursor } : {}),
          },
          revalidate,
        )

        for (const event of page.events ?? []) {
          const id = Number(u(event.keys[1]))
          if (id > 0 && event.block_number) proposedAt.set(id, event.block_number)
        }

        cursor = page.continuation_token
        pages += 1
        if (!cursor) break

        /**
         * Every proposal has been dated, so the pages after this one hold
         * nothing this loop wants.
         *
         * Without it the walk runs to the end of the range whatever it has
         * already found, and over a range that sparse most of those requests
         * come back empty with a continuation token - the shape the comment
         * above warns about, paid for on every cold render. Three browser
         * engines asking at once was enough to make `/governance` exceed a 60
         * second `page.goto` and take a11y, responsive and contrast down with
         * it.
         *
         * `count` is the governor's own `proposal_count`, so this stops when
         * the chain says it is finished rather than when a number here says so.
         */
        if (proposedAt.size >= count) break
      }
    }

    const proposals: Proposal[] = []
    for (const [index, id] of ids.entries()) {
      const raw = raws[index]!
      const kindCode = Number(u(raw[0]))
      const valueA = num.toHex(u(raw[2]))

      const core = {
        endBlock: Number(u(raw[4])),
        eta: Number(u(raw[5])),
        yes: u(raw[6]),
        no: u(raw[7]),
        executed: u(raw[8]) !== 0n,
      }

      proposals.push({
        id,
        kindCode,
        kind: KINDS[kindCode] ?? 'label',
        target: num.toHex(u(raw[1])),
        valueA,
        valueB: num.toHex(u(raw[3])),
        label: kindCode === 4 ? readShortString(valueA) : null,
        ...core,
        stage: stageOf(core, head),
        proposedAt: proposedAt.get(id) ?? null,
      })
    }

    const balances = await balancesPromise

    const stuck: Stuck[] = balances
      .filter((entry) => entry.amount !== null && entry.amount > 0n)
      .map((entry) => ({
        symbol: entry.token.symbol,
        address: entry.token.address,
        amount: entry.amount!,
        decimals: entry.token.decimals,
      }))

    const unreadable = balances
      .filter((entry) => entry.amount === null)
      .map((entry) => entry.token.symbol)

    const sample = proposals[0]
    return {
      head,
      stuck,
      unreadable,
      bond,
      params,
      proposals: proposals.reverse(),
      timelockBlocks: sample ? sample.eta - sample.endBlock : null,
      votingBlocks: sample?.proposedAt ? sample.endBlock - sample.proposedAt : null,
    }
  } catch (error) {
    // Next signals "this route is dynamic" by throwing. Swallowing that leaves
    // it thinking the page is static, and it ships this function's failure
    // fallback as the prerendered HTML - which is how /governance shipped
    // "could not be read" to every first visitor.
    unstable_rethrow(error)
    return null
  }
}

/** A felt that is really text, or null when it plainly is not. */
function readShortString(felt: string): string | null {
  try {
    const decoded = shortString.decodeShortString(felt)
    return /^[\x20-\x7e]+$/.test(decoded) ? decoded : null
  } catch (error) {
    // Next signals "this route is dynamic" by throwing. Swallowing that leaves
    // it thinking the page is static, and it ships this function's failure
    // fallback as the prerendered HTML - which is how /governance shipped
    // "could not be read" to every first visitor.
    unstable_rethrow(error)
    return null
  }
}
