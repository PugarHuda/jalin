import type { PoolEvent } from './crowd.ts'

/**
 * How big is the crowd you actually hide in?
 *
 * Not the pool's headcount. A shielded pool does not mix everything with
 * everything: an observer watching the public deposit leg sees the asset, the
 * order of magnitude, and roughly when. Two deposits only hide each other if
 * they agree on all three. So the set that matters is the cell, not the pool,
 * and on this pool the median cell holds one person.
 *
 * Headcount also flatters a cell where one address carries nearly all the
 * volume. Four addresses, one holding 97% of the flow, is not a crowd of four.
 * The effective set is the perplexity of the flow distribution, 2^H — four
 * equal participants give exactly 4, and the lopsided four give about 1.2.
 */

/** ~6 hours at Starknet mainnet's measured 1.68s per block. */
export const CELL_BLOCKS = 12_888

export interface Cell {
  asset: string
  /** Digits in the raw amount. Decimals-agnostic, and the asset is in the key. */
  magnitude: number
  /** Which CELL_BLOCKS-wide slot of the chain. */
  slot: number
  /** Distinct depositors in the cell. */
  headcount: number
  /** Perplexity of the flow distribution: the crowd this cell really is. */
  effectiveSet: number
}

interface Deposit {
  who: string
  asset: string
  amount: bigint
  block: number
}

/** `keys[1]` is the depositor, `keys[2]` the asset, `data[0]` the amount. */
function read(events: PoolEvent[]): Deposit[] {
  const deposits: Deposit[] = []

  for (const event of events) {
    if (!event.keys || event.keys.length < 3) continue
    const amount = BigInt(event.data?.[0] ?? '0x0')
    if (amount === 0n) continue

    deposits.push({
      // By value, so a padded address is the same address.
      who: BigInt(event.keys[1]!).toString(),
      asset: BigInt(event.keys[2]!).toString(),
      amount,
      block: event.block_number ?? 0,
    })
  }

  return deposits
}

function magnitudeOf(amount: bigint): number {
  return amount.toString().length
}

function key(asset: string, magnitude: number, slot: number): string {
  return `${asset}|${magnitude}|${slot}`
}

/**
 * 2^H over each address's share of the cell's flow. One participant gives 1,
 * n equal participants give n, and an unequal split gives something between.
 */
export function effectiveSet(flows: Iterable<bigint>): number {
  const shares = [...flows]
  const total = shares.reduce((sum, value) => sum + value, 0n)
  if (total === 0n) return 0

  let entropy = 0
  for (const value of shares) {
    const share = Number(value) / Number(total)
    if (share > 0) entropy -= share * Math.log2(share)
  }
  return 2 ** entropy
}

/** Every cell the given deposits fall into. */
export function measureCells(events: PoolEvent[], cellBlocks = CELL_BLOCKS): Cell[] {
  const grouped = new Map<string, Map<string, bigint>>()
  const facts = new Map<string, { asset: string; magnitude: number; slot: number }>()

  for (const deposit of read(events)) {
    const magnitude = magnitudeOf(deposit.amount)
    const slot = Math.floor(deposit.block / cellBlocks)
    const id = key(deposit.asset, magnitude, slot)

    const cell = grouped.get(id) ?? new Map<string, bigint>()
    cell.set(deposit.who, (cell.get(deposit.who) ?? 0n) + deposit.amount)
    grouped.set(id, cell)
    facts.set(id, { asset: deposit.asset, magnitude, slot })
  }

  return [...grouped].map(([id, cell]) => ({
    ...facts.get(id)!,
    headcount: cell.size,
    effectiveSet: effectiveSet(cell.values()),
  }))
}

export interface CellSummary {
  cells: number
  /** The middle cell's effective set. The number a typical deposit gets. */
  medianEffectiveSet: number
  /** Share of cells holding exactly one depositor, 0 to 1. */
  aloneShare: number
  largestHeadcount: number
  largestEffectiveSet: number
}

