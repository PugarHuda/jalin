import { hash, num } from 'starknet'
import { countDepositors, type PoolEvent } from '@jalin/sdk'
import { POOL_ADDRESS } from '@/lib/config'

/**
 * How big the crowd actually is.
 *
 * Every privacy tool says "your anonymity depends on the size of the set" and
 * then leaves you to guess the number. It is on chain: shielding is public, so
 * the distinct addresses that shielded recently are the people you are standing
 * among.
 *
 * Counted from Deposit, not Withdrawal, and that distinction is the whole
 * subtlety. Two kinds of withdrawal have nothing to do with anyone leaving:
 *
 *  - the fee leg. Every pool transaction pays the fee collector, which emits a
 *    Withdrawal naming it. Reported by Shoal on
 *    starkience/strk20-hackathon#121, where a first pass counted 334
 *    "atomic shield and unshield" transactions that were all fee payments.
 *  - the gas leg. On this pool most withdrawals name the paymaster that relays
 *    gasless transactions, not a person. Found while checking the above: the
 *    recipient sits in keys[1], and filtering the fee collector alone removed
 *    nothing at all.
 *
 * A withdrawal only means someone left if its destination is a person, so this
 * counts arrivals instead, where the address is unambiguously the depositor.
 */
export const revalidate = 300

const WINDOW_BLOCKS = 50_000

/** Relays gasless pool transactions; its withdrawals are gas, not exits. */
const PAYMASTER = BigInt('0x127021a1b5a52d3174c2ab077c2b043c80369250d29428cee956d76ee51584f')

async function rpc(rpcUrl: string, method: string, params: unknown) {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: 1, jsonrpc: '2.0', method, params }),
    next: { revalidate },
  })
  const body = (await response.json()) as { result?: unknown }
  return body.result
}

export async function GET() {
  const rpcUrl = process.env.STARKNET_RPC_URL
  if (!rpcUrl) return Response.json({ error: 'no rpc configured' }, { status: 503 })

  try {
    const head = (await rpc(rpcUrl, 'starknet_blockNumber', {})) as number
    const selector = num.toHex(hash.starknetKeccak('Deposit'))

    // Read the fee collector rather than hardcoding it, so the exclusion stays
    // right if governance moves it.
    const collectorResult = (await rpc(rpcUrl, 'starknet_call', {
      block_id: 'latest',
      request: {
        contract_address: POOL_ADDRESS,
        entry_point_selector: hash.getSelectorFromName('get_fee_collector'),
        calldata: [],
      },
    })) as string[] | undefined
    const feeCollector = collectorResult?.[0]

    const events: PoolEvent[] = []
    let token: string | undefined
    let pages = 0

    while (pages < 10) {
      const page = (await rpc(rpcUrl, 'starknet_getEvents', {
        filter: {
          address: POOL_ADDRESS,
          keys: [[selector]],
          from_block: { block_number: Math.max(0, head - WINDOW_BLOCKS) },
          to_block: 'latest',
          chunk_size: 1000,
          ...(token ? { continuation_token: token } : {}),
        },
      })) as { events?: { keys: string[] }[]; continuation_token?: string } | undefined

      if (!page?.events) break
      events.push(...page.events)
      token = page.continuation_token
      pages += 1
      if (!token) break
    }

    const crowd = countDepositors(events, {
      paymaster: num.toHex(PAYMASTER),
      feeCollector,
    })

    return Response.json({ ...crowd, windowBlocks: WINDOW_BLOCKS, head })
  } catch {
    return Response.json({ error: 'pool unreachable' }, { status: 502 })
  }
}
