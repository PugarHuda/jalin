import 'server-only'
import { hash } from 'starknet'
import { interpretRpc } from '@jalin/sdk'

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

/** Any URL, gone. An endpoint in a log is an endpoint in a screenshot. */
function redact(value: unknown): string {
  const text = value instanceof Error ? `${value.name}: ${value.message}` : String(value)
  return text.replace(/https?:\/\/\S+/g, '<rpc endpoint>')
}

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
  // Resolved before the try. Inside it, the "no endpoint configured" error was
  // caught by the transport handler and rethrown as a transport failure, so a
  // route that distinguishes 503 from 502 answered the wrong one.
  const url = endpoint()

  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 1, jsonrpc: '2.0', method, params }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      ...(revalidate === undefined ? { cache: 'no-store' } : { next: { revalidate } }),
    })
  } catch (cause) {
    // Neither the response nor the log may carry the endpoint: it holds an API
    // key. Next's own DynamicServerError quotes the whole fetch URL in its
    // message, so redacting on the way to the log is not optional - this logged
    // the key once before it was caught.
    console.error('[jalin] rpc transport failure', method, redact(cause))
    throw new RpcError(
      cause instanceof Error && cause.name === 'TimeoutError'
        ? `the node did not answer within ${TIMEOUT_MS / 1000}s`
        : 'could not reach the node',
      'transport',
    )
  }

  // Read as text and interpret. `.json()` on a node that answered "Must be
  // authenticated!" throws a SyntaxError about an unexpected token, outside the
  // catch above, and the status code that explains it never reaches anyone.
  const outcome = interpretRpc<T>(response.status, await response.text(), method)
  if (!outcome.ok) {
    // The node's own message. "vault call failed" told us nothing for two
    // deploys while the real answer was sitting in this field.
    throw new RpcError(outcome.message, outcome.kind)
  }
  return outcome.result
}

export const rpc = {
  /**
   * Takes a revalidate like every other read here, and did not until now. A
   * no-store fetch inside a page render makes the route dynamic, which Next
   * signals by throwing during prerender - so the one call that could not be
   * cached decided the caching of every page that reads the chain.
   */
  blockNumber: (revalidate?: number) => send<number>('starknet_blockNumber', {}, revalidate),

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

  /** A block's timestamp, for measuring how fast the chain actually moves. */
  blockTimestamp: (blockNumber: number, revalidate?: number) =>
    send<{ timestamp: number }>(
      'starknet_getBlockWithTxHashes',
      { block_id: { block_number: blockNumber } },
      revalidate,
    ).then((block) => block.timestamp),
}

/**
 * Seconds per block, measured rather than remembered.
 *
 * Every deadline on these pages is a block count, and turning one into minutes
 * needs a block time. That number was the literal 1.68 in two sentences, from a
 * 2,000-block sample taken once. Another team in the sprint had 30 seconds
 * hardcoded from an older Starknet and a seven-day window that closed in under
 * three hours; ours was right by luck and drifts by the day - 1.72 over the same
 * 2,000 blocks a week later, 1.70 over 200,000.
 *
 * Twenty thousand blocks, because short spans are jitter: a 1,000-block sample
 * read 2.03 against a true 1.70 on the day this was written.
 */
export async function secondsPerBlock(head: number, revalidate?: number): Promise<number> {
  const SPAN = 20_000
  const [now, then] = await Promise.all([
    rpc.blockTimestamp(head, revalidate),
    rpc.blockTimestamp(Math.max(0, head - SPAN), revalidate),
  ])
  return (now - then) / SPAN
}
