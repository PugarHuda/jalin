import assert from 'node:assert/strict'
import { test } from 'node:test'
import { describeDisclosure } from '../src/disclosure.ts'
import { openNote, type Plan } from '../src/plan.ts'

const TOKEN_IN = '0x111'
const TOKEN_OUT = '0x222'
const DEX = '0x333'
const SWAP = '0x444'

function planWith(amount: bigint, minAmount: bigint, outputs = true): Plan {
  return {
    steps: [
      {
        target: DEX,
        selector: SWAP,
        approvals: [{ token: TOKEN_IN, amount }],
        calldata: [TOKEN_IN],
      },
    ],
    outputs: outputs ? [{ token: TOKEN_OUT, noteId: openNote(0), minAmount }] : [],
  }
}

test('always says the amounts are public, because they are', () => {
  const { visible } = describeDisclosure(planWith(1000n, 990n))
  assert.ok(visible.some((v) => /how much/.test(v)))
  assert.ok(visible.some((v) => /selector/.test(v)))
})

test('says what the pool actually hides, and no more', () => {
  const { hidden } = describeDisclosure(planWith(1000n, 990n))
  assert.ok(hidden.some((h) => /which shielded note/i.test(h)))
  assert.ok(
    !hidden.some((h) => /amount/i.test(h)),
    'amounts are never hidden and must never be claimed as hidden',
  )
})

test('warns that a single-step plan hides who, not what', () => {
  const { warnings } = describeDisclosure(planWith(1000n, 990n))
  assert.ok(warnings.some((w) => /single-step/.test(w)))
})

test('credits a multi-step plan with closing the correlation gap', () => {
  const plan = planWith(1000n, 990n)
  plan.steps.push({ ...plan.steps[0]!, approvals: [] })
  const { hidden, warnings } = describeDisclosure(plan)
  assert.ok(hidden.some((h) => /no gap between them/.test(h)))
  assert.ok(!warnings.some((w) => /single-step/.test(w)))
})

test('flags a floor of zero, which accepts a hostile route', () => {
  const { warnings } = describeDisclosure(planWith(1000n, 0n))
  assert.ok(warnings.some((w) => /set a floor/.test(w)))
})

test('flags a distinctive amount but leaves round ones alone', () => {
  const odd = describeDisclosure(planWith(133742n, 1n))
  assert.ok(odd.warnings.some((w) => /distinctive/.test(w)))

  const round = describeDisclosure(planWith(1000000n, 1n))
  assert.ok(!round.warnings.some((w) => /distinctive/.test(w)))
})

test('says out loud when a plan sends value away for good', () => {
  const { visible, warnings } = describeDisclosure(planWith(1000n, 0n, false))
  assert.ok(visible.some((v) => /left entirely/.test(v)))
  assert.ok(warnings.some((w) => /away for good/.test(w)))
})
