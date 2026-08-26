import assert from 'node:assert/strict'
import { test } from 'node:test'
import { countDepositors } from '../src/crowd.ts'

const DEPOSIT = '0x9149d2123147'
const PAYMASTER = '0x127021a1b5a52d3174c2ab077c2b043c80369250d29428cee956d76ee51584f'
const COLLECTOR = '0xd79041634625e5288296fbc648088788710ba44903a3a49468a66567749e77'

const deposit = (who: string) => ({ keys: [DEPOSIT, who, '0x4718f5a'] })

test('counts distinct depositors, not deposits', () => {
  const crowd = countDepositors([deposit('0xa'), deposit('0xb'), deposit('0xa')])
  assert.equal(crowd.deposits, 3)
  assert.equal(crowd.depositors, 2, 'the same address twice is one person')
})

test('drops the paymaster, which relays and does not arrive', () => {
  const crowd = countDepositors([deposit('0xa'), deposit(PAYMASTER), deposit('0xb')], {
    paymaster: PAYMASTER,
  })
  assert.equal(crowd.depositors, 2)
  assert.equal(crowd.excluded, 1, 'the exclusion is reported, not silent')
})

test('drops the fee collector too', () => {
  const crowd = countDepositors([deposit('0xa'), deposit(COLLECTOR)], {
    paymaster: PAYMASTER,
    feeCollector: COLLECTOR,
  })
  assert.equal(crowd.depositors, 1)
  assert.equal(crowd.excluded, 1)
})

test('matches addresses by value, not by how they are written', () => {
  // 0x0a and 0xA and 0xa are the same address. Counting them as three people
  // would inflate the crowd, which is the one number that must not be flattered.
  const crowd = countDepositors([deposit('0x0a'), deposit('0xA'), deposit('0xa')])
  assert.equal(crowd.depositors, 1)
})

test('normalises the excluded addresses the same way', () => {
  const crowd = countDepositors([deposit('0x0a')], { paymaster: '0xa' })
  assert.equal(crowd.depositors, 0)
  assert.equal(crowd.excluded, 1)
})

test('skips events it cannot read rather than counting them as someone', () => {
  const crowd = countDepositors([
    deposit('0xa'),
    { keys: [DEPOSIT] },
    { keys: [DEPOSIT, 'not-a-felt'] },
  ])
  assert.equal(crowd.depositors, 1)
  assert.equal(crowd.deposits, 3, 'still reports what it saw')
})

test('an empty pool is a crowd of nobody, not a crash', () => {
  assert.deepEqual(countDepositors([]), { depositors: 0, deposits: 0, excluded: 0 })
})
