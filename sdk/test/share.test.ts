import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MAX_SHARE_LENGTH, decodeDraft, encodeDraft, type SharedDraft } from '../src/share.ts'

const STRK = '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d'
const ENDUR = '0x28d709c875c0ceac3dce7065bec5328186dc89fe254527084d1689910954b0a'

const draft = (): SharedDraft => ({
  inputToken: STRK,
  inputAmount: '0.25',
  steps: [
    {
      target: ENDUR,
      selector: 'deposit',
      approveToken: STRK,
      approveAmount: '0.25',
      calldata: '{amount:u256}\n0x008498d7',
    },
  ],
  outputs: [{ token: ENDUR, minAmount: '0.19' }],
})

test('a draft survives the round trip exactly', () => {
  const original = draft()
  assert.deepEqual(decodeDraft(encodeDraft(original)), original)
})

test('newlines in calldata survive, because that is how calldata is written', () => {
  const decoded = decodeDraft(encodeDraft(draft()))
  assert.equal(decoded!.steps[0]!.calldata.split('\n').length, 2)
})

test('the encoding is URL-safe', () => {
  // +, / and = all mean something in a URL. If any survives, a link breaks in
  // exactly the places that are hardest to notice.
  assert.match(encodeDraft(draft()), /^[A-Za-z0-9_-]+$/)
})

test('unicode in a field is not corrupted', () => {
  const odd = draft()
  odd.steps[0]!.selector = 'déposer→π'
  assert.equal(decodeDraft(encodeDraft(odd))!.steps[0]!.selector, 'déposer→π')
})

test('an empty draft is still a draft', () => {
  const empty: SharedDraft = { inputToken: '', inputAmount: '', steps: [], outputs: [] }
  assert.deepEqual(decodeDraft(encodeDraft(empty)), empty)
})

test('a preset-sized plan is comfortably under the limit', () => {
  // Measured at 456 characters: four 66-character addresses and the calldata.
  // The bar is a round number well above that and well under MAX_SHARE_LENGTH,
  // so this fails if the encoding stops being compact rather than because a
  // guess about its size turned out wrong.
  const length = encodeDraft(draft()).length
  assert.ok(length < 1000, `a real plan must fit in a chat message, got ${length}`)
  assert.ok(length * 4 < MAX_SHARE_LENGTH, 'and leave room for a plan four times the size')
})

test('a plan too large to be a link says so instead of producing a broken one', () => {
  const huge = draft()
  huge.steps[0]!.calldata = 'x'.repeat(MAX_SHARE_LENGTH * 2)
  assert.throws(() => encodeDraft(huge), /over the 4000 a link can carry/)
})

test('garbage decodes to null rather than throwing', () => {
  // The input is a URL somebody was handed. Every one of these should reopen an
  // empty composer, not an error page.
  for (const bad of ['', 'not-base64!!', 'YWJj', 'W10', 'eyJhIjoxfQ']) {
    assert.equal(decodeDraft(bad), null, `${bad} should not decode`)
  }
})

test('a truncated link decodes to null', () => {
  const encoded = encodeDraft(draft())
  assert.equal(decodeDraft(encoded.slice(0, -8)), null)
})

test('a well-formed array of the wrong shape is refused', () => {
  // Four elements, right types at the top, rows of the wrong width. Checking
  // only the outer shape would let this through and crash the composer.
  const wrong = btoa(JSON.stringify(['0x1', '1', [['a', 'b']], []]))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
  assert.equal(decodeDraft(wrong), null)
})

test('a row containing a non-string is refused', () => {
  const wrong = btoa(JSON.stringify(['0x1', '1', [], [['0x2', 5]]]))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
  assert.equal(decodeDraft(wrong), null)
})

test('an oversized input is rejected before it is parsed', () => {
  assert.equal(decodeDraft('A'.repeat(MAX_SHARE_LENGTH + 1)), null)
})
