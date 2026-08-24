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
  | { type: 'invoke'; contract: string; calldata: string[] }

/**
 * Felts go to the wallet over JSON-RPC, and JSON has no bigint - `JSON.stringify`
 * throws on one rather than coercing it. Placeholders stay as they are, because
 * the wallet is the thing that resolves them.
 */
export function feltsToStrings(felts: (string | bigint)[]): string[] {
  return felts.map((felt) => (typeof felt === 'bigint' ? `0x${felt.toString(16)}` : felt))
}

export interface WalletActionArgs {
  /** Deployed JalinRouter address. */
  router: string
  /** What the pool must send to the router before the plan runs. */
  inputs: { token: string; amount: bigint }[]
  /** Who the open notes belong to - normally the connected account. */
  recipient: string
  /**
   * Public funds to shield in the same transaction, before anything is spent.
   *
   * A plan spends notes, so a first-time user has nothing to run it with. Doing
   * the deposit as a separate transaction would work and would also be a second
   * public footprint for an observer to line up against the first. One
   * transaction is both simpler and quieter.
   */
  deposits?: { token: string; amount: bigint }[]
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

  // 0. Shield first, so the withdrawal below has something to draw on. The pool
  // applies actions in order, so a deposit placed after the withdrawal is a
  // deposit that arrives too late.
  for (const deposit of args.deposits ?? []) {
    actions.push({
      type: 'deposit',
      token: deposit.token,
      amount: `0x${deposit.amount.toString(16)}`,
    })
  }

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
    calldata: feltsToStrings(encodePlan(plan)),
  })

  return actions
}

/** One open note the pool created for this transaction, in creation order. */
export interface OpenNote {
  noteId: string | bigint
  token: string | bigint
}

/**
 * The same plan, for the SDK route rather than the wallet route.
 *
 * The two routes differ in one place that is easy to miss: a wallet resolves
 * `${openNoteIds[N]}` itself, while the SDK hands you the real note ids in the
 * `invoke` callback and expects them substituted before encoding. Passing a
 * placeholder string here would be encoded as a literal and the pool would
 * credit nothing.
 *
 * Returns starknet.js `CallDetails`. The entry point is implied - the pool calls
 * the helper through its own `INVOKE_SELECTOR`, not through a name.
 */
export function toInvokeCall(
  plan: Plan,
  args: { router: string; openNotes: OpenNote[]; poolAddress: string | bigint },
): { contractAddress: string; calldata: (string | bigint)[] } {
  if (plan.outputs.length !== args.openNotes.length) {
    throw new Error(
      `plan declares ${plan.outputs.length} outputs but the pool opened ${args.openNotes.length} notes; they are matched by position`,
    )
  }

  const resolved: Plan = {
    steps: plan.steps,
    outputs: plan.outputs.map((output, index) => {
      const note = args.openNotes[index]!
      if (BigInt(note.token) !== BigInt(output.token)) {
        throw new Error(
          `output ${index} is for token ${String(output.token)} but open note ${index} is for ${String(note.token)}`,
        )
      }
      return { ...output, noteId: note.noteId }
    }),
  }

  return {
    contractAddress: args.router,
    calldata: encodePlan(resolved, args.poolAddress),
  }
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
