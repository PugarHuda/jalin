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
