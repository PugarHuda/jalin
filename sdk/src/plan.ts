/**
 * Plan encoding for the Jalin router.
 *
 * A plan is what the router takes instead of fixed parameters, so encoding it
 * correctly is the whole integration surface. The layout below is Cairo's
 * positional Serde for:
 *
 *   privacy_invoke(
 *     pool_address: ContractAddress,
 *     steps: Array<Step>,
 *     outputs: Array<Output>,
 *   ) -> Span<OpenNoteDeposit>
 *
 * An `Array<T>` serialises as its length followed by its elements, and a `u128`
 * occupies a single felt. Nothing here is nested any deeper than that.
 */

/** A felt, or a wallet placeholder such as `${openNoteIds[0]}`. */
export type Felt = string | bigint

export interface Approval {
  /** ERC-20 the step is allowed to move. */
  token: Felt
  /** Allowance granted before the call and reset to zero after it. */
  amount: bigint
}

export interface Step {
  target: Felt
  /** `selector!("...")` - use `selectorOf()` rather than hand-computing it. */
  selector: Felt
  approvals: Approval[]
  calldata: Felt[]
}

export interface Output {
  token: Felt
  /**
   * The open note this token is credited into. With the Wallet API this is the
   * placeholder `${openNoteIds[N]}`, which the wallet resolves at submit time.
   */
  noteId: Felt
  /** Floor on what is actually received, checked after the protocol fee. */
  minAmount: bigint
}

export interface Plan {
  steps: Step[]
  outputs: Output[]
}

/** Placeholder for the Nth open note declared alongside the invoke action. */
export function openNote(index: number): string {
  if (!Number.isInteger(index) || index < 0) {
    throw new RangeError(`open note index must be a non-negative integer, got ${index}`)
  }
  return `\${openNoteIds[${index}]}`
}

/** Placeholder the wallet replaces with the pool address. */
export const POOL_ADDRESS = '${poolAddress}'

/**
 * The router bounds step count and calldata length on chain, and those bounds
 * are governed rather than fixed. These are the deployed defaults, checked here
 * so a plan fails in the caller rather than after a proof has been generated.
 */
export interface PlanLimits {
  maxSteps: number
  maxCalldata: number
}

export const DEFAULT_LIMITS: PlanLimits = { maxSteps: 8, maxCalldata: 64 }

/** Placeholders the wallet resolves at submit time; everything else is a felt. */
const PLACEHOLDER = /^\$\{(?:openNoteIds\[[0-9]+\]|poolAddress)\}$/

/** The Starknet field prime. A felt is a residue mod this, so 2^251+17*2^192+1. */
const FIELD_PRIME = 2n ** 251n + 17n * 2n ** 192n + 1n

/**
 * Every value in a plan is eventually a felt on the wire.
 *
 * Without this a target of `not-an-address` travelled the whole way through the
 * composer - a plan, a preview, an enabled submit button - and only failed when
 * the wallet tried to encode it, which is after the user has been told it is
 * ready to sign. Failing here names the field.
 */
function checkFelt(value: string | bigint, where: string): void {
  if (typeof value === 'string' && PLACEHOLDER.test(value)) return

  let felt: bigint
  try {
    felt = BigInt(value)
  } catch {
    throw new Error(`${where} is not a felt: ${JSON.stringify(String(value))}`)
  }
  if (felt < 0n) throw new Error(`${where} is negative, and a felt cannot be`)
  if (felt >= FIELD_PRIME) throw new Error(`${where} is larger than the field prime`)
}

