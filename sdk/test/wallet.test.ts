import assert from 'node:assert/strict'
import { test } from 'node:test'
import { openNote, type Plan } from '../src/plan.ts'
import { previewCalldata, toInvokeCall, toWalletActions } from '../src/wallet.ts'

const ROUTER = '0xa11'
const USER = '0xc0ffee'
const TOKEN_IN = '0x111'
const TOKEN_OUT = '0x222'
const TOKEN_ALT = '0x333'

function plan(outputs: Plan['outputs']): Plan {
  return {
    steps: [
      {
        target: '0xdec',
        selector: '0x5a',
        approvals: [{ token: TOKEN_IN, amount: 1000n }],
        calldata: [TOKEN_IN],
      },
    ],
    outputs,
  }
}

const oneOutput = () => plan([{ token: TOKEN_OUT, noteId: openNote(0), minAmount: 990n }])

test('funds the router before it invokes, because the pool runs withdraw first', () => {
  const actions = toWalletActions(oneOutput(), {
    router: ROUTER,
    inputs: [{ token: TOKEN_IN, amount: 1000n }],
    recipient: USER,
  })

  assert.equal(actions[0]!.type, 'withdraw')
  assert.deepEqual(actions[0], {
    type: 'withdraw',
    token: TOKEN_IN,
    amount: '0x3e8',
    recipient: ROUTER,
  })
  assert.equal(actions.at(-1)!.type, 'invoke')
})

test('emits exactly one OPEN transfer per output, in output order', () => {
  const twoOutputs = plan([
    { token: TOKEN_OUT, noteId: openNote(0), minAmount: 0n },
    { token: TOKEN_ALT, noteId: openNote(1), minAmount: 0n },
  ])

  const actions = toWalletActions(twoOutputs, {
    router: ROUTER,
    inputs: [{ token: TOKEN_IN, amount: 1000n }],
    recipient: USER,
  })

  const opens = actions.filter((a) => a.type === 'transfer')
  assert.equal(opens.length, 2)
  // openNoteIds[0] is the first OPEN transfer, so this order is the numbering.
  assert.deepEqual(
    opens.map((a) => (a.type === 'transfer' ? a.token : null)),
    [TOKEN_OUT, TOKEN_ALT],
  )
  assert.ok(opens.every((a) => a.type === 'transfer' && a.amount === 'OPEN'))
})

test('refuses a plan whose note ids do not match their position', () => {
  // Silently wrong otherwise: the wallet resolves the placeholder, the router
  // credits a real amount, and it lands in the wrong note.
  const swapped = plan([
    { token: TOKEN_OUT, noteId: openNote(1), minAmount: 0n },
    { token: TOKEN_ALT, noteId: openNote(0), minAmount: 0n },
  ])

  assert.throws(
    () =>
      toWalletActions(swapped, {
        router: ROUTER,
        inputs: [{ token: TOKEN_IN, amount: 1000n }],
        recipient: USER,
      }),
    /output 0 carries note id .*expected .*openNoteIds\[0\]/,
  )
})

test('refuses a plan that approves tokens nothing funded', () => {
  assert.throws(
    () => toWalletActions(oneOutput(), { router: ROUTER, inputs: [], recipient: USER }),
    /never funded/,
  )
})

test('a plan is always one invoke, however many steps it has', () => {
  const many = oneOutput()
  many.steps.push({ ...many.steps[0]!, approvals: [] }, { ...many.steps[0]!, approvals: [] })

  const actions = toWalletActions(many, {
    router: ROUTER,
    inputs: [{ token: TOKEN_IN, amount: 1000n }],
    recipient: USER,
  })

  assert.equal(actions.filter((a) => a.type === 'invoke').length, 1)
})

test('preview shows hex felts and leaves placeholders readable', () => {
  const preview = previewCalldata(oneOutput())
  assert.equal(preview[0], '${poolAddress}')
  assert.ok(preview.includes('${openNoteIds[0]}'))
  assert.ok(preview.includes('0x3e8'), '1000 shown as hex')
})

