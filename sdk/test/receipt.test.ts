import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkReceipt, countDistinct, describeVerdict, findDuplicates } from '../src/receipt.ts'

const POOL = '0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a'
const ROUTER = '0x008498d79ca390b34a6416cc45fb375ad9b921eefd8d4531d99a2d775feb3a7e'
const ELSEWHERE = '0x1234'

const receipt = (from: string[], status = 'SUCCEEDED') => ({
  execution_status: status,
  events: from.map((from_address) => ({ from_address })),
})

test('a transaction through our router against the pool counts', () => {
  const verdict = checkReceipt(receipt([POOL, ROUTER]), { pool: POOL, ours: [ROUTER] })
  assert.deepEqual(verdict, {
    exists: true,
    succeeded: true,
    touchedPool: true,
    throughOurs: true,
    qualifies: true,
  })
})

test('touching the pool is not enough once contracts are declared', () => {
  // This is the case that catches people: a real, successful pool transaction
  // that never went through the project's own contract.
  const verdict = checkReceipt(receipt([POOL]), { pool: POOL, ours: [ROUTER] })
  assert.equal(verdict.touchedPool, true)
  assert.equal(verdict.throughOurs, false)
  assert.equal(verdict.qualifies, false)
})

test('a project with no contracts is judged on the pool alone', () => {
  const verdict = checkReceipt(receipt([POOL]), { pool: POOL })
  assert.equal(verdict.throughOurs, null, 'the rule is conditional, not assumed')
  assert.equal(verdict.qualifies, true)
})

test('succeeding elsewhere does not count', () => {
  const verdict = checkReceipt(receipt([ELSEWHERE]), { pool: POOL, ours: [ROUTER] })
  assert.equal(verdict.succeeded, true)
  assert.equal(verdict.touchedPool, false)
  assert.equal(verdict.qualifies, false)
})

test('a revert never counts, whatever it touched', () => {
  const verdict = checkReceipt(receipt([POOL, ROUTER], 'REVERTED'), { pool: POOL, ours: [ROUTER] })
  assert.equal(verdict.qualifies, false)
})

test('addresses match by value, so padding does not hide the pool', () => {
  // 0x040337… and 0x40337… are the same address. Comparing strings would report
  // a transaction as missing the pool it plainly touched.
  const unpadded = '0x40337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a'
  assert.equal(checkReceipt(receipt([unpadded]), { pool: POOL }).touchedPool, true)
})

test('falls back to finality when execution status is absent', () => {
  const verdict = checkReceipt({ finality_status: 'SUCCEEDED', events: [{ from_address: POOL }] }, {
    pool: POOL,
  })
  assert.equal(verdict.succeeded, true)
})

test('a missing receipt is not found rather than a crash', () => {
  assert.equal(checkReceipt(null, { pool: POOL }).exists, false)
  assert.equal(checkReceipt(undefined, { pool: POOL }).qualifies, false)
})

test('every verdict has a sentence, and each says something different', () => {
  const lines = [
    describeVerdict(checkReceipt(null, { pool: POOL })),
    describeVerdict(checkReceipt(receipt([POOL], 'REVERTED'), { pool: POOL })),
    describeVerdict(checkReceipt(receipt([ELSEWHERE]), { pool: POOL })),
    describeVerdict(checkReceipt(receipt([POOL]), { pool: POOL, ours: [ROUTER] })),
    describeVerdict(checkReceipt(receipt([POOL, ROUTER]), { pool: POOL, ours: [ROUTER] })),
  ]
  assert.equal(new Set(lines).size, lines.length, 'no two outcomes read the same')
})

test('does not claim a contract that was never declared', () => {
  const line = describeVerdict(checkReceipt(receipt([POOL]), { pool: POOL }))
  assert.ok(!line.includes('our contract'), 'no contracts declared, none to credit')
  assert.ok(line.startsWith('counts:'))
})

test('a hash listed twice is reported once, in the order it appeared', () => {
  const found = findDuplicates(['0x1', '0x2', '0x1', '0x3', '0x2', '0x1'])
  assert.deepEqual(found, ['0x1', '0x2'])
})

test('padding does not hide a duplicate', () => {
  // 0x0abc and 0xabc are one transaction. The padded form is the one somebody
  // pastes out of a block explorer without noticing.
  assert.deepEqual(findDuplicates(['0xabc', '0x0abc']), ['0x0abc'])
  assert.equal(countDistinct(['0xabc', '0x0abc', '0x00000abc']), 1)
})

test('a list with no repeats has no duplicates', () => {
  assert.deepEqual(findDuplicates(['0x1', '0x2', '0x3']), [])
  assert.equal(countDistinct(['0x1', '0x2', '0x3']), 3)
})

test('an empty list is not a duplicate of anything', () => {
  assert.deepEqual(findDuplicates([]), [])
  assert.equal(countDistinct([]), 0)
})

test('an unparseable entry is skipped rather than crashing the count', () => {
  assert.deepEqual(findDuplicates(['0x1', 'nonsense', '0x1']), ['0x1'])
  assert.equal(countDistinct(['0x1', 'nonsense']), 1)
})

test('three copies of one hash are one transaction, not three', () => {
  // The whole point: a manifest padded this way passes a naive count and fails
  // the panel.
  const padded = ['0xdead', '0xdead', '0xdead']
  assert.equal(countDistinct(padded), 1)
  assert.deepEqual(findDuplicates(padded), ['0xdead'])
})
