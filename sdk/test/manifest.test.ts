import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseManifest } from '../src/receipt.ts'

const HASH = '0x6abbe003a51a29b634d8615517d231d469f3e009b4a1289a0e701efef057779'

const reason = (text: string) => {
  const result = parseManifest(text)
  assert.equal(result.ok, false)
  return (result as { reason: string }).reason
}

test('a real manifest is read', () => {
  const result = parseManifest(
    JSON.stringify({ transactions: [HASH], contracts: ['0x1'], demo_video: 'x', demo_url: 'y' }),
  )
  assert.equal(result.ok, true)
  assert.deepEqual(result.ok && result.manifest, {
    transactions: [HASH],
    contracts: ['0x1'],
    demoVideo: 'x',
    demoUrl: 'y',
  })
})

test('null is refused rather than crashing', () => {
  // JSON.parse('null') succeeds. Reading a property off the result is a
  // TypeError, which was a 500 for a file anybody can commit.
  assert.match(reason('null'), /must be a JSON object/)
})

test('an array, a string and a number are not manifests either', () => {
  // Each of these survives property access and would read as an empty manifest,
  // which is a worse answer than refusing it.
  for (const text of ['[]', '[1,2]', '"hello"', '123', 'true']) {
    assert.match(reason(text), /must be a JSON object/, `${text} should be refused`)
  }
})

test('a file that is not JSON says so', () => {
  assert.match(reason('<!doctype html>'), /not JSON/)
  assert.match(reason(''), /not JSON/)
})

test('missing fields are empty, not an error', () => {
  // A manifest early in a sprint has neither. That is a state to report, not a
  // malformed file.
  const result = parseManifest('{}')
  assert.equal(result.ok, true)
  assert.deepEqual(result.ok && result.manifest.transactions, [])
  assert.equal(result.ok && result.manifest.demoVideo, '')
})

test('null fields are treated as absent', () => {
  const result = parseManifest('{"transactions":null,"contracts":null}')
  assert.equal(result.ok, true)
  assert.deepEqual(result.ok && result.manifest.contracts, [])
})

test('a field of the wrong type is named', () => {
  assert.match(reason('{"transactions":"0xabc"}'), /transactions must be an array/)
  assert.match(reason('{"contracts":{}}'), /contracts must be an array/)
})

test('an entry that is not a felt is refused, not silently dropped', () => {
  assert.match(reason('{"transactions":["not-a-hash"]}'), /not a felt/)
  assert.match(reason('{"transactions":[123]}'), /not a felt/)
  assert.match(reason('{"contracts":["0xzz"]}'), /not a felt/)
})

test('a list longer than the limit is refused with the limit named', () => {
  const many = JSON.stringify({ transactions: Array.from({ length: 21 }, () => HASH) })
  assert.match(reason(many), /more than 20 entries/)
})

test('the limits are arguments, not constants', () => {
  const three = JSON.stringify({ transactions: [HASH, HASH, HASH] })
  assert.equal(parseManifest(three, { transactions: 3, contracts: 16 }).ok, true)
  assert.equal(parseManifest(three, { transactions: 2, contracts: 16 }).ok, false)
})

test('demo fields of the wrong type read as absent rather than throwing', () => {
  const result = parseManifest('{"demo_video":42,"demo_url":[]}')
  assert.equal(result.ok, true)
  assert.equal(result.ok && result.manifest.demoVideo, '')
  assert.equal(result.ok && result.manifest.demoUrl, '')
})
