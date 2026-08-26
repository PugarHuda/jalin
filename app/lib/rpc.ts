import 'server-only'
import { hash } from 'starknet'

/**
 * One place that talks to a Starknet node.
 *
 * Four files had their own JSON-RPC fetch, each with its own idea of how to
 * handle an error and none of them normalising calldata. That is how a decimal
 * felt reached the node once and came back as a bare failure naming nothing.
 *
 * Server-only: the RPC URL carries an API key, and a key in the client bundle is
 * a key anyone can lift and spend.
 */

/**
 * Long enough for an event scan over half a million blocks, short enough that a
 * node which has stopped answering fails the page instead of holding it open
 * until the platform kills the function. Without it there was no ceiling at all.
 */
const TIMEOUT_MS = 15_000

export class RpcError extends Error {
  constructor(
    message: string,
    readonly kind: 'unconfigured' | 'transport' | 'node',
  ) {
    super(message)
    this.name = 'RpcError'
  }
}

function endpoint(): string {
  const url = process.env.STARKNET_RPC_URL
  if (!url) throw new RpcError('STARKNET_RPC_URL is not configured', 'unconfigured')
  return url
}

async function send<T>(method: string, params: unknown, revalidate?: number): Promise<T> {
  let response: Response
  try {
    response = await fetch(endpoint(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 1, jsonrpc: '2.0', method, params }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      ...(revalidate === undefined ? { cache: 'no-store' } : { next: { revalidate } }),
    })
  } catch (cause) {
    const timedOut = cause instanceof Error && cause.name === 'TimeoutError'
    throw new RpcError(
      timedOut
        ? `the node did not answer within ${TIMEOUT_MS / 1000}s`
        : `could not reach the node: ${String(cause)}`,
      'transport',
    )
  }

  const body = (await response.json()) as { result?: T; error?: { message?: string } }
  if (body.error || body.result === undefined) {
    // Carry the node's own message. "vault call failed" told us nothing for two
    // deploys while the real answer was sitting in this field.
    throw new RpcError(body.error?.message ?? `${method} returned no result`, 'node')
  }
  return body.result
}

export const rpc = {
  blockNumber: () => send<number>('starknet_blockNumber', {}),

  /**
   * Calldata is normalised to canonical hex here. starknet.js does this for you
   * and a raw fetch does not; a decimal entry is rejected by the node in a way
   * that names no field.
   */
  call: (
    contract: string,
    entrypoint: string,
    calldata: (string | bigint)[] = [],
    revalidate?: number,
  ) =>
    send<string[]>(
      'starknet_call',
      {
        block_id: 'latest',
        request: {
          contract_address: contract,
          entry_point_selector: hash.getSelectorFromName(entrypoint),
          calldata: calldata.map((felt) => `0x${BigInt(felt).toString(16)}`),
        },
      },
      revalidate,
    ),

  events: (filter: Record<string, unknown>, revalidate?: number) =>
    send<{
      events?: { keys: string[]; data?: string[]; block_number?: number; from_address?: string }[]
      continuation_token?: string
    }>(
      'starknet_getEvents',
      { filter },
      revalidate,
    ),

  receipt: (transactionHash: string) =>
    send<unknown>('starknet_getTransactionReceipt', { transaction_hash: transactionHash }),
}
