/**
 * Turning a plan into STRK20 wallet actions.
 *
 * This is the part that is easy to get subtly wrong. Three rules, none of them
 * obvious from the plan on its own:
 *
 * 1. The pool has to be told to fund the router. That is a `withdraw` action with
 *    the router as recipient - a plain public transfer, which is why the phase
 *    order is withdraw before invoke.
 * 2. `${openNoteIds[N]}` means "the Nth transfer action with amount OPEN", not
 *    "the Nth output". They are the same thing only if the OPEN transfers are
 *    emitted in output order, which is what this module guarantees.
 * 3. One invoke per pool transaction. A plan is one invoke no matter how many
 *    steps it has; that is the entire reason the router exists.
 */

import { encodePlan, openNote, type Felt, type Plan } from './plan.ts'

/** Matches `STRK20_ACTION` from `@starknet-io/types-js`, structurally. */
export type Strk20Action =
  | { type: 'deposit'; token: string; amount: string }
  | { type: 'withdraw'; token: string; amount: string; recipient: string }
  | { type: 'transfer'; token: string; amount: string | 'OPEN'; recipient: string }
  | { type: 'invoke'; contract: string; calldata: (string | bigint)[] }

export interface WalletActionArgs {
  /** Deployed JalinRouter address. */
  router: string
  /** What the pool must send to the router before the plan runs. */
  inputs: { token: string; amount: bigint }[]
  /** Who the open notes belong to - normally the connected account. */
  recipient: string
}

/**
 * Rejects a plan whose note ids are not `openNote(0..n-1)` in order.
 *
 * Getting this wrong does not fail loudly: the wallet resolves the placeholder to
 * a real note id, the router credits a real amount, and the value lands in the
 * wrong note. Better to refuse to build the transaction.
 */
function assertNoteIdsAreInOrder(plan: Plan): void {
  plan.outputs.forEach((output, index) => {
    const expected = openNote(index)
    if (output.noteId !== expected) {
      throw new Error(
        `output ${index} carries note id ${String(output.noteId)}, expected ${expected}. ` +
          'Open notes are numbered by the order of the OPEN transfer actions, so output N must use openNote(N).',
      )
    }
  })
}

export function toWalletActions(plan: Plan, args: WalletActionArgs): Strk20Action[] {
  assertNoteIdsAreInOrder(plan)

  if (args.inputs.length === 0 && plan.steps.some((s) => s.approvals.length > 0)) {
    throw new Error(
      'this plan approves tokens it was never funded with; add the inputs the pool should withdraw to the router',
    )
  }

  const actions: Strk20Action[] = []

  // 1. Fund the router. Public, and visible as the pool paying the router.
  for (const input of args.inputs) {
    actions.push({
      type: 'withdraw',
      token: input.token,
      amount: `0x${input.amount.toString(16)}`,
      recipient: args.router,
    })
  }

  // 2. One open note per output, in output order. This is what numbers them.
  for (const output of plan.outputs) {
    actions.push({
      type: 'transfer',
      token: String(output.token),
      amount: 'OPEN',
      recipient: args.recipient,
    })
  }

  // 3. The plan itself, as the single permitted invoke.
  actions.push({
    type: 'invoke',
    contract: args.router,
    calldata: encodePlan(plan),
  })

  return actions
}

/**
 * The felts a wallet will actually see, with placeholders left as strings.
 * Useful for showing a user what they are about to sign.
 */
export function previewCalldata(plan: Plan, poolAddress?: Felt): string[] {
  return encodePlan(plan, poolAddress).map((felt) =>
    typeof felt === 'bigint' ? `0x${felt.toString(16)}` : felt,
  )
}
