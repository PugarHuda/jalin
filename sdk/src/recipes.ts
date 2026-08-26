/**
 * Plan recipes.
 *
 * These are conveniences, not capabilities. The router has no idea what a
 * deposit is - every one of these produces the same `Step` any other call would,
 * which is the point: a protocol does not need a Jalin adapter to be reachable
 * from inside a private transaction, it just needs an ABI.
 *
 * Only shapes checked against a live mainnet contract live here. A recipe that
 * encodes a guessed argument order is worse than no recipe: it reads as
 * supported, and it fails after a proof has already been paid for.
 */

import { u256, type Felt, type Plan, type Step } from './plan.ts'

export interface CallStep {
  /** Contract to call. */
  target: Felt
  /** `selector!("...")` for the entry point. */
  selector: Felt
  /** Token the step is allowed to move, and how much. */
  spend?: { token: Felt; amount: bigint }
  /** Calldata after any `spend` is approved. Already flattened to felts. */
  calldata: Felt[]
}

/**
 * The general case, and the one to reach for. Anything with an ABI is reachable
 * through it, including every venue that has no recipe here.
 */
export function callStep({ target, selector, spend, calldata }: CallStep): Step {
  return {
    target,
    selector,
    approvals: spend ? [{ token: spend.token, amount: spend.amount }] : [],
    calldata,
  }
}

/**
 * A deposit into an ERC-4626 vault: `deposit(assets: u256, receiver: ContractAddress)`.
 *
 * Verified against Endur's xSTRK vault on Starknet mainnet
 * (`0x28d709c875c0ceac3dce7065bec5328186dc89fe254527084d1689910954b0a`), whose
 * `asset()` is STRK. ERC-4626 fixes the argument order, which is why this shape
 * is safe to encode once and reuse - unlike a swap, where every venue differs.
 *
 * `receiver` should be the router: the shares have to land somewhere the pool can
 * pull them from, and the router holds nothing after the transaction ends.
 */
export function depositStep(args: {
  market: Felt
  selector: Felt
  asset: Felt
  amount: bigint
  receiver: Felt
}): Step {
  return callStep({
    target: args.market,
    selector: args.selector,
    spend: { token: args.asset, amount: args.amount },
    calldata: [...u256(args.amount), args.receiver],
  })
}

/**
 * A plan that credits nothing back.
 *
 * Legal, and not an oversight: the pool accepts an empty `Span`, which is what
 * makes bridging value off Starknet, funding an escrow, or casting a ballot
 * expressible at all. Invariant I4 is what keeps it honest - every token a step
 * could move must still end the transaction at zero, so "it all left" is checked
 * rather than assumed.
 */
export function oneWay(step: Step): Plan {
  return { steps: [step], outputs: [] }
}
