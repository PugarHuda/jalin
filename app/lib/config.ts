/** Where this is served. One place, so robots, sitemap and metadata agree. */
export const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://jalin-five.vercel.app'

export const REPO = 'https://github.com/PugarHuda/jalin'

/**
 * Proposal kinds, in the order the governor numbers them - index is the `kind`
 * felt, matching `types::kinds` in the contract.
 *
 * Here rather than in lib/governance.ts because the propose form is a client
 * component, and lib/governance.ts is `server-only`: importing it from the
 * client pulls a server module into the browser bundle and the build refuses,
 * correctly. A constant both sides read belongs with the other chain constants.
 */
export const KINDS = ['pause', 'limits', 'fee', 'deny', 'label'] as const

/**
 * The six invariants, worded once.
 *
 * The landing page and the deck each carried their own copy, and they drifted:
 * the deck's I2 read "no step may target the pool" where the contract checks the
 * pool *and* the router, which told a reader the router permits a step aimed at
 * itself. Wording that describes a contract is not decoration, so it lives in one
 * place and both pages read it. Each entry pairs the rule with the attack it
 * closes; the order is I1..I6, matching docs/threat-model.md and the asserts in
 * contracts/src/router.cairo.
 */
export const INVARIANTS: readonly (readonly [string, string])[] = [
  ['The pool is the only caller', 'Anyone calling the router directly'],
  ['No step may target the pool or the router', 'Reentrancy into the sandwich'],
  ['Every approval is reset after its step', 'A stale allowance draining the next user'],
  ['Zero residue: touched tokens end at zero', "Sweeping another user's leftovers"],
  ['Each output clears its floor', 'Slippage and hostile routes'],
  ['Steps and calldata are bounded', 'Griefing the proof budget'],
] as const

/** The STRK20 pool on Starknet mainnet. */
export const POOL_ADDRESS =
  '0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a'

/**
 * Deployed JalinRouter. Empty until the mainnet deploy, which is why the composer
 * works without it: everything up to signing is derived from the plan alone.
 */
export const ROUTER_ADDRESS = process.env.NEXT_PUBLIC_ROUTER_ADDRESS ?? ''

export const GOVERNOR_ADDRESS = process.env.NEXT_PUBLIC_GOVERNOR_ADDRESS ?? ''

/**
 * The deployed shadow-account anonymizer, not ours.
 *
 * A hardcoded address in a project that renders nothing it did not read, so it
 * earns the exception by being checkable: `get_privacy_contract()` on it returns
 * POOL_ADDRESS above, and the composer makes that call rather than asserting it.
 * If the two ever stop matching, the page says so instead of showing this.
 *
 * Documented in starknet.js under "Address of a shadow account", and in none of
 * the places this project looked first - see docs/strk20-endpoints.md.
 */
export const SHADOW_ANONYMIZER =
  '0x04f33230dc57855c6e7eabe66dfa0fde82c5458fd0e54827cdb7cb4c474888a7'

export interface KnownToken {
  symbol: string
  address: string
  decimals: number
}

/**
 * Endur's liquid staking vault, an ERC-4626 whose share token is the contract
 * itself. Verified on mainnet: asset() is STRK and deposit is the standard
 * deposit(assets: u256, receiver: ContractAddress).
 */
export const ENDUR_VAULT =
  '0x28d709c875c0ceac3dce7065bec5328186dc89fe254527084d1689910954b0a'

/**
 * AVNU's exchange on mainnet. Read from AVNU's own `/swap/v2/build` response
 * for a quote with the router as taker, then checked against the class on
 * chain: `multi_route_swap(sell_token, sell_amount: u256, buy_token,
 * buy_amount: u256, buy_token_min_amount: u256, beneficiary,
 * integrator_fee_amount_bps, integrator_fee_recipient, routes)`. A plain
 * external call, which is what makes a DEX route a step.
 */
export const AVNU_EXCHANGE =
  '0x04270219d365d6b017231b52e92b3fb5d7c8378b05e9abc97724537a80e93b0f'

export const TOKENS: KnownToken[] = [
  {
    symbol: 'STRK',
    address: '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d',
    decimals: 18,
  },
  {
    symbol: 'ETH',
    address: '0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7',
    decimals: 18,
  },
  {
    symbol: 'xSTRK',
    address: '0x28d709c875c0ceac3dce7065bec5328186dc89fe254527084d1689910954b0a',
    decimals: 18,
  },
  /**
   * Two USDCs, and the label matters. `0x33068f…` is native USDC and is what
   * the pool actually holds: 71 of the pool's 399 deposits over its life, the
   * second most shielded token after STRK. `0x53c9…` is the bridged "USD
   * Coin", USDC.e, and has been shielded exactly once. A note in USDC.e is a
   * cell of one - the "you, alone" the disclosure panel warns about - so the
   * swap preset buys the native one. Both symbols are read from the chain.
   */
  {
    symbol: 'USDC',
    address: '0x033068f6539f8e6e6b131e6b2b814e6c34a5224bc66947c47dab9dfee93b35fb',
    decimals: 6,
  },
  {
    symbol: 'USDC.e',
    address: '0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8',
    decimals: 6,
  },
  /** 16 deposits over the pool's life; here so a balance in it has a name. */
  {
    symbol: 'strkBTC',
    address: '0x0787150e306e6eae6e3f79dea881770e8bbff2c1b8eb490f969669ee945b3135',
    decimals: 8,
  },
]

export function tokenOf(address: string): KnownToken | undefined {
  const normalise = (a: string) => BigInt(a || '0').toString()
  return TOKENS.find((t) => {
    try {
      return normalise(t.address) === normalise(address)
    } catch {
      return false
    }
  })
}

export function label(address: string): string {
  const token = tokenOf(address)
  if (token) return token.symbol
  if (!address) return '-'
  return address.length > 14 ? `${address.slice(0, 8)}…${address.slice(-4)}` : address
}

/** Parses a decimal string into base units without floating point. */
export function toBaseUnits(value: string, decimals: number): bigint {
  const trimmed = value.trim()
  if (!trimmed) return 0n
  if (!/^\d*\.?\d*$/.test(trimmed)) throw new Error(`"${value}" is not a number`)
  const [whole = '0', fraction = ''] = trimmed.split('.')
  if (fraction.length > decimals) {
    throw new Error(`${decimals} decimal places at most, got ${fraction.length}`)
  }
  return BigInt(whole + fraction.padEnd(decimals, '0'))
}