test('the SDK route substitutes real note ids, never the placeholder', () => {
  // A wallet resolves ${openNoteIds[N]} itself; the SDK hands you the real id and
  // expects it substituted. Encoding the placeholder here would be a literal felt
  // and the pool would credit nothing.
  const call = toInvokeCall(oneOutput(), {
    router: ROUTER,
    openNotes: [{ noteId: 0xabcn, token: TOKEN_OUT }],
    poolAddress: '0xPOOL',
  })

  assert.equal(call.contractAddress, ROUTER)
  assert.ok(call.calldata.includes(0xabcn), 'real note id is in the calldata')
  assert.ok(
    !call.calldata.some((f) => typeof f === 'string' && f.startsWith('${')),
    'no placeholder survives into SDK calldata',
  )
})

test('refuses when an open note does not match its output token', () => {
  assert.throws(
    () =>
      toInvokeCall(oneOutput(), {
        router: ROUTER,
        openNotes: [{ noteId: 1n, token: TOKEN_ALT }],
        poolAddress: '0xPOOL',
      }),
    /is for token .* but open note 0 is for/,
  )
})

test('refuses when the note count does not match the output count', () => {
  assert.throws(
    () => toInvokeCall(oneOutput(), { router: ROUTER, openNotes: [], poolAddress: '0xPOOL' }),
    /matched by position/,
  )
})

test('there is no way to shield and spend in one transaction', () => {
  // Not an omission. Mainnet answers INSUFFICIENT_PRIVATE_BALANCE, and across
  // the pool's whole life no transaction carries both a Deposit and an invoke -
  // 342 and 247 of them respectively, zero in common. An option that builds a
  // transaction which reverts is worse than no option.
  const actions = toWalletActions(oneOutput(), {
    router: ROUTER,
    inputs: [{ token: TOKEN_IN, amount: 1000n }],
    recipient: USER,
  })

  assert.ok(
    !actions.some((action) => action.type === 'deposit'),
    'nothing here should build a deposit action',
  )
  assert.deepEqual(
    actions.map((a) => a.type),
    ['withdraw', 'transfer', 'invoke'],
  )
})

test('no bigint survives into wallet calldata', () => {
  // These go over JSON-RPC, and JSON.stringify throws on a bigint rather than
  // coercing it - which surfaces as INVALID_REQUEST_PAYLOAD from the wallet.
  const actions = toWalletActions(oneOutput(), {
    router: ROUTER,
    inputs: [{ token: TOKEN_IN, amount: 1000n }],
    recipient: USER,
  })

  const invoke = actions.find((a) => a.type === 'invoke')!
  assert.ok(invoke.type === 'invoke')
  assert.ok(
    invoke.calldata.every((f) => typeof f === 'string'),
    'every felt is a string',
  )
  assert.ok(invoke.calldata.includes('${openNoteIds[0]}'), 'placeholders survive')
  assert.doesNotThrow(() => JSON.stringify(actions))
})

test('every felt is canonical, leading zeros stripped', () => {
  // 0x0471… and 0x471… are the same number and not the same string. The STRK20
  // stack treats a non-canonically encoded address as its own case rather than
  // normalising it, so the wallet rejects the payload.
  const padded = '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d'
  const actions = toWalletActions(
    { steps: [{ target: padded, selector: '0x1', approvals: [], calldata: [] }], outputs: [{ token: padded, noteId: openNote(0), minAmount: 0n }] },
    { router: '0x008498d7', inputs: [{ token: padded, amount: 1000n }], recipient: '0x00abc' },
  )

  const felts = actions.flatMap((a): string[] => {
    if (a.type === 'invoke') return [a.contract, ...a.calldata]
    // A plan never emits one, and the union now admits it: the pool's actions
    // gained a fifth shape when shadow accounts reached the Wallet API.
    if (a.type === 'shadow_account_invoke') return [a.nonce]
    return [a.token, a.amount, 'recipient' in a ? a.recipient : '']
  })
  for (const felt of felts) {
    if (!felt || felt === 'OPEN' || felt.startsWith('${')) continue
    assert.ok(!/^0x0./.test(felt), `${felt} still carries a leading zero`)
  }
  assert.ok(felts.includes('${openNoteIds[0]}'), 'placeholders are never normalised')
})
