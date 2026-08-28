import assert from 'node:assert/strict'
import { test } from 'node:test'
import { shadowInvoke } from '../src/shadow.ts'
import { strategyLabel } from '../src/subaccounts.ts'

const VAULT = '0x0028d709c875c0ceac3dce7065bec5328186dc89fe254527084d1689910954b0a'

test('builds a shadow account invoke in the Wallet API shape', () => {
  const action = shadowInvoke({
    dappName: strategyLabel('jalin', 'Endur stake'),
    nonce: 0n,
    calls: [{ contract: VAULT, entryPoint: 'deposit', calldata: [1000n, 0n, VAULT] }],
    collect: { type: 'diff' },
  })

  assert.equal(action.type, 'shadow_account_invoke')
  assert.equal(action.dapp_name, 'jalin:endur-stake')
  assert.equal(action.nonce, '0x0')
  // The Wallet API's spelling. `entry_point_selector` is the RPC one and is
  // refused with INVALID_REQUEST_PAYLOAD and no data naming the field.
  assert.deepEqual(Object.keys(action.calls[0]!), ['contract_address', 'entry_point', 'calldata'])
  assert.equal(action.calls[0]!.entry_point, 'deposit')
  // Leading zeros stripped: a non-canonical felt is a distinct case to the pool.
  assert.equal(action.calls[0]!.contract_address, `0x${BigInt(VAULT).toString(16)}`)
  assert.deepEqual(action.collect_policy, { type: 'diff' })
})

test('an exact collect policy carries a canonical amount', () => {
  const action = shadowInvoke({
    dappName: 'jalin',
    nonce: '0x01',
    calls: [{ contract: VAULT, entryPoint: 'withdraw' }],
    collect: { type: 'exact', amount: 5n * 10n ** 17n },
  })
  assert.deepEqual(action.collect_policy, { type: 'exact', amount: '0x6f05b59d3b20000' })
  assert.equal(action.nonce, '0x1')
  assert.equal('calldata' in action.calls[0]!, false)
})

test('refuses a dapp name the wallet could not encode as a short string', () => {
  assert.throws(
    () => shadowInvoke({ dappName: 'x'.repeat(32), nonce: 0n, calls: [{ contract: VAULT, entryPoint: 'deposit' }], collect: { type: 'all' } }),
    /31 characters/,
  )
  assert.throws(
    () => shadowInvoke({ dappName: 'jalin ✓', nonce: 0n, calls: [{ contract: VAULT, entryPoint: 'deposit' }], collect: { type: 'all' } }),
    /ASCII/,
  )
  // An explicit felt is the other form the type allows.
  assert.doesNotThrow(() =>
    shadowInvoke({ dappName: '0x6a616c696e', nonce: 0n, calls: [{ contract: VAULT, entryPoint: 'deposit' }], collect: { type: 'all' } }),
  )
})

test('refuses an empty call list and a selector where a name belongs', () => {
  assert.throws(
    () => shadowInvoke({ dappName: 'jalin', nonce: 0n, calls: [], collect: { type: 'all' } }),
    /at least one call/,
  )
  assert.throws(
    () =>
      shadowInvoke({
        dappName: 'jalin',
        nonce: 0n,
        calls: [{ contract: VAULT, entryPoint: '0x1bfd596ae442867ef71ca523061610682af8b00fc2738329422f4ad8d220b81' }],
        collect: { type: 'all' },
      }),
    /function's name, not its selector/,
  )
})
