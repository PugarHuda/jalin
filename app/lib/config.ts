/** Where this is served. One place, so robots, sitemap and metadata agree. */
export const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://jalin-five.vercel.app'

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

/** The STRK20 pool on Starknet mainnet. */
export const POOL_ADDRESS =
  '0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a'

/**
 * Deployed JalinRouter. Empty until the mainnet deploy, which is why the composer
 * works without it: everything up to signing is derived from the plan alone.
 */
export const ROUTER_ADDRESS = process.env.NEXT_PUBLIC_ROUTER_ADDRESS ?? ''

export const GOVERNOR_ADDRESS = process.env.NEXT_PUBLIC_GOVERNOR_ADDRESS ?? ''

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
  {
    symbol: 'USDC',
    address: '0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8',
    decimals: 6,
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
