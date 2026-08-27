/**
 * A JSON-RPC error carries a code and usually a `data` field naming the field it
 * rejected. `error.message` alone reduces all of that to "An error occurred
 * (INVALID_REQUEST_PAYLOAD)", which is the difference between a fix and a guess.
 *
 * This lived in the composer, which is where the lesson was learned. The
 * governance page kept `error.message` and paid for it: a propose call carrying
 * one field too many was refused with exactly that sentence, and the `data`
 * naming the field was thrown away before anyone could read it.
 */
export function describeError(error: unknown): string {
  const parts: string[] = []
  const anyError = error as { message?: string; code?: unknown; data?: unknown }
  if (anyError?.message) parts.push(anyError.message)
  else parts.push(String(error))
  if (anyError?.code !== undefined) parts.push(`code ${String(anyError.code)}`)
  if (anyError?.data !== undefined) {
    try {
      parts.push(`data ${JSON.stringify(anyError.data)}`)
    } catch {
      parts.push(`data ${String(anyError.data)}`)
    }
  }
  return parts.join(' · ')
}
