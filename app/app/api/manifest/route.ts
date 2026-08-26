import {
  checkReceipt,
  countDistinct,
  describeVerdict,
  findDuplicates,
  parseManifest,
  type Verdict,
} from '@jalin/sdk'
import { RpcError, rpc } from '@/lib/rpc'
import { POOL_ADDRESS } from '@/lib/config'

/**
 * Judge a whole submission at once.
 *
 * /verify already answers for a hash you paste. A team's answer is in their
 * strk20.json, and copying three hashes and two addresses out of it by hand is
 * exactly the step at which people stop checking. This reads the file and
 * answers for all of it.
 *
 * The URL is built here and never accepted. Taking one from the caller would be
 * a server that fetches whatever it is told to - the cloud metadata endpoint,
 * something on the private network behind it - which is the same
 * server-side-request-forgery this project already removed once, when the
 * landing page fetched its own API using the incoming Host header.
 */
export const revalidate = 300

/** GitHub's own rules: alphanumerics, hyphen, underscore, dot; no slashes. */
const NAME = /^[A-Za-z0-9_.-]{1,100}$/

/** A branch, tag or commit. Slashes are legal in a branch name, `..` is not. */
const REF = /^[A-Za-z0-9_./-]{1,200}$/

const MAX_TRANSACTIONS = 20

/** A manifest is a small JSON file; anything larger is not one. */
const MAX_BYTES = 64 * 1024

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams
  const owner = params.get('owner')?.trim() ?? ''
  const repo = params.get('repo')?.trim() ?? ''
  const ref = params.get('ref')?.trim() || 'main'

  if (!NAME.test(owner) || !NAME.test(repo)) {
    return Response.json({ error: 'owner and repo must be GitHub names' }, { status: 400 })
  }
  if (!REF.test(ref) || ref.includes('..')) {
    return Response.json({ error: 'ref must be a branch, tag or commit' }, { status: 400 })
  }

  const source = `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/strk20.json`

  let text: string
  try {
    const response = await fetch(source, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
      next: { revalidate },
    })

    if (response.status === 404) {
      return Response.json(
        { error: `no strk20.json at ${owner}/${repo}@${ref}`, source },
        { status: 404 },
      )
    }
    if (!response.ok) {
      return Response.json({ error: `GitHub answered ${response.status}`, source }, { status: 502 })
    }

    text = await response.text()
    if (text.length > MAX_BYTES) {
      return Response.json({ error: 'that file is too large to be a manifest' }, { status: 413 })
    }
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError'
    return Response.json(
      { error: timedOut ? 'GitHub did not answer in time' : 'could not reach GitHub', source },
      { status: 502 },
    )
  }

  // Shape checking lives in the SDK, shared with the offline checker, so a team
  // gets the same answer whichever they run.
  const read = parseManifest(text, { transactions: MAX_TRANSACTIONS, contracts: 16 })
  if (!read.ok) {
    return Response.json({ error: read.reason, source }, { status: 422 })
  }

  const { transactions, contracts } = read.manifest

  // A manifest naming the same transaction three times has one transaction in
  // it. Answering "3 of 3 would count" tells a team exactly the thing that gets
  // them rejected, so the repeats are named and the count is of distinct ones.
  const duplicates = findDuplicates(transactions)

  // Read once per distinct hash. Sequential, because this reads a shared node
  // and twenty at once is how a public endpoint starts refusing everybody.
  const results: (Verdict & { hash: string; summary: string })[] = []
  const asked = new Set<string>()

  for (const hash of transactions) {
    const key = BigInt(hash).toString()
    if (asked.has(key)) continue
    asked.add(key)
    let receipt: unknown = null
    try {
      receipt = await rpc.receipt(hash)
    } catch (error) {
      if (error instanceof RpcError && error.kind === 'unconfigured') {
        return Response.json({ error: 'no rpc configured' }, { status: 503 })
      }
      // Not on chain is a verdict, not a failure.
    }

    const verdict = checkReceipt(receipt as never, { pool: POOL_ADDRESS, ours: contracts })
    results.push({ hash, ...verdict, summary: describeVerdict(verdict) })
  }

  const counted = results.filter((result) => result.qualifies).length

  return Response.json({
    source,
    contracts,
    counted,
    listed: countDistinct(transactions),
    /** Named so a team can see what a naive count would have hidden. */
    duplicates,
    /** The sprint asks for three that count. */
    enough: counted >= 3,
    hasDemoVideo: read.manifest.demoVideo.length > 0,
    results,
  })
}
