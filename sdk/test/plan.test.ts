import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  DEFAULT_LIMITS,
  PlanBuilder,
  encodePlan,
  openNote,
  u256,
  unclaimedTokens,
  validatePlan,
  type Plan,
} from '../src/plan.ts'
import { callStep, oneWay } from '../src/recipes.ts'
import { aggregate, linkabilityWarnings, strategyLabel } from '../src/subaccounts.ts'

const TOKEN_IN = '0x111'
const TOKEN_OUT = '0x222'
const DEX = '0x333'
const SWAP = '0x444' // stands in for selector!("swap")

function swapPlan(): Plan {
  return {
    steps: [
      {
        target: DEX,
        selector: SWAP,
        approvals: [{ token: TOKEN_IN, amount: 1000n }],
        calldata: [TOKEN_IN, 1000n, 0n],
      },
    ],
    outputs: [{ token: TOKEN_OUT, noteId: openNote(0), minAmount: 990n }],
  }
}

test('encodes a plan in the layout the router deserialises', () => {
  const encoded = encodePlan(swapPlan(), '0xPOOL')

  assert.deepEqual(encoded, [
    '0xPOOL',
    1n, // steps.len
    DEX,
    SWAP,
    1n, // approvals.len
    TOKEN_IN,
    1000n,
    3n, // calldata.len
    TOKEN_IN,
    1000n,
    0n,
    1n, // outputs.len
    TOKEN_OUT,
    '${openNoteIds[0]}',
    990n,
  ])
})

test('leaves wallet placeholders intact so the wallet can resolve them', () => {
  const encoded = encodePlan(swapPlan())
  assert.equal(encoded[0], '${poolAddress}')
  assert.ok(encoded.includes('${openNoteIds[0]}'))
})

test('rejects a duplicate output token, matching the on-chain check', () => {
  const plan = swapPlan()
  plan.outputs.push({ token: TOKEN_OUT, noteId: openNote(1), minAmount: 0n })
  assert.throws(() => validatePlan(plan), /declared twice/)
})

test('rejects a plan with no steps, which would do nothing at all', () => {
  assert.throws(() => validatePlan({ steps: [], outputs: [] }), /at least one step/)
})

test('accepts a plan with no outputs, so value may leave without returning', () => {
  // Bridging, escrow funding and ballots all credit nothing back. The pool
  // accepts an empty Span; the residue rule is what keeps it honest.
  const away = oneWay(
    callStep({
      target: DEX,
      selector: SWAP,
      spend: { token: TOKEN_IN, amount: 1000n },
      calldata: [TOKEN_OUT],
    }),
  )
  assert.doesNotThrow(() => validatePlan(away))
  assert.deepEqual(unclaimedTokens(away), [TOKEN_IN], 'the target must take all of it')

  const encoded = encodePlan(away, '0xPOOL')
  assert.equal(encoded.at(-1), 0n, 'outputs.len is zero')
})

test('rejects a plan over the governed step bound before a proof is paid for', () => {
  const step = swapPlan().steps[0]!
  const plan: Plan = {
    steps: Array.from({ length: DEFAULT_LIMITS.maxSteps + 1 }, () => step),
    outputs: swapPlan().outputs,
  }
  assert.throws(() => validatePlan(plan), /the router allows/)
})

test('flags tokens a step may move that no output claims', () => {
  // These are exactly the tokens invariant I4 requires to end at zero.
  assert.deepEqual(unclaimedTokens(swapPlan()), [TOKEN_IN])

  const claimedBack = swapPlan()
  claimedBack.outputs.push({ token: TOKEN_IN, noteId: openNote(1), minAmount: 0n })
  assert.deepEqual(unclaimedTokens(claimedBack), [])
})

test('splits a u256 argument low-first', () => {
  assert.deepEqual(u256(0n), [0n, 0n])
  assert.deepEqual(u256((1n << 128n) - 1n), [(1n << 128n) - 1n, 0n])
  assert.deepEqual(u256(1n << 128n), [0n, 1n])
  assert.throws(() => u256(-1n), RangeError)
})

test('open note indices must be real indices', () => {
  assert.equal(openNote(2), '${openNoteIds[2]}')
  assert.throws(() => openNote(-1), RangeError)
  assert.throws(() => openNote(1.5), RangeError)
})

test('the builder produces the same bytes as the literal plan', () => {
  const built = PlanBuilder.create()
    .call(swapPlan().steps[0]!)
    .creditTo(TOKEN_OUT, openNote(0), 990n)
    .encode('0xPOOL')

  assert.deepEqual(built, encodePlan(swapPlan(), '0xPOOL'))
})

test('strategy labels are stable, or funds land in a different sub-account', () => {
  assert.equal(strategyLabel('Jalin', 'Yield Farm'), 'jalin:yield-farm')
  assert.equal(strategyLabel('  jalin  ', 'yield--farm'), 'jalin:yield-farm')
  assert.throws(() => strategyLabel('jalin', '!!!'), /non-empty/)
})

test('aggregates unlinkable positions into one balance sheet', () => {
  const lines = aggregate([
    { strategy: 'a', token: TOKEN_IN, amount: 100n },
    { strategy: 'b', token: TOKEN_IN, amount: 300n },
    { strategy: 'a', token: TOKEN_OUT, amount: 50n },
    { strategy: 'c', token: TOKEN_OUT, amount: 0n }, // dropped
  ])

  assert.equal(lines.length, 2)
  assert.equal(lines[0]!.token, TOKEN_IN)
  assert.equal(lines[0]!.total, 400n)
  assert.deepEqual(
    lines[0]!.byStrategy.map((s) => s.strategy),
    ['b', 'a'],
  )
  assert.equal(lines[1]!.byStrategy.length, 1)
})

test('says so when a portfolio has no internal anonymity', () => {
  const single = linkabilityWarnings([{ strategy: 'a', token: TOKEN_IN, amount: 1n }])
  assert.match(single[0]!, /one sub-account/)

  const spread = linkabilityWarnings([
    { strategy: 'a', token: TOKEN_IN, amount: 1n },
    { strategy: 'b', token: TOKEN_OUT, amount: 1n },
  ])
  assert.equal(spread.length, 2, 'each token is held by exactly one strategy')
})