export function validatePlan(plan: Plan, limits: PlanLimits = DEFAULT_LIMITS): void {
  // Outputs may be empty. The pool accepts an empty Span, which is what makes
  // fire-and-forget plans expressible: bridging value off Starknet, funding an
  // escrow, casting a ballot. The residue rule is what keeps that safe.
  if (plan.steps.length === 0) {
    throw new Error('a plan needs at least one step, or it does nothing at all')
  }
  if (plan.steps.length > limits.maxSteps) {
    throw new Error(`plan has ${plan.steps.length} steps, the router allows ${limits.maxSteps}`)
  }

  const seen = new Set<string>()
  for (const output of plan.outputs) {
    const key = String(output.token)
    if (seen.has(key)) {
      throw new Error(`output token ${key} is declared twice; the router rejects duplicates`)
    }
    seen.add(key)
    checkFelt(output.token, `output ${key} token`)
    if (output.minAmount < 0n) throw new Error('minAmount cannot be negative')
  }

  for (const [i, step] of plan.steps.entries()) {
    checkFelt(step.target, `step ${i} target`)
    checkFelt(step.selector, `step ${i} selector`)
    step.calldata.forEach((felt, j) => checkFelt(felt, `step ${i} calldata[${j}]`))
    step.approvals.forEach((approval, j) => {
      checkFelt(approval.token, `step ${i} approval[${j}] token`)
    })

    if (step.calldata.length > limits.maxCalldata) {
      throw new Error(
        `step ${i} has ${step.calldata.length} felts of calldata, the router allows ${limits.maxCalldata}`,
      )
    }
    for (const approval of step.approvals) {
      if (approval.amount < 0n) throw new Error(`step ${i} approves a negative amount`)
    }
  }

  // The residue rule bites here more often than anywhere else: a token a step is
  // allowed to move, that no output claims, must end the transaction at zero.
  // That is legitimate when a step spends its whole allowance, so this is a
  // warning surface rather than an error - see docs/threat-model.md.
}

/** Tokens a step may move but no output claims. Each one must end at zero. */
export function unclaimedTokens(plan: Plan): string[] {
  const claimed = new Set(plan.outputs.map((o) => String(o.token)))
  const touched = new Set(
    plan.steps.flatMap((s) => s.approvals.map((a) => String(a.token))),
  )
  return [...touched].filter((t) => !claimed.has(t))
}

/**
 * Flattens a plan into router calldata, leaving placeholder strings intact so
 * the wallet can resolve them.
 */
export function encodePlan(plan: Plan, poolAddress: Felt = POOL_ADDRESS): Felt[] {
  validatePlan(plan)

  const calldata: Felt[] = [poolAddress, BigInt(plan.steps.length)]

  for (const step of plan.steps) {
    calldata.push(step.target, step.selector, BigInt(step.approvals.length))
    for (const approval of step.approvals) {
      calldata.push(approval.token, approval.amount)
    }
    calldata.push(BigInt(step.calldata.length), ...step.calldata)
  }

  calldata.push(BigInt(plan.outputs.length))
  for (const output of plan.outputs) {
    calldata.push(output.token, output.noteId, output.minAmount)
  }

  return calldata
}

/** A `u256` argument occupies two felts, low then high. */
export function u256(value: bigint): [bigint, bigint] {
  if (value < 0n) throw new RangeError('u256 cannot be negative')
  const MASK = (1n << 128n) - 1n
  return [value & MASK, value >> 128n]
}

/** Fluent builder. Every method returns a new plan rather than mutating one. */
export class PlanBuilder {
  readonly plan: Plan

  private constructor(plan: Plan) {
    this.plan = plan
  }

  static create(): PlanBuilder {
    return new PlanBuilder({ steps: [], outputs: [] })
  }

  /** An arbitrary call. This is the escape hatch that makes the router general. */
  call(step: Step): PlanBuilder {
    return new PlanBuilder({ ...this.plan, steps: [...this.plan.steps, step] })
  }

  /** Credit a token back into a shielded note. */
  creditTo(token: Felt, noteId: Felt, minAmount = 0n): PlanBuilder {
    return new PlanBuilder({
      ...this.plan,
      outputs: [...this.plan.outputs, { token, noteId, minAmount }],
    })
  }

  build(): Plan {
    validatePlan(this.plan)
    return this.plan
  }

  encode(poolAddress: Felt = POOL_ADDRESS): Felt[] {
    return encodePlan(this.build(), poolAddress)
  }
}
