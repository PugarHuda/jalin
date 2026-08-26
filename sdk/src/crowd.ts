/**
 * How large the anonymity set actually is.
 *
 * Every privacy tool says your anonymity depends on the size of the crowd and
 * then leaves you to guess the number. Shielding is public, so it is countable.
 *
 * Count arrivals, not exits. Two kinds of withdrawal have nothing to do with
 * anyone leaving the pool:
 *
 *  - **the fee leg.** Every pool transaction pays the fee collector, and that
 *    payment emits a `Withdrawal` naming it. Reported by Shoal on
 *    starkience/strk20-hackathon#121, whose first pass counted 334 "atomic
 *    shield and unshield" transactions that were every one a fee payment.
 *  - **the gas leg.** On STRK20 mainnet most withdrawals name the paymaster that
 *    relays gasless transactions. Filtering the fee collector alone removes
 *    nothing, which is how this one turns up.
 *
 * A withdrawal means a person left only if its destination is a person. A
 * deposit's `keys[1]` is unambiguously the depositor, so that is what this
 * counts.
 */

/** The minimum shape of a Starknet event this needs. */
export interface PoolEvent {
  keys: string[]
}

/**
 * Addresses that are infrastructure rather than people. Anything here is
 * excluded from the count.
 */
export interface Infrastructure {
  /** Relays gasless pool transactions. Its deposits are not a person arriving. */
  paymaster?: string
  /** Paid on every pool transaction. */
  feeCollector?: string
}

export interface Crowd {
  /** Distinct depositors, excluding known infrastructure. */
  depositors: number
  /** Deposit events seen, including any excluded ones. */
  deposits: number
  /** Addresses dropped as infrastructure, so the exclusion is visible. */
  excluded: number
}

/**
 * `keys[0]` is the event selector and `keys[1]` is the depositor, so an event
 * with fewer than two keys is not a deposit this can read and is skipped rather
 * than counted as an anonymous one.
 */
export function countDepositors(events: PoolEvent[], infra: Infrastructure = {}): Crowd {
  const ignore = new Set(
    [infra.paymaster, infra.feeCollector].filter(Boolean).map((a) => BigInt(a!).toString()),
  )

  const depositors = new Set<string>()
  let excluded = 0

  for (const event of events) {
    const who = event.keys?.[1]
    if (!who) continue
    let normalised: string
    try {
      normalised = BigInt(who).toString()
    } catch {
      continue
    }
    if (ignore.has(normalised)) {
      excluded += 1
      continue
    }
    depositors.add(normalised)
  }

  return { depositors: depositors.size, deposits: events.length, excluded }
}
