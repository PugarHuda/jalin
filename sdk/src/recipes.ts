/**
 * Plan recipes.
 *
 * These are conveniences, not capabilities. The router has no idea what a swap
 * or a bridge is - every one of these produces the same `Step` any other call
 * would, which is the point: a protocol does not need a Jalin adapter to be
 * reachable from inside a private transaction, it just needs an ABI.
 */

import { PlanBuilder, u256, type Felt, type Plan, type Step } from './plan.ts'

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

/** The general case. Everything below is this with the calldata pre-shaped. */
export function callStep({ target, selector, spend, calldata }: CallStep): Step {
  return {
    target,
    selector,
    approvals: spend ? [{ token: spend.token, amount: spend.amount }] : [],
    calldata,
  }
}

/**
 * A swap against an AMM whose entry point takes
 * `(token_in, token_out, amount_in: u256, min_out: u256)`.
 *
 * Check the venue's real ABI - argument order and `u256` versus `u128` differ
 * between venues, and a wrong shape reverts after you have paid for a proof.
 */
export function swapStep(args: {
  dex: Felt
  selector: Felt
  tokenIn: Felt
  tokenOut: Felt
  amountIn: bigint
  minOut?: bigint
}): Step {
  return callStep({
    target: args.dex,
    selector: args.selector,
    spend: { token: args.tokenIn, amount: args.amountIn },
    calldata: [
      args.tokenIn,
      args.tokenOut,
      ...u256(args.amountIn),
      ...u256(args.minOut ?? 0n),
    ],
  })
}

/**
 * A deposit into a vault or lending market that takes `(assets: u256, receiver)`
 * and hands back a share token.
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
 * A bridge leg. Value leaves Starknet, so this step usually credits nothing
 * back - see `bridgeAway` and docs/cross-chain.md for why that is allowed and
 * what it costs you in privacy on the far side.
 */
export function bridgeStep(args: {
  bridge: Felt
  selector: Felt
  token: Felt
  amount: bigint
  /** Everything the bridge needs beyond the amount: destination domain, recipient, fees. */
  calldata: Felt[]
}): Step {
  return callStep({
    target: args.bridge,
    selector: args.selector,
    spend: { token: args.token, amount: args.amount },
    calldata: args.calldata,
  })
}

/**
 * Bridge the whole input and credit nothing back.
 *
 * A plan with no outputs is legal: the pool accepts an empty `Span` and the
 * router still requires every token a step could move to end at zero, so
 * "everything left the chain" is provable rather than assumed. If the bridge
 * takes less than it was approved, the residue check reverts the whole thing
 * instead of stranding the remainder.
 */
export function bridgeAway(step: Step): Plan {
  return { steps: [step], outputs: [] }
}

/**
 * Swap, then bridge the proceeds, in one private transaction.
 *
 * This is the composition the protocol otherwise forbids. One `invoke` per pool
 * transaction means swap-then-bridge would normally be two transactions with two
 * public footprints, and the gap between them is the correlation an observer
 * needs. Here it is one.
 */
export function swapThenBridge(args: {
  swap: Step
  bridge: Step
  /** Any change the venue leaves behind, credited back rather than stranded. */
  change?: { token: Felt; noteId: Felt; minAmount?: bigint }
}): Plan {
  let builder = PlanBuilder.create().call(args.swap).call(args.bridge)
  if (args.change) {
    builder = builder.creditTo(args.change.token, args.change.noteId, args.change.minAmount ?? 0n)
  }
  return builder.build()
}