export function summariseCells(cells: Cell[]): CellSummary {
  if (cells.length === 0) {
    return {
      cells: 0,
      medianEffectiveSet: 0,
      aloneShare: 0,
      largestHeadcount: 0,
      largestEffectiveSet: 0,
    }
  }

  const sorted = [...cells].sort((a, b) => a.effectiveSet - b.effectiveSet)
  return {
    cells: cells.length,
    medianEffectiveSet: sorted[Math.floor(sorted.length / 2)]!.effectiveSet,
    aloneShare: cells.filter((cell) => cell.headcount === 1).length / cells.length,
    largestHeadcount: Math.max(...cells.map((cell) => cell.headcount)),
    largestEffectiveSet: Math.max(...cells.map((cell) => cell.effectiveSet)),
  }
}

export interface Prospect {
  /** Depositors already in the cell this deposit would join. */
  headcount: number
  /** The cell's effective set as it stands, before this deposit. */
  effectiveSet: number
  /** The effective set once this deposit is added. */
  effectiveSetAfter: number
  /**
   * Blocks until this cell closes and a new, empty one opens.
   *
   * The answer above is about the cell open right now. Sign after this many
   * blocks and the deposit lands in the next one instead, which starts empty -
   * so a small number here means the crowd being quoted is about to expire.
   */
  blocksLeftInCell: number
}

/**
 * What a specific deposit would be joining.
 *
 * This is the number worth showing someone before they sign, because it is the
 * one that describes their transaction rather than the pool's history. An
 * `effectiveSetAfter` of 1 means the deposit stands alone in its cell and the
 * public leg identifies it completely.
 */
export function prospectFor(
  events: PoolEvent[],
  intent: { asset: string; amount: bigint; atBlock: number },
  cellBlocks = CELL_BLOCKS,
): Prospect {
  const blocksLeftInCell = cellBlocks - (intent.atBlock % cellBlocks)

  if (intent.amount <= 0n) {
    return { headcount: 0, effectiveSet: 0, effectiveSetAfter: 0, blocksLeftInCell }
  }

  const asset = BigInt(intent.asset).toString()
  const magnitude = magnitudeOf(intent.amount)
  const slot = Math.floor(intent.atBlock / cellBlocks)

  const flows = new Map<string, bigint>()
  for (const deposit of read(events)) {
    if (deposit.asset !== asset) continue
    if (magnitudeOf(deposit.amount) !== magnitude) continue
    if (Math.floor(deposit.block / cellBlocks) !== slot) continue
    flows.set(deposit.who, (flows.get(deposit.who) ?? 0n) + deposit.amount)
  }

  const before = effectiveSet(flows.values())

  // The newcomer is somebody not already here — the honest assumption, and the
  // one that does not let an address inflate its own crowd by depositing twice.
  const after = new Map(flows)
  after.set('newcomer', intent.amount)

  return {
    headcount: flows.size,
    effectiveSet: before,
    effectiveSetAfter: effectiveSet(after.values()),
    blocksLeftInCell,
  }
}

export interface Period {
  /** The CELL_BLOCKS-wide slot these cells belong to. */
  slot: number
  /** First block of the slot, so a reader can find it on a block explorer. */
  fromBlock: number
  /** Cells that opened in this slot. */
  cells: number
  /** The middle cell's effective set — what a typical deposit got that day. */
  medianEffectiveSet: number
  /** The best any single deposit could have done. */
  bestEffectiveSet: number
}

/**
 * The same measurement, over time.
 *
 * A single median says the pool is thin. It cannot say whether that is
 * improving, and "1.00" printed forever reads as a broken gauge rather than a
 * finding. Grouped by slot, the shape of the thing becomes visible: whether a
 * crowd ever forms, and how long it lasts when it does.
 *
 * Slots with no deposits are absent rather than zero. A day nobody shielded is
 * not a day the anonymity set was zero; it is a day the question was not asked.
 */
export function measurePeriods(cells: Cell[], cellBlocks = CELL_BLOCKS): Period[] {
  const bySlot = new Map<number, Cell[]>()
  for (const cell of cells) {
    const group = bySlot.get(cell.slot) ?? []
    group.push(cell)
    bySlot.set(cell.slot, group)
  }

  return [...bySlot]
    .sort(([a], [b]) => a - b)
    .map(([slot, group]) => {
      const sorted = [...group].sort((a, b) => a.effectiveSet - b.effectiveSet)
      return {
        slot,
        fromBlock: slot * cellBlocks,
        cells: group.length,
        medianEffectiveSet: sorted[Math.floor(sorted.length / 2)]!.effectiveSet,
        bestEffectiveSet: Math.max(...group.map((cell) => cell.effectiveSet)),
      }
    })
}
