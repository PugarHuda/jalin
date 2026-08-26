/**
 * Does a transaction count?
 *
 * The sprint rules ask four things of every listed transaction: it exists, it
 * succeeded, it touched the STRK20 pool, and — if the project deployed contracts
 * — it ran through one of them. All four are decidable from the receipt, so
 * nobody has to wait for a panel to find out.
 *
 * The rules live here rather than in the script that checks the manifest,
 * because the demo asks the same question of a transaction it just submitted,
 * and two copies of a rule are two rules.
 */

/** The minimum shape of a Starknet receipt this needs. */
export interface ReceiptLike {
  execution_status?: string
  finality_status?: string
  events?: { from_address: string }[]
}

export interface Verdict {
  exists: boolean
  succeeded: boolean
  touchedPool: boolean
  /** null when no contracts are declared: the rule is conditional on having any. */
  throughOurs: boolean | null
  qualifies: boolean
}

const NOT_FOUND: Verdict = {
  exists: false,
  succeeded: false,
  touchedPool: false,
  throughOurs: null,
  qualifies: false,
}

function sameAddress(a: string, b: string): boolean {
  try {
    // 0x0abc and 0xABC are one address written two ways. Comparing the strings
    // would report a transaction as missing the pool it plainly touched.
    return BigInt(a) === BigInt(b)
  } catch {
    return false
  }
}

export function checkReceipt(
  receipt: ReceiptLike | null | undefined,
  context: { pool: string; ours?: string[] },
): Verdict {
  if (!receipt) return NOT_FOUND

  const succeeded = (receipt.execution_status ?? receipt.finality_status) === 'SUCCEEDED'
  const emitters = (receipt.events ?? []).map((event) => event.from_address)

  const touchedPool = emitters.some((address) => sameAddress(address, context.pool))
  const ours = context.ours ?? []
  const throughOurs =
    ours.length === 0 ? null : emitters.some((a) => ours.some((o) => sameAddress(a, o)))

  return {
    exists: true,
    succeeded,
    touchedPool,
    throughOurs,
    qualifies: succeeded && touchedPool && (throughOurs === null || throughOurs),
  }
}

/** One line a person can read, for a UI that has no room for four booleans. */
export function describeVerdict(verdict: Verdict): string {
  if (!verdict.exists) return 'not found on chain yet'
  if (!verdict.succeeded) return 'reverted'
  if (!verdict.touchedPool) return 'succeeded, but touched no pool event — it would not count'
  if (verdict.throughOurs === false) {
    return 'touched the pool, but not through a contract of ours — it would not count'
  }
  return verdict.throughOurs === null
    ? 'counts: succeeded and touched the pool'
    : 'counts: succeeded, touched the pool, ran through our contract'
}

/**
 * Hashes listed more than once, by value.
 *
 * A manifest that names the same transaction three times has one transaction in
 * it, and a checker that answers "3 of 3 would count" has told the team exactly
 * the thing that gets them rejected. Compared as felts rather than strings,
 * because `0x0abc` and `0xabc` are one hash written two ways and the padded
 * variant is the version somebody pastes without noticing.
 *
 * Returns each repeated hash once, in the order it first appeared.
 */
export function findDuplicates(hashes: string[]): string[] {
  const seen = new Set<string>()
  const repeated = new Set<string>()
  const order: string[] = []

  for (const hash of hashes) {
    let key: string
    try {
      key = BigInt(hash).toString()
    } catch {
      // Not a felt. Whatever else is wrong with it, it is not a duplicate.
      continue
    }

    if (seen.has(key)) {
      if (!repeated.has(key)) {
        repeated.add(key)
        order.push(hash)
      }
      continue
    }
    seen.add(key)
  }

  return order
}

/** Distinct transactions in a list, by felt value. */
export function countDistinct(hashes: string[]): number {
  const seen = new Set<string>()
  for (const hash of hashes) {
    try {
      seen.add(BigInt(hash).toString())
    } catch {
      // Ignored: an unparseable entry is not a transaction.
    }
  }
  return seen.size
}

export interface Manifest {
  transactions: string[]
  contracts: string[]
  demoVideo: string
  demoUrl: string
}

export type ManifestResult =
  | { ok: true; manifest: Manifest }
  | { ok: false; reason: string }

/**
 * Reads a strk20.json, or says why it cannot.
 *
 * Shared by the offline checker and the web one so a team gets the same answer
 * whichever they use. Pure, because these branches only run when a file is
 * already wrong, and that is exactly where untested code rots.
 *
 * The null case is not hypothetical: `JSON.parse('null')` succeeds and returns
 * null, so reading a property off the result is a TypeError - a crash for a
 * file anybody can commit and hand to a public endpoint.
 */
export function parseManifest(
  text: string,
  limits: { transactions: number; contracts: number } = { transactions: 20, contracts: 16 },
): ManifestResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ok: false, reason: 'that file is not JSON' }
  }

  // A string, a number and an array all survive property access and would read
  // as an empty manifest. Only an object is one.
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, reason: 'strk20.json must be a JSON object' }
  }

  const raw = parsed as Record<string, unknown>

  const felts = (value: unknown, limit: number, field: string): string[] | string => {
    if (value === undefined || value === null) return []
    if (!Array.isArray(value)) return `${field} must be an array`
    if (value.length > limit) return `${field} lists more than ${limit} entries`
    for (const entry of value) {
      if (typeof entry !== 'string' || !/^0x[0-9a-fA-F]{1,64}$/.test(entry)) {
        return `${field} contains something that is not a felt`
      }
    }
    return value as string[]
  }

  const transactions = felts(raw.transactions, limits.transactions, 'transactions')
  if (typeof transactions === 'string') return { ok: false, reason: transactions }

  const contracts = felts(raw.contracts, limits.contracts, 'contracts')
  if (typeof contracts === 'string') return { ok: false, reason: contracts }

  return {
    ok: true,
    manifest: {
      transactions,
      contracts,
      demoVideo: typeof raw.demo_video === 'string' ? raw.demo_video : '',
      demoUrl: typeof raw.demo_url === 'string' ? raw.demo_url : '',
    },
  }
}
