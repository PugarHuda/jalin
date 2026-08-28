/**
 * Shadow accounts through the Wallet API.
 *
 * A shadow account is a real Starknet account the wallet derives for a
 * (dapp, nonce) pair from the user's private state. Calls made through it carry
 * no public link to the user's main wallet, and - unlike the router - it can
 * *hold* something between transactions: a lending position, a vault
 * subscription, anything with a persistent owner. That is the case the router
 * cannot serve by construction (invariant I4 says it ends every transaction
 * empty), and the case this module exists for.
 *
 * Availability, stated plainly because the docs and this repository both said
 * otherwise until now: the Wallet API route exists. starknet.js 10.6.0
 * (29 July 2026) added the handling and `@starknet-io/types-js` 0.10.4 carries
 * `shadow_account_invoke` and `wallet_strk20ShadowAccountCommitment`. Whether
 * the wallet in front of you implements them is a separate question, answered
 * by asking it - see `probe` in the app - and never assumed here.
 *
 * `strategyLabel` from `./subaccounts.ts` is the `dapp_name`: the same label
 * every session, or the next session derives a different account and the funds
 * look lost.
 */

import { toFelt, type WireFelt } from './wallet.ts'

/** A public call, in the Wallet API's spelling: `entry_point`, not the RPC selector. */
export interface ShadowCall {
  contract_address: WireFelt
  entry_point: string
  calldata?: WireFelt[]
}

/**
 * How much of the shadow account's balance each open note collects once the
 * calls have run. `diff` is the one a persistent position wants: it settles only
 * what this interaction gained and leaves the position itself in place.
 */
export type CollectPolicy = { type: 'all' } | { type: 'diff' } | { type: 'exact'; amount: WireFelt }

export interface ShadowInvokeAction {
  type: 'shadow_account_invoke'
  dapp_name: string
  nonce: WireFelt
  calls: ShadowCall[]
  collect_policy: CollectPolicy
}

/** A Cairo short string: ASCII, at most 31 bytes. Or an explicit felt. */
const SHORT_STRING = /^[\x20-\x7e]{1,31}$/
const FELT = /^0x[0-9a-fA-F]{1,64}$/

/**
 * One `shadow_account_invoke`, checked before it reaches a wallet.
 *
 * The wallet refuses a bad one with INVALID_REQUEST_PAYLOAD and, as this
 * project learned twice, nothing more - so every rule the type carries is also
 * enforced here in words. Calls are normalised through `toFelt` for the same
 * reason the router's calldata is: a felt with leading zeros parses to the same
 * number and is not the same string.
 */
export function shadowInvoke(args: {
  dappName: string
  nonce: string | bigint
  calls: { contract: string | bigint; entryPoint: string; calldata?: (string | bigint)[] }[]
  collect: CollectPolicy | { type: 'exact'; amount: string | bigint }
}): ShadowInvokeAction {
  if (!SHORT_STRING.test(args.dappName) && !FELT.test(args.dappName)) {
    throw new Error(
      `dapp name "${args.dappName}" must be a felt or ASCII text of at most 31 characters, because the wallet encodes it as a Cairo short string`,
    )
  }
  if (args.calls.length === 0) {
    throw new Error('a shadow account invoke needs at least one call')
  }
  for (const [index, call] of args.calls.entries()) {
    if (!call.entryPoint || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(call.entryPoint)) {
      throw new Error(
        `call ${index} has entry point "${call.entryPoint}"; the Wallet API wants the function's name, not its selector`,
      )
    }
  }

  const collect: CollectPolicy =
    args.collect.type === 'exact' ? { type: 'exact', amount: toFelt(args.collect.amount) } : args.collect

  return {
    type: 'shadow_account_invoke',
    dapp_name: args.dappName,
    nonce: toFelt(args.nonce),
    calls: args.calls.map((call) => ({
      contract_address: toFelt(call.contract),
      entry_point: call.entryPoint,
      ...(call.calldata ? { calldata: call.calldata.map(toFelt) } : {}),
    })),
    collect_policy: collect,
  }
}
