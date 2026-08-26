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
  params: RouterParams
  proposals: Proposal[]
  /** eta - endBlock, taken from a real proposal rather than from a config file. */
  timelockBlocks: number | null
  /** endBlock - proposedAt, likewise. */
  votingBlocks: number | null
}

const u = (felt: string | undefined) => BigInt(felt ?? '0x0')

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
    const [head, rawParams, rawCount] = await Promise.all([
      rpc.blockNumber(revalidate),
      rpc.call(GOVERNOR_ADDRESS, 'params', [], revalidate),
      rpc.call(GOVERNOR_ADDRESS, 'proposal_count', [], revalidate),
    ])

    const params: RouterParams = {
      paused: u(rawParams[0]) !== 0n,
      maxSteps: Number(u(rawParams[1])),
      maxCalldata: Number(u(rawParams[2])),
      feeBps: Number(u(rawParams[3])),
      feeRecipient: num.toHex(u(rawParams[4])),
    }

    const count = Number(u(rawCount[0]))
    const ids = Array.from({ length: count }, (_, i) => i + 1)

    // When each proposal was made, so the voting window is measured rather than
    // copied out of the deploy script.
    // Paginated, because a wide range returns an empty first chunk and a
    // continuation token rather than the events. Reading only that chunk is how
    // this quietly answered "no proposals were ever made".
    const proposedAt = new Map<number, number>()
    let cursor: string | undefined
    let pages = 0

    while (pages < 20) {
      const page = await rpc.events(
        {
          address: GOVERNOR_ADDRESS,
          keys: [[num.toHex(hash.starknetKeccak('Proposed'))]],
          from_block: { block_number: Math.max(0, head - 600_000) },
          to_block: 'latest',
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
    }

    // One request per proposal, all at once. Awaiting them in a loop made the
    // page's latency the sum of every proposal's round trip - the N+1 shape,
    // with the network as the query - and under parallel test load that was
    // enough for the server to stop answering.
    const raws = await Promise.all(
      ids.map((id) => rpc.call(GOVERNOR_ADDRESS, 'get_proposal', [BigInt(id)], revalidate)),
    )

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

    // The first proposal, not the newest, because `proposals` is reversed below.
    // A donation to the router wedges every future plan touching that token.
    // The threat model describes the escape hatch; this is what makes it
    // reachable, and reads zero when there is nothing to reach for.
    const balances = ROUTER_ADDRESS
      ? await Promise.all(
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
              // One unreadable token must not take the whole page with it.
              return null
            }
          }),
        )
      : []

    const stuck: Stuck[] = balances
      .filter((entry) => entry !== null && entry.amount > 0n)
      .map((entry) => ({
        symbol: entry!.token.symbol,
        address: entry!.token.address,
        amount: entry!.amount,
        decimals: entry!.token.decimals,
      }))

    const sample = proposals[0]
    return {
      head,
      stuck,
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
