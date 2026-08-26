import 'server-only'
import { hash, num } from 'starknet'
import { countDepositors, type Crowd, type PoolEvent } from '@jalin/sdk'
import { POOL_ADDRESS } from './config'

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

export const CROWD_WINDOW_BLOCKS = 50_000

/** Relays gasless pool transactions; its deposits are not a person arriving. */
const PAYMASTER = BigInt('0x127021a1b5a52d3174c2ab077c2b043c80369250d29428cee956d76ee51584f')

const MAX_PAGES = 10

async function rpc(rpcUrl: string, method: string, params: unknown, revalidate: number) {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: 1, jsonrpc: '2.0', method, params }),
    next: { revalidate },
  })
  const body = (await response.json()) as { result?: unknown }
  return body.result
}

export interface CrowdReading extends Crowd {
  windowBlocks: number
  head: number
}

export async function readCrowd(revalidate = 300): Promise<CrowdReading | null> {
  const rpcUrl = process.env.STARKNET_RPC_URL
  if (!rpcUrl) return null

  try {
    const head = (await rpc(rpcUrl, 'starknet_blockNumber', {}, revalidate)) as number
    const selector = num.toHex(hash.starknetKeccak('Deposit'))

    // Read the fee collector rather than hardcoding it, so the exclusion stays
    // right if governance moves it.
    const collector = (await rpc(
      rpcUrl,
      'starknet_call',
      {
        block_id: 'latest',
        request: {
          contract_address: POOL_ADDRESS,
          entry_point_selector: hash.getSelectorFromName('get_fee_collector'),
          calldata: [],
        },
      },
      revalidate,
    )) as string[] | undefined

    const events: PoolEvent[] = []
    let token: string | undefined
    let pages = 0

    while (pages < MAX_PAGES) {
      const page = (await rpc(
        rpcUrl,
        'starknet_getEvents',
        {
          filter: {
            address: POOL_ADDRESS,
            keys: [[selector]],
            from_block: { block_number: Math.max(0, head - CROWD_WINDOW_BLOCKS) },
            to_block: 'latest',
            chunk_size: 1000,
            ...(token ? { continuation_token: token } : {}),
          },
        },
        revalidate,
      )) as { events?: PoolEvent[]; continuation_token?: string } | undefined

      if (!page?.events) break
      events.push(...page.events)
      token = page.continuation_token
      pages += 1
      if (!token) break
    }

    const crowd = countDepositors(events, {
      paymaster: num.toHex(PAYMASTER),
      feeCollector: collector?.[0],
    })

    return { ...crowd, windowBlocks: CROWD_WINDOW_BLOCKS, head }
  } catch {
    return null
  }
}
