/**
 * Sub-account portfolio layer.
 *
 * Sub-accounts are what stop two strategies run by the same person from being
 * publicly the same person. Each strategy gets its own execution identity, and
 * nothing on chain ties them together; the aggregation back into one portfolio
 * happens here, on the client, from notes only the viewing key can read.
 *
 * Availability, kept current because it has changed under this file once
 * already. The SDK route works as of Privacy SDK 0.14.3-rc.4 via
 * `transfers.build().subaccounts(dappName).invoke(...)` - renamed to
 * `shadowAccounts` in rc.5 - and needs a viewing key in hand. The Wallet API
 * route, which this file used to say did not exist, does since starknet.js
 * 10.6.0 and `@starknet-io/types-js` 0.10.4: `shadow_account_invoke` and
 * `wallet_strk20ShadowAccountCommitment`. `./shadow.ts` builds the action and
 * the app asks the connected wallet whether it answers, rather than assuming.
 * `strategyLabel` below is what becomes its `dapp_name`.
 */

export const MIN_SDK_VERSION = '0.14.3-rc.4'

/**
 * Structural slice of the Privacy SDK this module needs. Declared here rather
 * than imported so the package builds and its logic stays testable without the
 * SDK present.
 */
export interface TransfersBuilder {
  subaccounts(dappName: string): TransfersBuilder
  invoke(contract: string, calldata: unknown[]): TransfersBuilder
  execute(opts: { provingBlockId: number }): Promise<unknown>
}

/**
 * The `dappName` handed to `.subaccounts()` is what separates one execution
 * identity from another, so it has to be derived the same way every time or the
 * next session lands in a different sub-account and the funds look lost.
 */
export function strategyLabel(app: string, strategy: string): string {
  const normalise = (s: string) =>
    s
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')

  const a = normalise(app)
  const s = normalise(strategy)
  if (!a || !s) {
    throw new Error(`strategy label needs a non-empty app and strategy, got "${app}"/"${strategy}"`)
  }
  return `${a}:${s}`
}

export interface Position {
  strategy: string
  token: string
  amount: bigint
}

export interface PortfolioLine {
  token: string
  total: bigint
  /** Per-strategy split, largest first. Never leaves the client. */
  byStrategy: { strategy: string; amount: bigint }[]
}

/**
 * Rolls unlinkable positions back into one view. Externally these are separate
 * identities; internally they are one balance sheet.
 */
export function aggregate(positions: Position[]): PortfolioLine[] {
  const byToken = new Map<string, Map<string, bigint>>()

  for (const { strategy, token, amount } of positions) {
    if (amount === 0n) continue
    const strategies = byToken.get(token) ?? new Map<string, bigint>()
    strategies.set(strategy, (strategies.get(strategy) ?? 0n) + amount)
    byToken.set(token, strategies)
  }

  return [...byToken.entries()]
    .map(([token, strategies]) => ({
      token,
      total: [...strategies.values()].reduce((a, b) => a + b, 0n),
      byStrategy: [...strategies.entries()]
        .map(([strategy, amount]) => ({ strategy, amount }))
        .sort((a, b) => (b.amount > a.amount ? 1 : b.amount < a.amount ? -1 : 0)),
    }))
    .sort((a, b) => (b.total > a.total ? 1 : b.total < a.total ? -1 : 0))
}

/**
 * How many strategies would have to be linked before a given one stops hiding in
 * the crowd. A single-strategy portfolio has no internal anonymity at all, and
 * saying so is more useful than a green tick.
 */
export function linkabilityWarnings(positions: Position[]): string[] {
  const strategies = new Set(positions.map((p) => p.strategy))
  const warnings: string[] = []

  if (strategies.size <= 1) {
    warnings.push(
      'Everything is running in one sub-account, so nothing here is unlinkable from anything else.',
    )
  }

  const byToken = new Map<string, Set<string>>()
  for (const { token, strategy } of positions) {
    byToken.set(token, (byToken.get(token) ?? new Set()).add(strategy))
  }
  for (const [token, owners] of byToken) {
    if (owners.size === 1 && strategies.size > 1) {
      warnings.push(
        `Only one strategy holds ${token}, so any activity in it points straight back at that strategy.`,
      )
    }
  }

  return warnings
}
