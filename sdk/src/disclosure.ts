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

/**
 * A felt too large to be an amount is almost certainly an address.
 *
 * Starknet addresses run to 2^251; token amounts, even eighteen decimals of a
 * whale's position, do not reach 2^160. There is no ambiguity in practice, and
 * the cost of a false positive here is one sentence of caution.
 */
const ADDRESS_SHAPED = 2n ** 160n

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
    'Every contract this plan calls, the selector it calls, and every felt of calldata it is called with. An invoke action carries all three in the clear.',
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

  // Calldata is public. An address sitting in it that is not one of the
  // contracts already named is a party to the plan the plan is naming out loud,
  // and if it is the author's own account then the pool hid nothing.
  const named = new Set(
    [
      ...plan.steps.map((step) => String(BigInt(step.target))),
      ...plan.steps.flatMap((step) => step.approvals.map((a) => String(BigInt(a.token)))),
      ...plan.outputs.map((output) => String(BigInt(output.token))),
    ],
  )

  const strangers = new Set<string>()
  for (const step of plan.steps) {
    for (const felt of step.calldata) {
      // Placeholders are resolved by the wallet, so there is nothing to leak.
      if (typeof felt === 'string' && felt.startsWith('${')) continue
      let value: bigint
      try {
        value = BigInt(felt)
      } catch {
        continue
      }
      if (value < ADDRESS_SHAPED) continue
      if (named.has(String(value))) continue
      strangers.add(`0x${value.toString(16)}`)
    }
  }

  if (strangers.size > 0) {
    warnings.push(
      `Calldata carries ${[...strangers].slice(0, 3).join(', ')}, which ${strangers.size === 1 ? 'is an address' : 'are addresses'} this plan does not otherwise name. Calldata is public. If one of them is your own account, the plan says so in the clear and the pool hid nothing.`,
    )
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
