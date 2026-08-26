/**
 * Reading a JSON-RPC reply, including the replies that are not JSON.
 *
 * A node under load, behind a proxy, or holding a rejected key answers with
 * plain text or HTML. Calling `.json()` on that throws a SyntaxError whose
 * message is "Unexpected token 'M'" — which is what a caller saw instead of
 * "the node rejected this request", and which never mentions the status code
 * that would have explained it.
 *
 * Pure so it can be tested: the failure paths here are the ones that only run
 * when something is already wrong, which is exactly where untested code rots.
 */

export type RpcOutcome<T> =
  | { ok: true; result: T }
  | { ok: false; kind: 'node' | 'transport'; message: string }

/** Enough of a non-JSON body to recognise it, and no more. */
const SNIPPET = 120

export function interpretRpc<T>(
  status: number,
  body: string,
  method: string,
): RpcOutcome<T> {
  const trimmed = body.trim()

  let parsed: { result?: T; error?: { message?: string; code?: number } } | undefined
  try {
    parsed = JSON.parse(trimmed) as typeof parsed
  } catch {
    // Not JSON at all. The status is the useful part; the body is a hint.
    const hint = trimmed.slice(0, SNIPPET) || '(empty body)'
    return {
      ok: false,
      kind: status >= 400 ? 'node' : 'transport',
      message:
        status >= 400
          ? `the node answered ${status} and not JSON: ${hint}`
          : `the node answered ${status} with something that is not JSON: ${hint}`,
    }
  }

  if (parsed?.error) {
    const code = parsed.error.code === undefined ? '' : ` (${parsed.error.code})`
    return { ok: false, kind: 'node', message: `${parsed.error.message ?? 'no message'}${code}` }
  }

  if (status >= 400) {
    return { ok: false, kind: 'node', message: `the node answered ${status}` }
  }

  if (parsed?.result === undefined) {
    return { ok: false, kind: 'node', message: `${method} returned no result` }
  }

  return { ok: true, result: parsed.result }
}
