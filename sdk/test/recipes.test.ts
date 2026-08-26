import assert from 'node:assert/strict'
import { test } from 'node:test'
import { callStep, depositStep, oneWay } from '../src/recipes.ts'
import { encodePlan, u256, unclaimedTokens, validatePlan } from '../src/plan.ts'

/** Endur's xSTRK vault on mainnet, the contract depositStep was checked against. */
const ENDUR = '0x28d709c875c0ceac3dce7065bec5328186dc89fe254527084d1689910954b0a'
const STRK = '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d'
const ROUTER = '0x008498d79ca390b34a6416cc45fb375ad9b921eefd8d4531d99a2d775feb3a7e'
const DEPOSIT = '0x99' // stands in for selector!("deposit")

test('a step with nothing to spend approves nothing', () => {
  // A read-only call still belongs in a plan. Handing it an empty approvals
  // array rather than one of zero matters: I3 resets every approval a step
  // asked for, and an approval of zero is still an approval that happened.
  const step = callStep({ target: ENDUR, selector: DEPOSIT, calldata: [1n] })
  assert.deepEqual(step.approvals, [])
  assert.deepEqual(step.calldata, [1n])
})

test('a spend becomes exactly one approval for exactly that token', () => {
  const step = callStep({
    target: ENDUR,
    selector: DEPOSIT,
    spend: { token: STRK, amount: 250n },
    calldata: [],
  })
  assert.deepEqual(step.approvals, [{ token: STRK, amount: 250n }])
})

test('depositStep lays out ERC-4626 deposit(assets, receiver) in that order', () => {
  // The order is the standard's, checked against the deployed vault rather than
  // assumed. Getting it backwards would send the shares to an address parsed
  // from an amount, which is a loss that no revert catches.
  const step = depositStep({
    market: ENDUR,
    selector: DEPOSIT,
    asset: STRK,
    amount: 10n ** 18n,
    receiver: ROUTER,
  })

  assert.equal(step.target, ENDUR)
  assert.deepEqual(step.calldata, [...u256(10n ** 18n), ROUTER])
  assert.equal(step.calldata.length, 3, 'a u256 is two felts, the receiver is one')
  assert.equal(step.calldata.at(-1), ROUTER, 'the receiver is last')
})

test('the amount approved is the amount deposited', () => {
  // These come from one argument on purpose. Approving less than the calldata
  // asks for makes the vault revert; approving more leaves an allowance that
  // I3 then has to clear.
  const step = depositStep({
    market: ENDUR,
    selector: DEPOSIT,
    asset: STRK,
    amount: 7n,
    receiver: ROUTER,
  })
  assert.equal(step.approvals[0]!.amount, 7n)
  assert.deepEqual(step.calldata.slice(0, 2), u256(7n))
})

test('a deposit larger than one felt still splits correctly', () => {
  // Above 2^128 the high limb stops being zero, which is the only case where
  // the two-felt layout does any work.
  const big = 2n ** 130n + 5n
  const step = depositStep({
    market: ENDUR,
    selector: DEPOSIT,
    asset: STRK,
    amount: big,
    receiver: ROUTER,
  })
  const [low, high] = step.calldata as [bigint, bigint]
  assert.equal(low, big % 2n ** 128n)
  assert.equal(high, big / 2n ** 128n)
  assert.notEqual(high, 0n, 'this is the case the split exists for')
})

test('a zero deposit encodes rather than throwing', () => {
  // Nonsense to send, and not this function's call to make. The router's
  // min_amount is where a plan that returns nothing is caught.
  const step = depositStep({
    market: ENDUR,
    selector: DEPOSIT,
    asset: STRK,
    amount: 0n,
    receiver: ROUTER,
  })
  assert.deepEqual(step.calldata, [0n, 0n, ROUTER])
})

test('oneWay builds a plan that credits nothing back, and it validates', () => {
  const plan = oneWay(
    callStep({
      target: ENDUR,
      selector: DEPOSIT,
      spend: { token: STRK, amount: 100n },
      calldata: [],
    }),
  )

  assert.equal(plan.outputs.length, 0)
  assert.doesNotThrow(() => validatePlan(plan))
  assert.deepEqual(unclaimedTokens(plan), [STRK], 'the target has to take all of it')
  assert.equal(encodePlan(plan, '0x1').at(-1), 0n, 'outputs.len is zero on the wire')
})

test('a recipe produces the same felts as writing the step out by hand', () => {
  // The whole claim of this module: convenience, not capability. If these ever
  // diverge, a recipe has started doing something the general case cannot.
  const byHand = {
    target: ENDUR,
    selector: DEPOSIT,
    approvals: [{ token: STRK, amount: 42n }],
    calldata: [42n, 0n, ROUTER],
  }
  const byRecipe = depositStep({
    market: ENDUR,
    selector: DEPOSIT,
    asset: STRK,
    amount: 42n,
    receiver: ROUTER,
  })

  assert.deepEqual(
    encodePlan({ steps: [byRecipe], outputs: [] }, '0x1'),
    encodePlan({ steps: [byHand], outputs: [] }, '0x1'),
  )
})
