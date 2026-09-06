import { cached } from '@/lib/cache'
import { TOKENS } from '@/lib/config'

/**
 * The three STRK20 services this stack stands on, asked rather than assumed.
 *
 * `docs/strk20-endpoints.md` is this project's most-read page and its whole
 * claim is that three endpoints reported missing across the sprint's issue
 * tracker answer on the first request. A document saying so is a snapshot; a
 * route saying so is a check. Every figure here is read at request time from
 * the service itself.
 *
 * Two of the three were integrated in `scripts/mainnet.mjs` and nowhere else,
 * so the app has never once talked to them. That is the gap this closes:
 *
 * - **The prover** answers `/health`. A wallet proves in-browser, so nothing
 *   here needs it — but a headless integration does, and its absence is what
 *   the issue tracker kept asking about.
 * - **Discovery** answers with how far behind the chain it is. That number
 *   decides whether a note you just created is findable yet, which is the
 *   question behind "the transfer landed and the recipient sees nothing".
 * - **AVNU's paymaster** is a public SNIP-29 endpoint that needs no key, and
 *   the tokens it will take for gas are read from it. The paymaster address
 *   this repo already hardcodes as a crowd exclusion is the same actor, seen
 *   from the other side.
 *
 * A service that is down is reported as down. This route does not fail because
 * one of them did — the point is to show which, and a 502 for the whole panel
 * would hide exactly the thing it exists to show.
 */
export const revalidate = 60

const PROVER = 'https://transaction-prover.alpha-mainnet.sw-dev.io'
const DISCOVERY = 'https://discovery-service.alpha-mainnet.sw-dev.io'
const PAYMASTER = 'https://starknet.paymaster.avnu.fi'

/** Long enough for a cold service, short enough that four of them fit a render. */
const TIMEOUT_MS = 8_000

export interface ServiceReading {
  name: string
  url: string
  ok: boolean
  /** Why it is not ok, in the service's own words where there are any. */
  detail: string | null
}

async function head(name: string, url: string, path: string): Promise<ServiceReading> {
  try {
    const response = await fetch(`${url}${path}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      next: { revalidate },
    })
    if (!response.ok) {
      return { name, url, ok: false, detail: `HTTP ${response.status}` }
    }
    return { name, url, ok: true, detail: null }
  } catch (error) {
    return {
      name,
      url,
      ok: false,
      detail: (error as Error).name === 'TimeoutError' ? `no answer in ${TIMEOUT_MS / 1000}s` : 'unreachable',
    }
  }
}

export async function GET() {
  const [prover, discovery, paymaster] = await Promise.all([
    head('proving service', PROVER, '/health'),

    // Discovery reports its own lag, which is the number that matters rather
    // than whether the process is up.
    (async (): Promise<ServiceReading & { lagSeconds: number | null; chainHead: number | null }> => {
      const base = await head('note discovery', DISCOVERY, '/health')
      if (!base.ok) return { ...base, lagSeconds: null, chainHead: null }
      try {
        const response = await fetch(`${DISCOVERY}/health`, {
          signal: AbortSignal.timeout(TIMEOUT_MS),
          next: { revalidate },
        })
        const body = (await response.json()) as {
          lag_secs?: number
          chain_head?: { block_number?: number }
        }
        return {
          ...base,
          lagSeconds: typeof body.lag_secs === 'number' ? body.lag_secs : null,
          chainHead: body.chain_head?.block_number ?? null,
        }
      } catch {
        // Up, and its body was not what this expects. Saying "up, lag unknown"
        // is honest; inventing a zero would not be.
        return { ...base, lagSeconds: null, chainHead: null }
      }
    })(),

    // SNIP-29, and public: `paymaster_isAvailable` needs no key, and the token
    // list is what a user would actually pay gas in.
    (async (): Promise<ServiceReading & { gasTokens: string[] }> => {
      try {
        const call = (method: string) =>
          fetch(PAYMASTER, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: 1, jsonrpc: '2.0', method, params: [] }),
            signal: AbortSignal.timeout(TIMEOUT_MS),
            next: { revalidate },
          }).then((response) => response.json())

        const [available, supported] = await Promise.all([
          call('paymaster_isAvailable'),
          call('paymaster_getSupportedTokens'),
        ])

        const addresses: string[] = Array.isArray(supported?.result)
          ? supported.result.map((entry: { token_address: string }) => entry.token_address)
          : []

        // Named where this app knows the name. An address alone tells a reader
        // nothing about whether they hold any of it.
        const known = TOKENS.filter((token) =>
          addresses.some((address) => BigInt(address) === BigInt(token.address)),
        ).map((token) => token.symbol)

        return {
          name: 'avnu paymaster',
          url: PAYMASTER,
          ok: available?.result === true,
          detail: available?.result === true ? null : 'reports itself unavailable',
          gasTokens: known,
        }
      } catch (error) {
        return {
          name: 'avnu paymaster',
          url: PAYMASTER,
          ok: false,
          detail: (error as Error).name === 'TimeoutError' ? `no answer in ${TIMEOUT_MS / 1000}s` : 'unreachable',
          gasTokens: [],
        }
      }
    })(),
  ])

  return cached({ prover, discovery, paymaster, checkedAt: new Date().toISOString() }, revalidate)
}
