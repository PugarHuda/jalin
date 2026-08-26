/**
 * A composed plan, small enough to be a link.
 *
 * A plan is worth showing somebody, and until now the only way was to describe
 * the typing. This encodes the draft — what a person actually filled in, decimal
 * amounts and all, not the felts it compiles to — so the link reopens the
 * composer exactly where they left it.
 *
 * Deliberately not a server-side store. A saved plan behind an id is a database,
 * an expiry policy and a thing that knows who looked at what; the whole draft
 * fits in the URL, so none of that has to exist.
 */

/** Matches the composer's form state field for field. */
export interface SharedStep {
  target: string
  selector: string
  approveToken: string
  approveAmount: string
  calldata: string
}

export interface SharedOutput {
  token: string
  minAmount: string
}

export interface SharedDraft {
  inputToken: string
  inputAmount: string
  steps: SharedStep[]
  outputs: SharedOutput[]
}

/**
 * Browsers, proxies and chat clients all disagree about how long a URL may be,
 * and the ones that disagree quietly are the problem. 4000 characters is under
 * every limit worth caring about and far past any plan the router will accept.
 */
export const MAX_SHARE_LENGTH = 4000

/** Tuple form: the field names are the same every time, so they are not sent. */
type Packed = [string, string, [string, string, string, string, string][], [string, string][]]

function pack(draft: SharedDraft): Packed {
  return [
    draft.inputToken,
    draft.inputAmount,
    draft.steps.map((step) => [
      step.target,
      step.selector,
      step.approveToken,
      step.approveAmount,
      step.calldata,
    ]),
    draft.outputs.map((output) => [output.token, output.minAmount]),
  ]
}

function unpack(packed: Packed): SharedDraft {
  const [inputToken, inputAmount, steps, outputs] = packed
  return {
    inputToken,
    inputAmount,
    steps: steps.map(([target, selector, approveToken, approveAmount, calldata]) => ({
      target,
      selector,
      approveToken,
      approveAmount,
      calldata,
    })),
    outputs: outputs.map(([token, minAmount]) => ({ token, minAmount })),
  }
}

/** base64url: `+/=` are all meaningful in a URL and `-_` are not. */
function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(encoded: string): string {
  const padded = encoded.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

export function encodeDraft(draft: SharedDraft): string {
  const encoded = toBase64Url(JSON.stringify(pack(draft)))
  if (encoded.length > MAX_SHARE_LENGTH) {
    throw new Error(
      `this plan encodes to ${encoded.length} characters, over the ${MAX_SHARE_LENGTH} a link can carry`,
    )
  }
  return encoded
}

/**
 * Returns null rather than throwing for anything malformed.
 *
 * The input is a URL somebody was handed, so it is untrusted and it is also
 * routinely damaged in transit — a chat client that ate the last character
 * should reopen an empty composer, not an error page.
 */
export function decodeDraft(encoded: string): SharedDraft | null {
  if (!encoded || encoded.length > MAX_SHARE_LENGTH) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(fromBase64Url(encoded))
  } catch {
    return null
  }

  if (!Array.isArray(parsed) || parsed.length !== 4) return null
  const [inputToken, inputAmount, steps, outputs] = parsed as Packed

  const isText = (value: unknown): value is string => typeof value === 'string'
  const isRow = (row: unknown, width: number) =>
    Array.isArray(row) && row.length === width && row.every(isText)

  if (!isText(inputToken) || !isText(inputAmount)) return null
  if (!Array.isArray(steps) || !steps.every((step) => isRow(step, 5))) return null
  if (!Array.isArray(outputs) || !outputs.every((output) => isRow(output, 2))) return null

  return unpack([inputToken, inputAmount, steps, outputs])
}
