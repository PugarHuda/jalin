import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  DEFAULT_LIMITS,
  PlanBuilder,
  POOL_ADDRESS,
  encodePlan,
  openNote,
  u256,
  unclaimedTokens,
  validatePlan,
  type Plan,
} from '../src/plan.ts'
import { callStep, oneWay } from '../src/recipes.ts'

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

test('a target that is not a felt is refused before it can be signed', () => {
  const plan = {
    steps: [{ target: 'not-an-address', selector: '0x1', approvals: [], calldata: [] }],
    outputs: [],
  }
  assert.throws(() => validatePlan(plan), /step 0 target is not a felt/)
})

test('placeholders are not felts yet and are left alone', () => {
  const plan = {
    steps: [{ target: POOL_ADDRESS, selector: '0x1', approvals: [], calldata: [openNote(0)] }],
    outputs: [],
  }
  assert.doesNotThrow(() => validatePlan(plan))
})

test('a value past the field prime is refused', () => {
  const prime = 2n ** 251n + 17n * 2n ** 192n + 1n
  const plan = {
    steps: [{ target: '0x1', selector: '0x1', approvals: [], calldata: [prime] }],
    outputs: [],
  }
  assert.throws(() => validatePlan(plan), /larger than the field prime/)
})

test('the field that is wrong is the field that is named', () => {
  const plan = {
    steps: [
      { target: '0x1', selector: '0x1', approvals: [{ token: 'oops', amount: 1n }], calldata: [] },
    ],
    outputs: [],
  }
  assert.throws(() => validatePlan(plan), /step 0 approval\[0\] token/)
})

test('encodePlan checks against the limits it is given, not a constant', () => {
  const step = { target: '0x1', selector: '0x2', approvals: [], calldata: [] }
  const plan = { steps: [step, step, step], outputs: [] }

  // Fine under the deployed defaults, and refused once governance tightens
  // max_steps to two. Encoding against a stale constant is how a plan gets a
  // proof generated for it and then reverts on chain.
  assert.doesNotThrow(() => encodePlan(plan))
  assert.throws(
    () => encodePlan(plan, undefined, { maxSteps: 2, maxCalldata: 64 }),
    /the router allows 2/,
  )
})

test('a loosened bound is honoured too', () => {
  const step = { target: '0x1', selector: '0x2', approvals: [], calldata: [] }
  const plan = { steps: Array.from({ length: 12 }, () => step), outputs: [] }

  assert.throws(() => encodePlan(plan), /the router allows 8/)
  assert.doesNotThrow(() =>
    encodePlan(plan, undefined, { maxSteps: 16, maxCalldata: 64 }),
  )
})
