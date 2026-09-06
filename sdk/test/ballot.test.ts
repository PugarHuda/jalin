import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  ballotStage,
  BALLOT_OPS,
  BALLOT_SUPPORT,
  castBallotActions,
  decodeBallot,
  redeemBallotActions,
} from '../src/ballot.ts'

const GOVERNOR = '0x60'
const STRK = '0x5'
const USER = '0xc0ffee'
const SECRET = '0xdeadbeef'
const COMMITMENT = '0xc0'

test('a cast stakes to the governor, not to the router', () => {
  const [withdraw] = castBallotActions({
    governor: GOVERNOR,
    proposalId: 3n,
    amount: 6_000_000_000_000_000_000n,
    commitment: COMMITMENT,
    ballotToken: STRK,
  })

  assert.deepEqual(withdraw, {
    type: 'withdraw',
    token: '0x5',
    amount: '0x53444835ec580000',
    recipient: '0x60',
  })
})

test('a cast carries the commitment and never the secret', () => {
  const actions = castBallotActions({
    governor: GOVERNOR,
    proposalId: 3n,
    amount: 100n,
    commitment: COMMITMENT,
    ballotToken: STRK,
  })

  const invoke = actions[1]!
  assert.equal(invoke.type, 'invoke')
  assert.deepEqual(invoke.type === 'invoke' ? invoke.calldata : [], [
    '${poolAddress}',
    '0x0',
    '0x3',
    '0x1',
    '0xc0',
    // The secret slot. Filling it would publish the bearer instrument.
    '0x0',
    '0x64',
    '0x0',
  ])
})

test('a cast can be a no', () => {
  const actions = castBallotActions({
    governor: GOVERNOR,
    proposalId: 1n,
    amount: 1n,
    commitment: COMMITMENT,
    ballotToken: STRK,
    support: BALLOT_SUPPORT.NO,
  })

  const invoke = actions[1]!
  assert.equal(invoke.type === 'invoke' ? invoke.calldata[3] : null, '0x0')
})

test('a cast refuses a proposal id of zero, which is not a proposal', () => {
  assert.throws(
    () =>
      castBallotActions({
        governor: GOVERNOR,
        proposalId: 0n,
        amount: 1n,
        commitment: COMMITMENT,
        ballotToken: STRK,
      }),
    RangeError,
  )
})

test('a cast refuses a weightless ballot', () => {
  assert.throws(
    () =>
      castBallotActions({
        governor: GOVERNOR,
        proposalId: 1n,
        amount: 0n,
        commitment: COMMITMENT,
        ballotToken: STRK,
      }),
    RangeError,
  )
})

test('a redeem declares the open note the governor credits back', () => {
  const actions = redeemBallotActions({
    governor: GOVERNOR,
    secret: SECRET,
    ballotToken: STRK,
    recipient: USER,
  })

  assert.equal(actions.length, 2)
  assert.deepEqual(actions[0], {
    type: 'transfer',
    token: '0x5',
    amount: 'OPEN',
    recipient: '0xc0ffee',
  })

  const invoke = actions[1]!
  assert.equal(invoke.type, 'invoke')
  assert.deepEqual(invoke.type === 'invoke' ? invoke.calldata : [], [
    '${poolAddress}',
    '0x1',
    '0x0',
    '0x0',
    '0x0',
    '0xdeadbeef',
    '0x0',
    '${openNoteIds[0]}',
  ])
})

test('the two operations differ in the felt the governor switches on', () => {
  const cast = castBallotActions({
    governor: GOVERNOR,
    proposalId: 1n,
    amount: 1n,
    commitment: COMMITMENT,
    ballotToken: STRK,
  })[1]!
  const redeem = redeemBallotActions({
    governor: GOVERNOR,
    secret: SECRET,
    ballotToken: STRK,
    recipient: USER,
  })[1]!

  const op = (action: typeof cast) =>
    action.type === 'invoke' ? BigInt(action.calldata[1]!) : null

  assert.equal(op(cast), BALLOT_OPS.CAST)
  assert.equal(op(redeem), BALLOT_OPS.REDEEM)
})

test('a redeem refuses a zero secret rather than sending one', () => {
  assert.throws(
    () => redeemBallotActions({ governor: GOVERNOR, secret: 0n, ballotToken: STRK, recipient: USER }),
    RangeError,
  )
})

test('a commitment nobody staked against decodes as no ballot', () => {
  const ballot = decodeBallot(['0x0', '0x0', '0x0'])
  assert.deepEqual(ballot, { proposalId: 0n, amount: 0n, claimed: false })
  assert.deepEqual(ballotStage(ballot, { endBlock: 10 }, 5), { name: 'unknown' })
})

test('a short answer is refused rather than read as an empty ballot', () => {
  assert.throws(() => decodeBallot(['0x1', '0x2']), /three felts/)
})

test('voting is open through end_block and redemption opens the block after', () => {
  const ballot = decodeBallot(['0x2', '0x64', '0x0'])

  assert.deepEqual(ballotStage(ballot, { endBlock: 100 }, 99), { name: 'voting', blocksLeft: 2 })
  // The contract asserts `get_block_number() > end_block`, so end_block itself
  // is still voting rather than the first redeemable block.
  assert.deepEqual(ballotStage(ballot, { endBlock: 100 }, 100), { name: 'voting', blocksLeft: 1 })
  assert.deepEqual(ballotStage(ballot, { endBlock: 100 }, 101), { name: 'redeemable' })
})

test('a spent secret reads as claimed whatever the block is', () => {
  const ballot = decodeBallot(['0x2', '0x64', '0x1'])
  assert.deepEqual(ballotStage(ballot, { endBlock: 100 }, 101), { name: 'claimed' })
  assert.deepEqual(ballotStage(ballot, { endBlock: 100 }, 5), { name: 'claimed' })
})
