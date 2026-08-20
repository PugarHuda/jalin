/**
 * What a plan reveals.
 *
 * The pool hides which note paid for a plan. It does not hide that the plan
 * happened, and it does not hide a single amount. Most privacy mistakes are made
 * by people who believed they were private, so this module says out loud what an
 * observer sees before the plan is signed rather than after.
 *
 * Everything here is derived from the plan alone. It cannot see the anonymity set,
 * it cannot see your other activity, and it does not pretend to score you.
 */

import { unclaimedTokens, type Plan } from './plan.ts'

export interface Disclosure {
  /** What an observer cannot learn from this transaction. */
  hidden: string[]
  /** What an observer can read directly off the chain. */
  visible: string[]
  /** Choices in this particular plan that give privacy back. */
  warnings: string[]
}

/** Amounts that look chosen rather than drawn from a crowd. */
function isDistinctive(amount: bigint): boolean {
  if (amount === 0n) return false
  // Round to some power of ten, or a clean multiple of one, and it hides in a
  // crowd of similar transfers. Everything else is close to a fingerprint.
  const text = amount.toString()
  const trailingZeros = text.length - text.replace(/0+$/, '').length
  return trailingZeros < Math.max(1, Math.floor(text.length / 2))
}

export function describeDisclosure(plan: Plan): Disclosure {
  const hidden = [
    'Which shielded note funded this plan.',
    'Which address authored it. The pool pays the router, and the pool is the only party that knows who asked.',
  ]

  const visible = [
    'That the pool transferred tokens to the Jalin router, and how much.',
    'Every contract this plan calls, and the selector it calls.',
    'The amount credited back into a note, because the pool pulls it by allowance.',
  ]

  const warnings: string[] = []

  if (plan.steps.length > 1) {
    hidden.push(
      `That the ${plan.steps.length} legs belong to separate intentions. They are one transaction, so there is no gap between them to correlate.`,
    )
  } else {
    warnings.push(
      'A single-step plan reveals the same action a direct call would. What it hides is who did it, not what was done.',
    )
  }

  const leaving = unclaimedTokens(plan)
  if (leaving.length > 0) {
    visible.push(
      `That ${leaving.length === 1 ? 'a token' : `${leaving.length} tokens`} left entirely: ${leaving.join(', ')}. Where they went is as public as the contract that took them.`,
    )
  }

  for (const output of plan.outputs) {
    if (output.minAmount === 0n) {
      warnings.push(
        `Output ${output.token} accepts any amount above zero. A route that returns almost nothing would still succeed; set a floor.`,
      )
    }
  }

  const amounts = plan.steps.flatMap((step) => step.approvals.map((a) => a.amount))
  const distinctive = amounts.filter(isDistinctive)
  if (distinctive.length > 0) {
    warnings.push(
      `Amounts like ${distinctive.slice(0, 3).join(', ')} are distinctive enough to match against a shield or a withdrawal by size alone. Rounder numbers sit in a larger crowd.`,
    )
  }

  if (plan.outputs.length === 0) {
    warnings.push(
      'Nothing is credited back, so this plan sends value away for good. Check the destination is somewhere you meant, because the router will not stop it.',
    )
  }

  return { hidden, visible, warnings }
}
