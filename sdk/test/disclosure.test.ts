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

test('an address hiding in calldata is called out, because calldata is public', () => {
  const stranger = '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
  const plan = {
    steps: [
      {
        target: '0x28d709c875c0ceac3dce7065bec5328186dc89fe254527084d1689910954b0a',
        selector: '0x1',
        approvals: [],
        calldata: [1000n, 0n, stranger],
      },
    ],
    outputs: [],
  }

  const warning = describeDisclosure(plan as never).warnings.find((line) =>
    line.includes('Calldata carries'),
  )
  assert.ok(warning, 'the stranger should be named')
  assert.ok(warning.includes('0x123456789abcdef'), 'and named canonically')
})

test('the receiver being a contract the plan already names is not a stranger', () => {
  // deposit(assets, receiver) with the receiver set to the vault itself. It is
  // already listed as visible; repeating it as a warning would be noise.
  const vault = '0x28d709c875c0ceac3dce7065bec5328186dc89fe254527084d1689910954b0a'
  const plan = {
    steps: [{ target: vault, selector: '0x1', approvals: [], calldata: [1000n, 0n, vault] }],
    outputs: [],
  }

  const warnings = describeDisclosure(plan).warnings
  assert.ok(!warnings.some((line) => line.includes('Calldata carries')))
})

test('a placeholder is not an address leak', () => {
  const plan = {
    steps: [
      { target: '0x1', selector: '0x2', approvals: [], calldata: ['${poolAddress}'] },
    ],
    outputs: [],
  }
  const warnings = describeDisclosure(plan).warnings
  assert.ok(!warnings.some((line) => line.includes('Calldata carries')))
})

test('an amount is never mistaken for an address', () => {
  // Ten million tokens at eighteen decimals. Nowhere near 2^160.
  const plan = {
    steps: [
      { target: '0x1', selector: '0x2', approvals: [], calldata: [10_000_000n * 10n ** 18n] },
    ],
    outputs: [],
  }
  const warnings = describeDisclosure(plan).warnings
  assert.ok(!warnings.some((line) => line.includes('Calldata carries')))
})

test('calldata is named as public, not only the target and selector', () => {
  const plan = {
    steps: [{ target: '0x1', selector: '0x2', approvals: [], calldata: [] }],
    outputs: [],
  }
  const visible = describeDisclosure(plan).visible.join(' ')
  assert.ok(visible.includes('calldata'), 'the thing that leaked a ballot secret')
})
