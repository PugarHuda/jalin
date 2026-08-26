import assert from 'node:assert/strict'
import { test } from 'node:test'
import { interpretRpc } from '../src/rpc-response.ts'

test('a normal answer comes back as a result', () => {
  const out = interpretRpc<number>(200, '{"jsonrpc":"2.0","id":1,"result":42}', 'x')
  assert.deepEqual(out, { ok: true, result: 42 })
})

test('a node error carries the node\'s own words and code', () => {
  const out = interpretRpc(
    200,
    '{"jsonrpc":"2.0","error":{"code":-32602,"message":"Invalid block id"}}',
    'starknet_call',
  )
  assert.equal(out.ok, false)
  assert.match((out as { message: string }).message, /Invalid block id \(-32602\)/)
})

test('a plain-text refusal says so instead of complaining about JSON', () => {
  // What an unauthenticated Alchemy key actually returns. The old path called
  // .json() on it and surfaced "Unexpected token 'M'".
  const out = interpretRpc(401, 'Must be authenticated!', 'starknet_call')
  assert.equal(out.ok, false)
  const { message, kind } = out as { message: string; kind: string }
  assert.match(message, /answered 401/)
  assert.match(message, /Must be authenticated/)
  assert.equal(kind, 'node')
})

test('an HTML error page is truncated rather than pasted whole', () => {
  const html = `<html><body>${'x'.repeat(5000)}</body></html>`
  const out = interpretRpc(502, html, 'starknet_call')
  const { message } = out as { message: string }
  assert.ok(message.length < 200, `expected a snippet, got ${message.length} characters`)
})

test('an empty body is named as empty', () => {
  const out = interpretRpc(504, '', 'starknet_call')
  assert.match((out as { message: string }).message, /\(empty body\)/)
})

test('a 200 with neither result nor error is not a success', () => {
  const out = interpretRpc(200, '{"jsonrpc":"2.0","id":1}', 'starknet_blockNumber')
  assert.equal(out.ok, false)
  assert.match((out as { message: string }).message, /starknet_blockNumber returned no result/)
})

test('a falsy result is still a result', () => {
  // Block zero, an empty span, false. Checking truthiness here would turn each
  // of them into an error.
  assert.deepEqual(interpretRpc(200, '{"result":0}', 'x'), { ok: true, result: 0 })
  assert.deepEqual(interpretRpc(200, '{"result":[]}', 'x'), { ok: true, result: [] })
  assert.deepEqual(interpretRpc(200, '{"result":false}', 'x'), { ok: true, result: false })
})

test('nothing it returns can carry the endpoint, because it is never given one', () => {
  // The URL holds an API key. This function takes a status, a body and a method
  // name, so there is no path by which one reaches a client.
  const out = interpretRpc(500, 'boom', 'starknet_call')
  assert.ok(!(out as { message: string }).message.includes('http'))
})
