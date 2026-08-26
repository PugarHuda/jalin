import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  CELL_BLOCKS,
  effectiveSet,
  measureCells,
  prospectFor,
  summariseCells,
} from '../src/anonymity.ts'

const STRK = '0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d'
const ETH = '0x49d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7'

const deposit = (who: string, asset: string, amount: bigint, block = 0) => ({
  keys: ['0xdeposit', who, asset],
  data: [`0x${amount.toString(16)}`],
  block_number: block,
})

test('one participant is a crowd of one, not of zero', () => {
  assert.equal(effectiveSet([100n]), 1)
})

test('equal participants give exactly their number', () => {
  assert.equal(effectiveSet([50n, 50n]), 2)
  assert.equal(effectiveSet([25n, 25n, 25n, 25n]), 4)
})

test('a headcount flatters a cell one address dominates', () => {
  // Four addresses, one holding 97% of the flow. Counting heads says four.
  const lopsided = effectiveSet([970n, 10n, 10n, 10n])
  assert.ok(lopsided < 1.5, `expected close to one, got ${lopsided}`)
  assert.ok(lopsided > 1)
})

test('different assets do not hide each other', () => {
  const cells = measureCells([deposit('0x1', STRK, 10n ** 18n), deposit('0x2', ETH, 10n ** 18n)])
  assert.equal(cells.length, 2, 'one cell each')
  assert.deepEqual(
    cells.map((cell) => cell.headcount),
    [1, 1],
  )
})

test('different orders of magnitude do not hide each other', () => {
  // 1 STRK and 1000 STRK are visibly different on the public leg.
  const cells = measureCells([
    deposit('0x1', STRK, 10n ** 18n),
    deposit('0x2', STRK, 1000n * 10n ** 18n),
  ])
  assert.equal(cells.length, 2)
})

test('the same magnitude in the same window is one crowd', () => {
  const cells = measureCells([
    deposit('0x1', STRK, 2n * 10n ** 18n),
    deposit('0x2', STRK, 3n * 10n ** 18n),
  ])
  assert.equal(cells.length, 1)
  assert.equal(cells[0]!.headcount, 2)
})

test('time separates a crowd too', () => {
  const cells = measureCells([
    deposit('0x1', STRK, 10n ** 18n, 0),
    deposit('0x2', STRK, 10n ** 18n, CELL_BLOCKS + 1),
  ])
  assert.equal(cells.length, 2, 'a day apart is not a crowd')
})

test('one address depositing twice is still one address', () => {
  const cells = measureCells([
    deposit('0x1', STRK, 10n ** 18n),
    deposit('0x0001', STRK, 2n * 10n ** 18n),
  ])
  assert.equal(cells.length, 1)
  assert.equal(cells[0]!.headcount, 1, 'padding is not a second person')
  assert.equal(cells[0]!.effectiveSet, 1)
})

test('a summary of nothing is zero rather than a crash', () => {
  const summary = summariseCells([])
  assert.equal(summary.cells, 0)
  assert.equal(summary.medianEffectiveSet, 0)
})

test('the median is the middle cell, not the mean', () => {
  const summary = summariseCells([
    { asset: 'a', magnitude: 1, slot: 0, headcount: 1, effectiveSet: 1 },
    { asset: 'b', magnitude: 1, slot: 0, headcount: 1, effectiveSet: 1 },
    { asset: 'c', magnitude: 1, slot: 0, headcount: 9, effectiveSet: 9 },
  ])
  assert.equal(summary.medianEffectiveSet, 1, 'one large cell does not lift the middle')
  assert.equal(summary.largestEffectiveSet, 9)
  assert.ok(Math.abs(summary.aloneShare - 2 / 3) < 1e-9)
})

test('a deposit into an empty cell stands alone', () => {
  const prospect = prospectFor([], { asset: STRK, amount: 10n ** 18n, atBlock: 100 })
  assert.equal(prospect.headcount, 0)
  assert.equal(prospect.effectiveSet, 0)
  assert.equal(prospect.effectiveSetAfter, 1, 'alone is a crowd of one')
})

test('a deposit joining an equal peer makes a crowd of two', () => {
  const prospect = prospectFor([deposit('0x1', STRK, 10n ** 18n, 100)], {
    asset: STRK,
    amount: 10n ** 18n,
    atBlock: 100,
  })
  assert.equal(prospect.headcount, 1)
  assert.equal(prospect.effectiveSetAfter, 2)
})

test('joining a cell you dwarf does not buy you a crowd', () => {
  // Depositing 1000x what is already there is standing alone in a loud shirt.
  const prospect = prospectFor([deposit('0x1', STRK, 10n ** 18n, 100)], {
    asset: STRK,
    amount: 1000n * 10n ** 18n,
    atBlock: 100,
  })
  assert.equal(prospect.headcount, 0, 'a different magnitude is a different cell')
  assert.equal(prospect.effectiveSetAfter, 1)
})

test('a zero deposit is not a question about crowds', () => {
  const prospect = prospectFor([], { asset: STRK, amount: 0n, atBlock: 1 })
  assert.equal(prospect.effectiveSetAfter, 0)
})
