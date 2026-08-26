import assert from 'node:assert/strict'
import { test } from 'node:test'
import { aggregate, linkabilityWarnings, strategyLabel } from '../src/subaccounts.ts'

const TOKEN_IN = '0x111'
const TOKEN_OUT = '0x222'

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
