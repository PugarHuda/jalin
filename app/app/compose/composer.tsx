'use client'
import Link from 'next/link'

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { StarknetWindowObject } from 'get-starknet-core'
import { hash, shortString } from 'starknet'
import {
  depositStep,
  describeDisclosure,
  encodeDraft,
  encodePlan,
  openNote,
  previewCalldata,
  feltsToStrings,
  toFelt,
  toWalletActions,
  u256,
  type Plan,
  type SharedDraft,
  type Strk20Action,
} from 'jalin-sdk'
import {
  ENDUR_VAULT,
  GOVERNOR_ADDRESS,
  POOL_ADDRESS,
  ROUTER_ADDRESS,
  TOKENS,
  label,
  toBaseUnits,
  tokenOf,
} from '@/lib/config'
import type { STRK20_BALANCE_ENTRY } from '@starknet-io/types-js'
import {
  SHADOW_DAPP,
  asStrk20,
  describeError,
  probe,
  readyWallets,
  shadowCommitment,
  shieldedBalances,
  simulate,
  submit,
  type Capabilities,
  type Strk20Wallet,
} from '@/lib/wallet'
import { Wordmark } from '../wordmark'

interface StepForm {
  target: string
  selector: string
  approveToken: string
  approveAmount: string
  calldata: string
}

interface OutputForm {
  token: string
  minAmount: string
}

interface Draft {
  inputToken: string
  inputAmount: string
  steps: StepForm[]
  outputs: OutputForm[]
}

const STRK = TOKENS[0]!.address
const ETH = TOKENS[1]!.address
// By symbol, not position: native USDC, the one the pool actually holds.
const USDC = TOKENS.find((t) => t.symbol === 'USDC')!.address

const PRESETS: { name: string; blurb: string; draft: Draft }[] = [
  {
    name: 'Stake on Endur',
    blurb: 'A real ERC-4626 deposit into the xSTRK vault. Shares land in a shielded note.',
    draft: {
      inputToken: STRK,
      inputAmount: '0.25',
      steps: [
        {
          target: ENDUR_VAULT,
          selector: 'deposit',
          approveToken: STRK,
          approveAmount: '0.25',
          calldata: `{amount:u256}
${ROUTER_ADDRESS}`,
        },
      ],
      outputs: [{ token: ENDUR_VAULT, minAmount: '0.19' }],
    },
  },
  {
    name: 'Two deposits, one invoke',
    blurb: 'Two calls into a live protocol inside the single invoke the pool allows. This is the case nothing else can do.',
    draft: {
      inputToken: STRK,
      inputAmount: '0.4',
      steps: [
        {
          target: ENDUR_VAULT,
          selector: 'deposit',
          approveToken: STRK,
          approveAmount: '0.2',
          calldata: `{amount:u256}
${ROUTER_ADDRESS}`,
        },
        {
          target: ENDUR_VAULT,
          selector: 'deposit',
          approveToken: STRK,
          approveAmount: '0.2',
          calldata: `{amount:u256}
${ROUTER_ADDRESS}`,
        },
      ],
      outputs: [{ token: ENDUR_VAULT, minAmount: '0.3' }],
    },
  },
  {
    name: 'Round trip',
    blurb: 'Calls that move nothing, so the whole balance comes straight back. The cheapest way to prove the sandwich end to end.',
    draft: {
      inputToken: STRK,
      inputAmount: '0.1',
      steps: [
        {
          target: STRK,
          selector: 'approve',
          approveToken: '',
          approveAmount: '0',
          calldata: `${ROUTER_ADDRESS}
0
0`,
        },
      ],
      outputs: [{ token: STRK, minAmount: '0' }],
    },
  },
]

// ---------------------------------------------------------------------------
// The mainnet run
//
// Three transactions, each one an invoke through a contract of ours, because the
// rules ask for three that touched the pool and - having deployed contracts -
// ran through one of them. They are deliberately small and deliberately dull:
// the point is to prove the mechanism on mainnet with real value, not to take a
// market position with someone else's money.
// ---------------------------------------------------------------------------

const ONE = 10n ** 18n
const BALLOT_TAG = 'JALIN_BALLOT:V1'

/**
 * A plan whose steps are real external calls that move nothing: `approve(router, 0)`
 * on a token contract. The sandwich runs end to end, the whole withdrawn balance
 * is credited back into a note, and no market risk is taken to demonstrate it.
 */
function proofOfMechanism(stepCount: number): Plan {
  const approve = hash.getSelectorFromName('approve')
  const targets = [TOKENS[0]!.address, TOKENS[1]!.address]
  return {
    steps: Array.from({ length: stepCount }, (_, i) => ({
      target: targets[i % targets.length]!,
      selector: approve,
      approvals: [],
      calldata: [ROUTER_ADDRESS, 0n, 0n],
    })),
    outputs: [{ token: TOKENS[0]!.address, noteId: openNote(0), minAmount: 0n }],
  }
}

/**
 * Endur liquid staking as a plan.
 *
 * The router approves the vault, calls the standard ERC-4626
 * `deposit(assets, receiver)` with itself as receiver, and credits the xSTRK
 * shares into an open note. Nothing here is Endur-specific on our side: the
 * vault has an ABI, so it is reachable. That is the whole argument - AVNU had to
 * write an anonymizer for this shape, and Ekubo is writing another.
 *
 * The floor is set below the quoted rate rather than at it, because the share
 * price moves between quoting and proving and a proof takes about half a minute.
 */
function endurStake(assets: bigint, quotedShares?: bigint): Plan {
  // With a live quote the floor sits just under what the vault says it will pay,
  // which is a real slippage guard. Without one it falls back to a fraction of
  // assets - deliberately loose, because a tight guess reverts for no reason.
  const floor = quotedShares ? (quotedShares * 96n) / 100n : (assets * 78n) / 100n
  return {
    // depositStep is the SDK recipe for exactly this shape, so the product uses
    // it rather than restating the calldata layout in a second place.
    steps: [
      depositStep({
        market: ENDUR_VAULT,
        selector: hash.getSelectorFromName('deposit'),
        asset: TOKENS[0]!.address,
        amount: assets,
        receiver: ROUTER_ADDRESS,
      }),
    ],
    outputs: [{ token: ENDUR_VAULT, noteId: openNote(0), minAmount: floor }],
  }
}

interface MainnetRun {
  title: string
  note: string
  amount: bigint
  /** Deposit only. Nothing to spend until this has landed. */
  shieldOnly?: boolean
  ballot?: boolean
  plan?: Plan
}

const SHIELD: MainnetRun = {
  title: 'Shield the whole run',
  note: 'Moves public STRK into the pool as an encrypted note. Not one of the three: it touches the pool but no contract of ours, so it does not count. The wallet will not fold it into a run either — a spend is checked against the balance you already hold.',
  amount: 0n,
  shieldOnly: true,
}

/**
 * What to shield so all three runs can be paid for.
 *
 * This used to be the constant 1 STRK, with a comment reasoning that runs 1 and
 * 2 are round trips and only the ballot's stake leaves for good. The arithmetic
 * was right about the value that moves and forgot the pool's own charge, which
 * is levied per private operation and dwarfs every amount on this page: four
 * operations at 6 STRK is 24, against a shield of one. The first spend failed
 * with "not enough private balance for both the amount and the privacy fee",
 * which is the wallet naming a shortfall the page had built in.
 *
 * So it is derived: the fee once for the shield itself, once per run, plus what
 * the runs actually spend. Read from the chain rather than written here,
 * because it is governed and 4 STRK was already stale by the time it was
 * documented.
 */
function shieldAmount(poolFee: bigint): bigint {
  const spent = RUNS.reduce((total, run) => total + run.amount, 0n)
  return poolFee * BigInt(RUNS.length + 1) + spent
}

const RUNS: MainnetRun[] = [
  {
    title: 'Two steps, one invoke',
    note: 'Two external calls inside the single invoke the pool allows — the composition nothing else can do. The calls move nothing and the whole balance is credited back, so it costs only fees.',
    amount: ONE / 2n,
    plan: proofOfMechanism(2),
  },
  {
    title: 'Stake on Endur, privately',
    note: 'A real ERC-4626 deposit into Endur’s liquid staking vault; xSTRK lands straight in a shielded note. Nothing was written for Endur — the vault has an ABI, so it is reachable as a step.',
    amount: ONE / 4n,
    plan: endurStake(ONE / 4n),
  },
  {
    title: 'Private ballot',
    note: 'A vote through JalinGovernor, an anonymizer helper in its own right: the weight is public, the voter is not. It votes on whichever proposal is open.',
    amount: ONE / 10n,
    ballot: true,
  },
]

function decimalsOf(address: string): number {
  return tokenOf(address)?.decimals ?? 18
}

/** Base units to a decimal string, trailing zeros dropped, no floating point. */
function formatUnits(value: bigint, decimals: number): string {
  const whole = value / 10n ** BigInt(decimals)
  const fraction = (value % 10n ** BigInt(decimals)).toString().padStart(decimals, '0').replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : whole.toString()
}

/** The key a button's dry-run answer is filed under. */
function siteKey(site: number | null): string {
  return site === null ? 'draft' : String(site)
}

function DryRun({ answer }: { answer: string }) {
  const refused = answer.startsWith('Dry run refused')
  return (
    <p
      data-testid="dry-run"
      className={`mt-2 break-all rounded border px-2 py-1 font-mono text-xs leading-relaxed ${
        refused ? 'border-warn/40 bg-warn/10 text-warn' : 'border-hidden/40 bg-hidden/10 text-hidden'
      }`}
    >
      {answer}
    </p>
  )
}

/**
 * Calldata is written a line per felt. `{amount:u256}` expands to the step's own
 * approval amount split low-first, which is the shape most venues want and the
 * mistake most people make by hand.
 */
function parseCalldata(raw: string, approveAmount: bigint): (string | bigint)[] {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line): (string | bigint)[] => {
      if (line === '{amount:u256}') return u256(approveAmount)
      if (line === '{amount}') return [approveAmount]
      if (/^\d+$/.test(line)) return [BigInt(line)]
      return [line]
    })
}

interface LiveParams {
  paused: boolean
  maxSteps: number
  maxCalldata: number
  feeBps: number
  /**
   * The pool's flat charge per private operation, in base units as a string.
   * Not the router's `feeBps` - this one belongs to the pool, is paid out of
   * the private balance, and is large: 6 STRK on mainnet.
   *
   * Null when the pool would not answer. The shield stays unoffered rather than
   * falling back to a number, because falling back to a number is the bug this
   * whole field exists to close.
   */
  poolFee: string | null
  /** Measured over the last 20,000 blocks, or null when the node would not say. */
  secondsPerBlock: number | null
  denied: Record<string, boolean>
  /** The newest proposal still taking votes, or null when none is. */
  openProposal: { id: number; endBlock: number; blocksLeft: number } | null
}

function buildPlan(draft: Draft): Plan {
  return {
    steps: draft.steps.map((step) => {
      const amount = toBaseUnits(step.approveAmount, decimalsOf(step.approveToken))
      const selector = step.selector.startsWith('0x')
        ? step.selector
        : hash.getSelectorFromName(step.selector || 'invalid')
      return {
        target: step.target || '0x0',
        selector,
        approvals: step.approveToken && amount > 0n ? [{ token: step.approveToken, amount }] : [],
        calldata: parseCalldata(step.calldata, amount),
      }
    }),
    outputs: draft.outputs.map((output, index) => ({
      token: output.token,
      noteId: openNote(index),
      minAmount: toBaseUnits(output.minAmount, decimalsOf(output.token)),
    })),
  }
}

/**
 * Swallows the rejection an abort produces, and only that one.
 *
 * `.catch(() => {})` hid every failure equally - a cancelled request and a
 * broken route looked the same, which is how a route that had started answering
 * 502 could go unnoticed.
 */
function ignoreAbort(error: unknown): void {
  if (error instanceof DOMException && error.name === 'AbortError') return
  console.error('[jalin] background read failed', error)
}

/**
 * A background read that tries three times before it is a failure.
 *
 * A fetch to this app's own API that never reaches the server - WebKit says
 * `TypeError: Load failed`, Chromium `Failed to fetch` - is a dropped
 * connection, and a dropped connection is usually gone by the next attempt.
 * The page used to give up on the first one: the shield button then read
 * "reading the pool fee…" for the rest of the visit, with nothing to say the
 * read had failed and nothing that would try again. Three attempts, 300ms then
 * 900ms apart; a non-OK answer is returned as null, not retried, because the
 * server said something and the caller decides what. Abort is honoured
 * between attempts, so navigating away still cancels the work.
 */
async function readJson<T>(url: string, signal: AbortSignal): Promise<T | null> {
  const waits = [300, 900]
  for (let attempt = 0; ; attempt += 1) {
    try {
      const response = await fetch(url, { signal })
      return response.ok ? ((await response.json()) as T) : null
    } catch (error) {
      if (signal.aborted || attempt >= waits.length) throw error
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, waits[attempt])
        signal.addEventListener('abort', () => { clearTimeout(timer); reject(error) }, { once: true })
      })
    }
  }
}

export function Composer({ shared }: { shared: SharedDraft | null }) {
  // The server already read `?plan=` and decoded it, so the first render is the
  // shared plan rather than a preset replaced a tick later. That also removes
  // the hydration mismatch: both sides render the same thing.
  const [draft, setDraft] = useState<Draft>(shared ?? PRESETS[0]!.draft)
  const [share, setShare] = useState<{ url: string; copied: boolean } | null>(null)
  const [shareError, setShareError] = useState<string | null>(null)
  const [tab, setTab] = useState<'reveals' | 'calldata' | 'actions'>('reveals')
  const [status, setStatus] = useState<string | null>(null)
  const [wallets, setWallets] = useState<StarknetWindowObject[]>([])
  const [pendingRun, setPendingRun] = useState<number | null>(null)
  const [hashes, setHashes] = useState<(string | null)[]>([null, null, null])
  const [ballotSecret, setBallotSecret] = useState<string | null>(null)
  const [lastPayload, setLastPayload] = useState<string | null>(null)
  const [shieldHash, setShieldHash] = useState<string | null>(null)
  const [account, setAccount] = useState<string | null>(null)
  const [connected, setConnected] = useState<string | null>(null)
  const [params, setParams] = useState<LiveParams | null>(null)
  /** The governor could not be read after three attempts; the page says so. */
  const [paramsFailed, setParamsFailed] = useState(false)
  const [verdicts, setVerdicts] = useState<Record<string, string>>({})
  const [quote, setQuote] = useState<{ shares: bigint } | null>(null)
  const [crowd, setCrowd] = useState<{
    depositors: number
    windowBlocks: number
    cells: { medianEffectiveSet: number; aloneShare: number; largestEffectiveSet: number }
  } | null>(null)
  const [prospect, setProspect] = useState<{
    headcount: number
    effectiveSetAfter: number
    blocksLeftInCell: number
  } | null>(null)

  // Kept once connected, so balances, a dry run and the shadow-account
  // commitment can be asked for without another round of picking a wallet.
  const [wallet, setWallet] = useState<Strk20Wallet | null>(null)
  const [caps, setCaps] = useState<Capabilities | null>(null)
  const [balances, setBalances] = useState<STRK20_BALANCE_ENTRY[]>([])
  const [shadow, setShadow] = useState<string | null>(null)
  /** What the wallet is being asked for: only to connect, to assemble, or to sign. */
  const [mode, setMode] = useState<'connect' | 'simulate' | 'submit'>('submit')
  /** The wallet's answer to a dry run, by the button that asked. */
  const [simulations, setSimulations] = useState<Record<string, string>>({})

  const [splitting, setSplitting] = useState(false)
  const [splitError, setSplitError] = useState<string | null>(null)

  /**
   * The preset that has to be fetched: a swap route is a quote, and a quote is
   * a price at a block, so it cannot be written into the page ahead of time
   * the way the others are. AVNU is asked with the router as taker; what comes
   * back is the exact calldata of its `multi_route_swap`, with the router as
   * beneficiary and AVNU's own minimum as the output floor. Half the input
   * goes there and half into Endur, and both land in notes.
   */
  async function loadSplit() {
    setSplitting(true)
    setSplitError(null)
    try {
      const half = ONE / 4n
      const response = await fetch(
        `/api/swap?sell=${STRK}&buy=${USDC}&amount=${half.toString()}&slippage=0.01`,
      )
      const body = (await response.json()) as {
        error?: string
        calldata?: string[]
        exchange?: string
        buy?: { min: string }
      }
      if (!response.ok || !body.calldata || !body.exchange || !body.buy) {
        throw new Error(body.error ?? `AVNU answered ${response.status}`)
      }
      setDraft({
        inputToken: STRK,
        inputAmount: '0.5',
        steps: [
          {
            target: body.exchange,
            selector: 'multi_route_swap',
            approveToken: STRK,
            approveAmount: '0.25',
            calldata: body.calldata.join('\n'),
          },
          {
            target: ENDUR_VAULT,
            selector: 'deposit',
            approveToken: STRK,
            approveAmount: '0.25',
            calldata: `{amount:u256}\n${ROUTER_ADDRESS}`,
          },
        ],
        outputs: [
          { token: USDC, minAmount: formatUnits(BigInt(body.buy.min), 6) },
          { token: ENDUR_VAULT, minAmount: '0.19' },
        ],
      })
    } catch (error) {
      setSplitError(error instanceof Error ? error.message : String(error))
    } finally {
      setSplitting(false)
    }
  }

  /**
   * The hashes this account has landed, kept across reloads.
   *
   * They lived in component state only. Run 1 was submitted while its "Proving"
   * line was still up, the next click replaced that line, the page was later
   * reopened, and a transaction that had succeeded on mainnet was missing from
   * the only screen that listed them - it was found again by reading the
   * router's events. Per account, because a second account on the same
   * browser has not run anything.
   */
  const restoredFor = useRef<string | null>(null)
  function restoreRuns(address: string) {
    try {
      const raw = localStorage.getItem(`jalin:mainnet-run:${address}`)
      if (raw) {
        const saved = JSON.parse(raw) as { shield?: string | null; runs?: (string | null)[] }
        const runs = RUNS.map((_, i) => saved.runs?.[i] ?? null)
        setHashes(runs)
        setShieldHash(saved.shield ?? null)
        // Verdicts are not stored; they are the chain's to give, so ask again.
        for (const h of [saved.shield, ...runs]) if (h) void judge(h, null)
      }
    } catch {}
    restoredFor.current = address
  }

  useEffect(() => {
    if (!account || restoredFor.current !== account) return
    try {
      localStorage.setItem(
        `jalin:mainnet-run:${account}`,
        JSON.stringify({ shield: shieldHash, runs: hashes }),
      )
    } catch {}
  }, [account, hashes, shieldHash])

  // The Endur run's floor comes from the vault rather than from a constant. A
  // constant cannot know the share price moved, so it is either too loose to
  // protect anything or tight enough to revert for no reason.
  useEffect(() => {
    const assets = RUNS.find((r) => r.plan && r.title.includes('Endur'))?.amount
    if (!assets) return

    /**
     * Aborted on cleanup, not merely ignored.
     *
     * A flag stops a stale answer being written to state and leaves the request
     * itself running - the browser finishes downloading something nobody will
     * read, and when the page navigates away mid-flight WebKit logs the
     * abandoned fetch as an error. Handing the signal to fetch cancels the work
     * rather than the interest in it.
     */
    const stop = new AbortController()

    readJson<{ shares?: string }>(`/api/quote?assets=${assets.toString()}`, stop.signal)
      .then((body) => {
        if (body?.shares) setQuote({ shares: BigInt(body.shares) })
      })
      .catch(ignoreAbort)

    return () => stop.abort()
  }, [])

  // The size of the crowd is the one privacy number every tool asks you to
  // assume. It is on chain, so it is measured rather than asserted.
  useEffect(() => {
    const stop = new AbortController()

    readJson<NonNullable<typeof crowd>>('/api/crowd', stop.signal)
      .then((body) => {
        if (typeof body?.depositors === 'number') setCrowd(body)
      })
      .catch(ignoreAbort)

    return () => stop.abort()
  }, [])

  /**
   * The crowd for this deposit, not for the pool. An observer of the public leg
   * sees the asset, the order of magnitude and roughly when, so the set that
   * covers you is the one that agrees on all three. Re-asked as the amount
   * changes, because changing it moves you to a different cell.
   */
  useEffect(() => {
    let amount = 0n
    try {
      amount = toBaseUnits(draft.inputAmount, decimalsOf(draft.inputToken))
    } catch {
      return
    }

    const stop = new AbortController()

    // Clearing runs on the same timer as asking. Calling setState straight out
    // of an effect body forces a second render pass before paint, and doing it
    // only on the empty-amount branch meant one path was debounced and the
    // other was not.
    const timer = setTimeout(() => {
      if (amount <= 0n) {
        setProspect(null)
        return
      }

      const query = new URLSearchParams({ asset: draft.inputToken, amount: amount.toString() })
      readJson<NonNullable<typeof prospect>>(`/api/crowd?${query}`, stop.signal)
        .then((body) => {
          if (typeof body?.effectiveSetAfter === 'number') setProspect(body)
        })
        .catch(ignoreAbort)
    }, 300)

    return () => {
      stop.abort()
      clearTimeout(timer)
    }
  }, [draft.inputToken, draft.inputAmount])

  /**
   * The bounds a plan is checked against belong to governance, so they are read
   * rather than compiled in. Same call answers whether any target has been
   * denied - the router refuses those and nothing here could see it.
   */
  const targets = draft.steps
    .map((step) => step.target.trim())
    .filter((target) => /^0x[0-9a-fA-F]{1,64}$/.test(target))
    .join(',')

  useEffect(() => {
    const stop = new AbortController()

    // Debounced, because every prefix of an address being typed is itself a
    // valid felt - so without this it was one node call per keystroke.
    const timer = setTimeout(() => {
      readJson<LiveParams>(`/api/params?targets=${encodeURIComponent(targets)}`, stop.signal)
        .then((body) => {
          if (typeof body?.maxSteps === 'number') {
            setParams(body)
            setParamsFailed(false)
          }
        })
        .catch((error: unknown) => {
          ignoreAbort(error)
          // Three attempts are gone. The shield button was reading "reading
          // the pool fee…" for the rest of the visit in this case, which is
          // a spinner for a read that had already failed.
          if (!(error instanceof DOMException && error.name === 'AbortError')) setParamsFailed(true)
        })
    }, 300)

    return () => {
      stop.abort()
      clearTimeout(timer)
    }
  }, [targets])

  const result = useMemo(() => {
    try {
      const plan = buildPlan(draft)
      // Falls back to the SDK's deployed defaults only while the governor has
      // not been read yet. Once it has, the chain's own numbers win.
      encodePlan(
        plan,
        undefined,
        params ? { maxSteps: params.maxSteps, maxCalldata: params.maxCalldata } : undefined,
      )
      return { plan, error: null as string | null }
    } catch (error) {
      return { plan: null, error: error instanceof Error ? error.message : String(error) }
    }
  }, [draft, params])

  const deniedTargets = draft.steps
    .map((step) => step.target.trim())
    .filter((target) => params?.denied[target])

  // Null until the pool has been asked. Nothing here guesses a fee: the shield
  // button stays disabled rather than offering an amount that would strand
  // somebody halfway through the run.
  const poolFee = params?.poolFee ? BigInt(params.poolFee) : null
  const shield: MainnetRun = {
    ...SHIELD,
    amount: poolFee ? shieldAmount(poolFee) : 0n,
  }

  /**
   * A block count as wall-clock, from the block time the chain reported - or
   * nothing at all when it did not. "About 53 minutes at 1.68s" was a literal
   * that happened to be right; the same sentence with 30s in it, from an older
   * Starknet, cost another sprint team a seven-day window that closed in three
   * hours. Blocks are the truth, minutes are a courtesy, and a courtesy from a
   * number nobody measured is not one.
   */
  function minutes(blocks: number): string {
    const rate = params?.secondsPerBlock
    if (!rate) return ''
    return ` — about ${Math.max(1, Math.round((blocks * rate) / 60))} minutes at mainnet's measured ${rate.toFixed(2)}s`
  }

  /**
   * Why a run cannot be paid for from what the pool holds, or null when it can.
   *
   * Only once the wallet has answered: before that there is nothing to compare
   * against and the buttons stay as they were. The comparison is the one the
   * wallet makes - amount plus the pool's fee against the shielded STRK - so
   * the sentence here is the one the wallet would otherwise say after the proof.
   */
  function shortfall(run: MainnetRun): string | null {
    if (!caps?.registered || !poolFee) return null
    const strk = TOKENS[0]!.address
    const held = balances.find((b) => tokenOf(b.token)?.address === strk)
    const have = held ? BigInt(held.balance) : 0n
    const need = run.amount + poolFee
    if (have >= need) return null
    return `Needs ${formatUnits(need, 18)} STRK in the pool - ${formatUnits(run.amount, 18)} to spend and ${formatUnits(poolFee, 18)} of pool fee - and this account holds ${formatUnits(have, 18)}. Short by ${formatUnits(need - have, 18)}; shield that much more first.`
  }

  /**
   * The exact wallet calls, built outside the render.
   *
   * It used to be built inline with `recipient: '0xYOUR_ACCOUNT'`, which is not
   * a felt. BigInt threw during render and took the whole page down - clicking
   * this tab on a fresh browser was a blank error screen. Two things were wrong:
   * the stand-in, and that a throw here could reach React at all.
   */
  const actions = useMemo(() => {
    if (!result.plan || !account) return null
    try {
      return toWalletActions(result.plan, {
        router: ROUTER_ADDRESS,
        inputs: [
          {
            token: draft.inputToken,
            amount: toBaseUnits(draft.inputAmount, decimalsOf(draft.inputToken)),
          },
        ],
        recipient: account,
      })
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }, [result.plan, account, draft.inputToken, draft.inputAmount])

  const patch = (change: Partial<Draft>) => setDraft((d) => ({ ...d, ...change }))
  const patchStep = (i: number, change: Partial<StepForm>) =>
    patch({ steps: draft.steps.map((s, j) => (i === j ? { ...s, ...change } : s)) })

  /**
   * Reconnects the wallet that was already authorised, without asking again.
   *
   * `getAuthorizedWallets` returns the ones that granted access on a previous
   * visit, and reads nothing the user has not already agreed to - no prompt,
   * no popup. Without it every visit began by picking from a list, and the
   * actions preview stayed empty until somebody clicked through a run.
   */
  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const { default: getStarknet } = await import('get-starknet-core')
        const authorised = await getStarknet.getAuthorizedWallets()
        const last = await getStarknet.getLastConnectedWallet()

        // The one they used last if it is still authorised, otherwise the only
        // authorised one. Two authorised wallets and no memory is a genuine
        // choice, so it stays a choice.
        const remembered =
          (last && authorised.find((wallet) => wallet.id === last.id)) ??
          (authorised.length === 1 ? authorised[0] : undefined)
        if (!remembered || cancelled) return

        const [address] = (await remembered.request({
          type: 'wallet_requestAccounts',
          params: { silent_mode: true },
        })) as string[]

        if (!cancelled && address) {
          setAccount(address)
          setConnected(remembered.name ?? remembered.id ?? 'a wallet')
          restoreRuns(address)

          // And ask what it can do, the same as an explicit connect would. A
          // reconnect that restored the address and nothing else left the
          // balance and shadow panels blank on a page that said "connected",
          // with no line saying why - the wallet had simply never been asked.
          const w = asStrk20(remembered)
          const found = await probe(w)
          if (cancelled) return
          setWallet(w)
          setCaps(found)
          setBalances(found.balances)
          if (found.shadow) {
            shadowCommitment(w)
              .then((c) => !cancelled && setShadow(c))
              .catch((error) => !cancelled && setShadow(`refused: ${describeError(error)}`))
          }
        }
      } catch {
        // A wallet that refuses a silent reconnect is not an error to report;
        // the person can still pick one.
      }
    })()

    return () => {
      cancelled = true
    }
    // Runs once, on mount: a silent reconnect is a one-time question. The
    // restore it calls reads storage for whatever address came back and has no
    // reason to re-run when the component's functions are re-created.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function pickWallet(
    runIndex: number | null = null,
    how: 'connect' | 'simulate' | 'submit' = 'submit',
  ) {
    setPendingRun(runIndex)
    setMode(how)
    setSimulations((s) => {
      const next = { ...s }
      delete next[siteKey(runIndex)]
      return next
    })

    // Already connected: nothing to pick. Asking again would open the wallet's
    // account chooser for a question it has answered.
    if (wallet) return execute(null, runIndex, how)

    const { wallets: offered, error } = await readyWallets()

    if (error) {
      setStatus(error)
      return
    }

    setStatus(null)
    // Stale from the previous button, and about to render under a different one.
    setLastPayload(null)

    // One candidate is not a choice. Listing it made every run a two-click
    // affair whose first click asked a question with one answer.
    if (offered.length === 1) return execute(offered[0]!, runIndex, how)
    setWallets(offered)
  }

  /**
   * Everything the machine has to say in response to a click, rendered at the
   * button that was clicked.
   *
   * There are three places to start a signature - the draft plan, the shield and
   * each numbered run - and one set of state behind them. Rendering that state
   * in one fixed spot meant two of the three buttons answered somewhere the
   * reader was not looking: you pressed `run` at the foot of the page and the
   * wallet list, the proving status and the error all appeared half a screen up.
   *
   * `pendingRun` already knew which button was waiting. This shows it.
   */
  function feedback(site: number | null, what: string) {
    const dryRun = simulations[siteKey(site)]
    if (pendingRun !== site) return dryRun ? <DryRun answer={dryRun} /> : null
    if (wallets.length === 0 && !status && !lastPayload && !dryRun) return null

    return (
      <div className="mt-3 border-t border-thread pt-3">
        {wallets.length > 0 && (
          <>
            <p className="text-xs text-muted">
              Choose a wallet to{' '}
              {mode === 'connect' ? 'connect' : mode === 'simulate' ? 'dry-run' : 'sign'}{' '}
              <span className="text-cloth">{what}</span>.
            </p>
            <ul className="mt-2 space-y-1">
              {wallets.map((candidate) => (
                <li key={candidate.id}>
                  <button
                    onClick={() => execute(candidate, site, mode)}
                    className="w-full rounded border border-strand px-3 py-2 text-left text-sm hover:border-gold"
                  >
                    {candidate.name}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
        {status && <p className="mt-2 break-all font-mono text-xs">{status}</p>}
        {dryRun && <DryRun answer={dryRun} />}
        {status?.includes('NOT_REGISTERED') && (
          <p className="mt-2 max-w-[60ch] text-xs leading-relaxed">
            In Ready: open the wallet, shield any amount from its own privacy screen. That one
            transaction emits <span className="font-mono">ViewingKeySet</span> and you are
            registered. Nothing to sign here for it.
          </p>
        )}
        {lastPayload && (
          <details className="mt-2">
            <summary className="cursor-pointer text-xs text-muted">
              the exact payload that was sent
            </summary>
            <pre className="mt-1 max-h-64 overflow-auto bg-ground p-2 font-mono text-xs break-all whitespace-pre-wrap">
              {lastPayload}
            </pre>
          </details>
        )}
      </div>
    )
  }

  /** Forgets the wallet here and in the library, so the next visit asks again. */
  async function disconnectWallet() {
    const { default: getStarknet } = await import('get-starknet-core')
    await getStarknet.disconnect({ clearLastWallet: true })
    setAccount(null)
    setConnected(null)
    setWallet(null)
    setCaps(null)
    setBalances([])
    setShadow(null)
    setWallets([])
    setStatus(null)
  }

  /**
   * What is in the pool for this account, straight from the wallet.
   *
   * Asked after every landed transaction as well as at connection, because the
   * number this page most needs to be right about is the one that was invisible
   * when the shield was sized at 1 STRK against a 6 STRK fee: nothing on screen
   * knew what the account held, so nothing could say it was short.
   */
  async function refreshBalances(w: Strk20Wallet) {
    try {
      setBalances(await shieldedBalances(w))
    } catch (error) {
      // Not fatal to anything else; the last known balances stay up and the
      // reason they are stale is on screen.
      setStatus(`Could not re-read the shielded balance: ${describeError(error)}`)
    }
  }

  /**
   * Connects, then asks the wallet what it can do. Everything the page later
   * shows about the account - balances, whether a shadow account can be derived,
   * which API version answered - comes from this one exchange.
   */
  async function connect(
    raw: StarknetWindowObject,
  ): Promise<{ wallet: Strk20Wallet; address: string } | null> {
    const w = asStrk20(raw)

    // Exactly one `wallet_requestAccounts`, and it is this one. The library's
    // `enable` makes the same request and then a permissions check; asking a
    // second time for the address and a third time in `execute` - because the
    // state that held it had not landed yet - opened the wallet three times
    // for one click. The permission is implied by an address coming back.
    const [address] = await w.request({ type: 'wallet_requestAccounts' })
    if (!address) {
      setStatus('Wallet returned no account.')
      return null
    }
    setAccount(address)
    setConnected(raw.name ?? raw.id ?? 'a wallet')
    restoreRuns(address)

    setStatus('Checking what this wallet supports…')
    const found = await probe(w)
    setCaps(found)
    setBalances(found.balances)
    setWallet(w)

    const who = `${raw.name ?? 'unknown wallet'}${raw.version ? ` ${raw.version}` : ''}`
    const api = found.versions.length ? `Wallet API ${found.versions.join(', ')}` : 'Wallet API version unknown'

    if (!found.strk20) {
      setStatus(
        `${who} does not answer wallet_strk20Balances, so it cannot sign a Jalin plan yet. ${api}. It said: ${found.refusal}`,
      )
      return null
    }
    if (!found.registered) {
      setStatus(
        `STRK20 supported by ${who}, but this account has not joined the pool yet. Shield once from inside the wallet and it registers you in the same transaction. ${api}.`,
      )
      return { wallet: w, address }
    }

    if (found.shadow) {
      // The partial commitment: computed inside the wallet, sent nowhere.
      shadowCommitment(w)
        .then(setShadow)
        .catch((error) => setShadow(`refused: ${describeError(error)}`))
    }

    setStatus(`STRK20 supported by ${who}. ${api}.`)
    return { wallet: w, address }
  }

  function buildRunActions(run: MainnetRun, account: string): Strk20Action[] {
    const strk = TOKENS[0]!.address

    if (run.shieldOnly) {
      return [{ type: 'deposit', token: toFelt(strk), amount: toFelt(run.amount) }]
    }

    if (run.ballot) {
      // Never a compiled-in id. A proposal takes votes for 2000 blocks - under
      // an hour - so a constant here is a run that points at a closed vote for
      // the rest of the contract's life, and finds out after paying to prove.
      if (!params?.openProposal) {
        throw new Error(
          'No proposal is taking votes right now. Make one at /governance - it is an ordinary ' +
            'public transaction, and voting stays open for about an hour after it lands.',
        )
      }
      const proposalId = BigInt(params.openProposal.id)

      // The secret is what redeems the stake once voting closes, and it is only
      // ever held here. Losing it locks the stake in the governor for good, so
      // it is shown rather than kept quietly in memory.
      const bytes = crypto.getRandomValues(new Uint8Array(31))
      const secret = `0x${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`
      const commitment = hash.computePoseidonHashOnElements([
        shortString.encodeShortString(BALLOT_TAG),
        secret,
      ])
      setBallotSecret(secret)
      return [
        {
          type: 'withdraw',
          token: toFelt(strk),
          amount: toFelt(run.amount),
          recipient: toFelt(GOVERNOR_ADDRESS),
        },
        {
          type: 'invoke',
          contract: toFelt(GOVERNOR_ADDRESS),
          // privacy_invoke(pool_address, operation, proposal_id, support,
          //                commitment, secret, amount, note_id)
          // operation 0 is CAST, which returns an empty span - so no open note.
          calldata: feltsToStrings([
            '${poolAddress}',
            0n,
            proposalId,
            1n,
            commitment,
            0n,
            run.amount,
            0n,
          ]),
        },
      ]
    }

    const plan =
      run.title.includes('Endur') && quote
        ? endurStake(run.amount, quote.shares)
        : run.plan!

    return toWalletActions(plan, {
      router: ROUTER_ADDRESS,
      inputs: [{ token: strk, amount: run.amount }],
      recipient: account,
    })
  }

  /**
   * The rules the panel will apply, applied here. Polls because a receipt does
   * not exist the instant a transaction is accepted.
   */
  async function judge(hash: string, w: Strk20Wallet | null) {
    // Two and a half minutes, not one. Inclusion on Starknet is usually under
    // thirty seconds and is not always; a hash whose verdict stopped being
    // asked for at sixty seconds sat on the page as "submitted" until a reload
    // asked again, and the balance under it stayed stale for as long.
    for (let attempt = 0; attempt < 30; attempt += 1) {
      try {
        const response = await fetch(`/api/tx?hash=${hash}`)
        if (response.ok) {
          const body = (await response.json()) as { exists?: boolean; summary?: string }
          if (body.summary) setVerdicts((v) => ({ ...v, [hash]: body.summary! }))
          if (body.exists) {
            // Landed, so the pool's view of this account has moved. Re-read it
            // rather than subtracting here: the fee leg is the wallet's to add
            // and the page has been wrong about it once.
            if (w) await refreshBalances(w)
            return
          }
        }
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 5000))
    }
  }

  /**
   * One entry point for the three things a button can ask of the wallet.
   *
   * `site` and `how` arrive as arguments rather than being read from state,
   * because the wallet list's buttons fire in the same tick that set them and
   * would otherwise read the previous click's answer.
   */
  async function execute(
    /** A wallet to connect, or null to use the one already connected. */
    raw: StarknetWindowObject | null,
    site: number | null,
    how: 'connect' | 'simulate' | 'submit',
  ) {
    const run = site === null || site === -2 ? null : site === -1 ? shield : RUNS[site]!
    if (how !== 'connect' && !run && !result.plan) return
    setWallets([])
    setStatus('Connecting…')
    try {
      // The connected pair, or a fresh connection. Address and wallet travel
      // together here because React state set a line ago is not readable yet.
      const session =
        wallet && account ? { wallet, address: account } : raw ? await connect(raw) : null
      if (!session || how === 'connect') return
      const { wallet: w, address } = session

      // A wallet that was kept without its capabilities - a reconnect that
      // stopped short - gets asked now rather than signing blind.
      if (!caps) {
        const found = await probe(w)
        setCaps(found)
        setBalances(found.balances)
      }
      if (!ROUTER_ADDRESS) {
        return setStatus('The router is not deployed yet, so there is nothing to sign.')
      }

      const actions: Strk20Action[] = run
        ? buildRunActions(run, address)
        : toWalletActions(result.plan!, {
            router: ROUTER_ADDRESS,
            inputs: [
              {
                token: draft.inputToken,
                amount: toBaseUnits(draft.inputAmount, decimalsOf(draft.inputToken)),
              },
            ],
            recipient: address,
          })

      setLastPayload(JSON.stringify(actions, null, 2))
      console.log('[jalin] strk20 actions', actions)

      if (how === 'simulate') {
        // Assembled by the wallet and not proved, not submitted, not paid for.
        // The failures a plan can have - a short balance, a placeholder the
        // wallet cannot resolve, a revert inside the invoke - come back here as
        // the wallet's own words instead of thirty seconds and a fee later.
        setStatus(
          'Asking the wallet to assemble this without proving it. Ready opens its own screen for this and shows any refusal there - Reject closes it; nothing is proved, sent or charged either way.',
        )
        const prepared = await simulate(w, actions)
        const felts = prepared.call.calldata?.length ?? 0
        setStatus(null)
        setSimulations((s) => ({
          ...s,
          [siteKey(site)]: `Dry run passed. The wallet assembled ${actions.length} action${actions.length === 1 ? '' : 's'} into one call of ${felts} felts to ${label(String(prepared.call.contract_address))} and raised nothing. Nothing was proved, sent or charged.`,
        }))
        return
      }

      setStatus('Proving. This takes around 30 seconds; the wallet stays open.')
      const transactionHash = await submit(w, actions)

      setStatus(`Submitted: ${transactionHash}`)
      judge(transactionHash, w)
      if (site === -1) {
        setShieldHash(transactionHash)
      } else if (site !== null && site >= 0) {
        setHashes((previous) => previous.map((h, i) => (i === site ? transactionHash : h)))
      }
    } catch (error) {
      const message = describeError(error)
      if (how === 'simulate') {
        setStatus(null)
        setSimulations((s) => ({ ...s, [siteKey(site)]: `Dry run refused: ${message}` }))
        return
      }
      // Registration is once per account and needs no STRK20 wallet support -
      // There is no register method in the Wallet API because registration is
      // not a dapp's to perform: the wallet emits ViewingKeySet itself, on the
      // first shield made from inside it. Verified on mainnet in
      // 0x04816dbb…0278, where one Ready shield of 10 STRK emitted
      // ViewingKeySet, Deposit and EncNoteCreated in a single transaction.
      if (/NOT_REGISTERED/i.test(message)) {
        setStatus(
          'NOT_REGISTERED: this account has never joined the pool. It is not a step you do ' +
            'here - open your wallet, shield any amount from inside it once, and the wallet ' +
            'publishes your viewing key in that same transaction. Then come back and run ' +
            'these in order.',
        )
        return
      }
      setStatus(message)
    }
  }

  const draftIncomplete = draft.steps.some((step) => {
    const target = step.target.trim()
    return target === '' || /^0x0*$/.test(target)
  })

  const disclosure = result.plan ? describeDisclosure(result.plan) : null

  return (
    <main className="mx-auto w-full max-w-6xl px-5 py-10">
      <header className="border-b border-thread pb-6">
        <div className="flex items-baseline justify-between">
          <Wordmark />
          <nav className="flex gap-5 font-mono text-xs text-muted">
            <Link href="/governance" className="hover:text-gold">
              governance
            </Link>
            <Link href="/verify" className="hover:text-gold">
              verify
            </Link>
            <Link href="/" className="hover:text-gold">
              what this is
            </Link>
          </nav>
        </div>
        <h1 className="mt-6 font-display text-3xl font-semibold tracking-tight">Composer</h1>
        <p className="mt-2 max-w-[60ch] text-sm text-muted">
          The pool allows one invoke per private transaction. Jalin runs a whole plan —
          any steps, any contracts — inside that one invoke.
        </p>
        <p className="mt-3 font-mono text-xs text-muted">
          pool {label(POOL_ADDRESS)} · router {ROUTER_ADDRESS ? label(ROUTER_ADDRESS) : 'not deployed yet'}
        </p>
      </header>

      {/*
        The gold button in the editor below is the loudest thing on the page and
        it is the advanced path: it signs whatever is in the boxes, spent against
        a shielded balance a first-time reader does not have yet. Pressing it
        first is the obvious mistake and it was being made. Signposting the
        guided path costs a sentence; reordering the page would cost the
        argument, which builds to those runs rather than opening with them.
      */}
      <p className="mt-4 max-w-[60ch] rounded border border-strand bg-raised px-3 py-2 text-xs leading-relaxed text-muted">
        <span className="text-cloth">First time here?</span> Start with{' '}
        <a href="#mainnet-run" className="text-gold underline underline-offset-2">
          the three numbered runs
        </a>{' '}
        below — shield once, then run them in order. The editor signs whatever you build, and
        spending needs a shielded balance you may not hold yet.
      </p>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        {PRESETS.map((preset) => (
          <button
            key={preset.name}
            onClick={() => setDraft(preset.draft)}
            title={preset.blurb}
            className="rounded border border-strand bg-raised px-3 py-1.5 text-sm hover:border-gold"
          >
            {preset.name}
          </button>
        ))}
        <button
          onClick={loadSplit}
          disabled={splitting}
          title="Half the input swapped to USDC through AVNU's aggregator, half staked on Endur, both credited to notes - two venues in the single invoke the pool allows. The swap route and its floor come from AVNU at the moment you click."
          className="rounded border border-strand bg-raised px-3 py-1.5 text-sm hover:border-gold disabled:opacity-40"
        >
          {splitting ? 'asking AVNU for a route…' : 'Swap half on AVNU, stake half on Endur'}
        </button>
        {splitError && (
          <span className="font-mono text-xs text-warn" data-testid="split-error">
            {splitError}
          </span>
        )}

        {!connected && (
          <button
            onClick={() => pickWallet(-2, 'connect')}
            className="ml-auto rounded border border-strand px-3 py-1.5 font-mono text-xs hover:border-gold"
          >
            connect Ready
          </button>
        )}
        {connected && account && (
          <span className="ml-auto flex items-center gap-2 font-mono text-xs text-muted">
            <span className="text-hidden">●</span>
            {connected} · {label(account)}
            <button
              onClick={disconnectWallet}
              className="rounded border border-strand px-2 py-1 hover:border-gold"
            >
              disconnect
            </button>
          </span>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          onClick={async () => {
            setShare(null)
            setShareError(null)

            let url: string
            try {
              url = `${window.location.origin}/compose?plan=${encodeDraft(draft)}`
            } catch (error) {
              // The only way this throws is a plan too long to be a link, and
              // encodeDraft says so in as many words.
              setShareError(error instanceof Error ? error.message : String(error))
              return
            }

            // Awaited, not fired and forgotten. `void` on this promise swallowed
            // a denied clipboard and the page said "copied" when nothing was -
            // and the one thing worse than a link you have to copy by hand is
            // being told you already have it.
            try {
              await navigator.clipboard.writeText(url)
              setShare({ url, copied: true })
            } catch {
              setShare({ url, copied: false })
            }
          }}
          className="rounded border border-dashed border-strand px-3 py-1.5 text-sm text-muted hover:border-gold"
        >
          copy as a link
        </button>
      </div>

      {shareError && (
        <p className="mt-2 rounded border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
          {shareError}
        </p>
      )}

      {share && (
        <div className="mt-2">
          <p className="font-mono text-xs text-muted">
            {share.copied ? 'copied ·' : 'the clipboard was refused, so here it is to copy ·'}
          </p>
          <p className="mt-1 break-all font-mono text-xs text-cloth select-all">{share.url}</p>
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-2 lg:items-start">
        <section className="min-w-0 space-y-5">
          <Panel title="Input" note="What the pool withdraws to the router before the plan runs.">
            <div className="flex flex-wrap gap-2">
              <TokenSelect
                value={draft.inputToken}
                onChange={(inputToken) => patch({ inputToken })}
              />
              <input
                value={draft.inputAmount}
                aria-label="Input amount"
                onChange={(e) => patch({ inputAmount: e.target.value })}
                className="w-32 rounded border border-thread bg-raised px-2 py-1.5 text-sm"
              />
            </div>
          </Panel>

          {draft.steps.map((step, i) => (
            <Panel key={i} title={`Step ${i + 1}`} note="Any contract, any selector, any calldata.">
              <div className="grid gap-2">
                <Field label="target">
                  <input
                    value={step.target}
                    aria-label={`Step ${i + 1} target`}
                    placeholder="0x… the DEX, market or bridge"
                    onChange={(e) => patchStep(i, { target: e.target.value })}
                    className="w-full rounded border border-thread bg-raised px-2 py-1.5 text-xs"
                  />
                </Field>
                <Field label="selector">
                  <input
                    value={step.selector}
                    aria-label={`Step ${i + 1} selector`}
                    onChange={(e) => patchStep(i, { selector: e.target.value })}
                    className="w-full rounded border border-thread bg-raised px-2 py-1.5 text-xs"
                  />
                </Field>
                <Field label="approve">
                  <div className="flex flex-wrap gap-2">
                    <TokenSelect
                      value={step.approveToken}
                      onChange={(approveToken) => patchStep(i, { approveToken })}
                    />
                    <input
                      value={step.approveAmount}
                      aria-label={`Step ${i + 1} approval amount`}
                      onChange={(e) => patchStep(i, { approveAmount: e.target.value })}
                      className="w-28 rounded border border-thread bg-raised px-2 py-1.5 text-xs"
                    />
                  </div>
                </Field>
                <Field label="calldata">
                  <textarea
                    value={step.calldata}
                    rows={4}
                    onChange={(e) => patchStep(i, { calldata: e.target.value })}
                    className="w-full rounded border border-thread bg-raised px-2 py-1.5 text-xs"
                  />
                </Field>
              </div>
            </Panel>
          ))}

          <button
            onClick={() =>
              patch({
                steps: [
                  ...draft.steps,
                  { target: '', selector: '', approveToken: '', approveAmount: '0', calldata: '' },
                ],
              })
            }
            className="rounded border border-dashed border-strand px-3 py-1.5 text-sm text-muted hover:border-gold"
          >
            + step
          </button>

          <Panel
            title="Outputs"
            note="Tokens credited back into notes. Leave empty when value leaves for good."
          >
            {draft.outputs.length === 0 && (
              <p className="text-xs text-muted">Nothing is credited back.</p>
            )}
            {draft.outputs.map((output, i) => (
              <div key={i} className="mb-2 flex flex-wrap items-center gap-2">
                <TokenSelect
                  value={output.token}
                  onChange={(token) =>
                    patch({
                      outputs: draft.outputs.map((o, j) => (i === j ? { ...o, token } : o)),
                    })
                  }
                />
                <input
                  value={output.minAmount}
                  onChange={(e) =>
                    patch({
                      outputs: draft.outputs.map((o, j) =>
                        i === j ? { ...o, minAmount: e.target.value } : o,
                      ),
                    })
                  }
                  placeholder="floor"
                  aria-label={`Output ${i + 1} minimum amount`}
                  className="w-28 rounded border border-thread bg-raised px-2 py-1.5 text-xs"
                />
                <span className="min-w-0 self-center break-all font-mono text-xs text-muted">
                  {openNote(i)}
                </span>
              </div>
            ))}
            <button
              onClick={() =>
                patch({ outputs: [...draft.outputs, { token: ETH, minAmount: '0' }] })
              }
              className="mt-1 text-xs text-gold"
            >
              + output
            </button>
          </Panel>
        </section>

        {/*
          Sticky beside a long editor. The first viewport used to open on a
          left column half again as tall as the screen while the right one
          fit, so the fold fell inside the form and the disclosure - the reason
          the page exists - scrolled away under it. Now it stays level with
          whatever step is being edited.
        */}
        <section className="min-w-0 space-y-4 lg:sticky lg:top-6">
          <div className="flex flex-wrap gap-2 border-b border-thread">
            {(['reveals', 'calldata', 'actions'] as const).map((name) => (
              <button
                key={name}
                onClick={() => setTab(name)}
                className={`px-3 py-2 text-sm ${
                  tab === name ? 'border-b-2 border-gold text-cloth' : 'text-muted'
                }`}
              >
                {name === 'reveals' ? 'What this reveals' : name}
              </button>
            ))}
          </div>

          {result.error && (
            <p className="rounded border border-warn/40 bg-warn/10 px-3 py-2 font-mono text-xs text-warn">
              {result.error}
            </p>
          )}

          {tab === 'reveals' && disclosure && (
            <div className="min-w-0 space-y-4 text-sm break-words">
              <Group title="Hidden" colour="text-hidden" items={disclosure.hidden} />
              <Group title="Visible" colour="text-visible" items={disclosure.visible} />
              {disclosure.warnings.length > 0 && (
                <Group title="Gives it back" colour="text-warn" items={disclosure.warnings} />
              )}
              {prospect && (
                <Group
                  title="The crowd you would land in"
                  colour={prospect.effectiveSetAfter < 2 ? 'text-warn' : 'text-hidden'}
                  items={[
                    prospect.headcount === 0
                      ? `Nobody else has shielded this much of this token in the current window. Your effective anonymity set would be ${prospect.effectiveSetAfter.toFixed(2)} — you, alone.`
                      : `${prospect.headcount} other ${prospect.headcount === 1 ? 'address is' : 'addresses are'} in the same cell — same token, same order of magnitude, same six-hour window. Your effective anonymity set would be ${prospect.effectiveSetAfter.toFixed(2)}.`,
                    `Cell closes in ${prospect.blocksLeftInCell.toLocaleString()} blocks${minutes(prospect.blocksLeftInCell)}. Round the amount to your neighbours' and you land in a busier one.`,
                  ]}
                  more={[
                    'A cell, not the pool. An observer of the public leg sees the asset, the magnitude and roughly when, so only deposits agreeing on all three cover each other. The figure is a perplexity over the flow, because a cell one address dominates is not the crowd its headcount claims.',
                    'Sign after the cell closes and the deposit lands in the next one, which starts empty.',
                  ]}
                />
              )}
              {crowd && (
                <Group
                  title="The pool"
                  colour="text-muted"
                  items={[
                    `${crowd.depositors} distinct addresses have shielded into the pool. Median effective set per cell ${crowd.cells.medianEffectiveSet.toFixed(2)}; ${Math.round(crowd.cells.aloneShare * 100)}% of cells hold one person; the largest crowd anywhere is ${crowd.cells.largestEffectiveSet.toFixed(1)}.`,
                  ]}
                  more={[
                    'Withdrawals are not counted. Most of them name the fee collector or the paymaster that relays gas, and a shield with no exit still emits one — so a withdrawal only means someone left if its destination is a person.',
                    'Jalin cannot conjure other people. What it changes is how many public legs you need: three transactions at three separate moments is three chances to be the only one there, and a plan is one.',
                  ]}
                />
              )}
            </div>
          )}

          {tab === 'calldata' && result.plan && (
            <pre className="overflow-x-auto rounded border border-thread bg-raised p-3 font-mono text-xs">
              {previewCalldata(result.plan).map((felt, i) => `${String(i).padStart(3, '0')}  ${felt}`).join('\n')}
            </pre>
          )}

          {tab === 'actions' && (
            actions ? (
              <pre className="overflow-x-auto rounded border border-thread bg-raised p-3 font-mono text-xs">
                {JSON.stringify(actions, (_, v) => (typeof v === 'bigint' ? `0x${v.toString(16)}` : v), 2)}
              </pre>
            ) : (
              <p className="max-w-[60ch] rounded border border-thread bg-raised px-3 py-2 text-xs leading-relaxed text-muted">
                {result.plan
                  ? 'Connect a wallet and the exact calls appear here, recipient included. Your address is one of them, and a made-up stand-in would show you a transaction you are not going to send.'
                  : 'Fix the plan first — the calls are derived from it.'}
              </p>
            )
          )}

          <div className="rounded border border-thread bg-raised p-4">
            <button
              onClick={() => pickWallet(null)}
              disabled={
                !result.plan || draftIncomplete || params?.paused || deniedTargets.length > 0
              }
              className="rounded-sm px-4 py-2 text-sm font-medium transition-colors enabled:bg-gold enabled:text-ground enabled:hover:opacity-90 disabled:cursor-not-allowed disabled:border disabled:border-strand disabled:text-muted"
            >
              {ROUTER_ADDRESS ? 'Sign and submit' : 'Check wallet support'}
            </button>
            <button
              onClick={() => pickWallet(null, 'simulate')}
              disabled={
                !result.plan || draftIncomplete || params?.paused || deniedTargets.length > 0
              }
              title="The wallet assembles the transaction and reports what it would refuse, without proving, sending or charging anything."
              className="ml-2 rounded-sm border border-strand px-4 py-2 text-sm hover:border-gold disabled:cursor-not-allowed disabled:opacity-40"
            >
              Dry run
            </button>
            {params?.paused && (
              <p className="mt-2 rounded border border-warn/40 bg-warn/10 px-3 py-2 text-xs leading-relaxed text-warn">
                Governance has the router paused, so every plan reverts. Nothing here can
                override it. See{' '}
                <a className="underline underline-offset-2" href="/governance">
                  governance
                </a>
                .
              </p>
            )}
            {deniedTargets.length > 0 && (
              <p className="mt-2 rounded border border-warn/40 bg-warn/10 px-3 py-2 text-xs leading-relaxed text-warn break-all">
                Governance has denied {deniedTargets.join(', ')}, so this plan would revert.
                The deny list is a circuit breaker, not an allow list.
              </p>
            )}
            <p className="mt-2 max-w-[60ch] text-xs text-muted">
              {draftIncomplete
                ? 'One of the steps has no target yet — a step needs the contract it calls. To send something that already works, use the numbered runs below.'
                : ROUTER_ADDRESS
                ? 'Needs a wallet that implements wallet_strk20InvokeTransaction. Proving takes around 30 seconds.'
                : 'The router is not deployed yet, so there is nothing to sign — this still connects your wallet and reports whether it implements the STRK20 methods.'}
            </p>
            {feedback(null, 'the plan above')}
          </div>
        </section>
      </div>

      <section id="mainnet-run" className="mt-10 scroll-mt-6 rounded border border-thread bg-raised p-5">
        <h2 className="font-mono text-sm">The mainnet run</h2>
        <p className="mt-1 max-w-[62ch] text-xs text-muted">
          Three transactions on mainnet, each an invoke through a contract of ours. Run them in
          order — the shield funds the note the runs spend.
        </p>

        {/*
          Only for an account that has not joined the pool. Once the wallet says
          it has, this paragraph is a step already taken, and leaving it on the
          page made the reader parse a prerequisite that no longer applied.
        */}
        {!caps?.registered && (
          <p className="mt-3 max-w-[62ch] border-t border-thread pt-3 text-xs leading-relaxed text-muted">
            <span className="font-mono">0.</span> First time on this account? Shield any amount
            from inside your wallet — that one transaction publishes your viewing key and
            registers you. No dapp can do it for you; the Wallet API has no register method, and
            skipping it gives <span className="font-mono">NOT_REGISTERED</span>. Verified in{' '}
            <a
              className="text-gold underline underline-offset-2"
              href="https://voyager.online/tx/0x04816dbb3ec04d21cc5da879358e485afdbfe52a3d8f6b8bf4a678003b6e0278"
              target="_blank"
              rel="noreferrer"
            >
              0x04816dbb…0278
            </a>
            .
          </p>
        )}

        {feedback(-2, 'this page')}

        {connected && (
          <p className="mt-4 font-mono text-xs text-muted" data-testid="wallet-says">
            {!caps
              ? `${connected} is connected and has not been asked what it supports yet - the first dry run or run asks.`
              : !caps.strk20
              ? `${connected} does not answer wallet_strk20Balances. It said: ${caps.refusal}`
              : !caps.registered
              ? `${connected} supports STRK20, but this account has not joined the pool: shield once from inside the wallet and it registers you in that transaction.`
              : `${connected} · STRK20 ${caps.versions.length ? `· Wallet API ${caps.versions.join(', ')}` : ''} · balances read from the wallet`}
          </p>
        )}

        {caps?.registered && (
          <div className="mt-4 border-t border-thread pt-3" data-testid="shielded">
            <div className="flex items-baseline justify-between gap-4">
              <span className="font-mono text-sm">In the pool, for this account</span>
              <button
                onClick={() => wallet && refreshBalances(wallet)}
                className="shrink-0 rounded border border-strand px-2 py-1 text-xs hover:border-gold"
              >
                re-read
              </button>
            </div>
            <p className="mt-1 max-w-[60ch] text-xs leading-relaxed text-muted">
              Read from the wallet with <span className="font-mono">wallet_strk20Balances</span>.
              The viewing key that decrypts them never left it; this page sees only the totals.
            </p>
            {balances.length === 0 ? (
              <p className="mt-2 font-mono text-xs text-muted">no shielded tokens yet</p>
            ) : (
              <ul className="mt-2 space-y-0.5 font-mono text-xs">
                {balances.map((entry) => (
                  <li key={entry.token} className="flex justify-between gap-4">
                    <span>{label(entry.token)}</span>
                    <span>{formatUnits(BigInt(entry.balance), decimalsOf(entry.token))}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {caps?.strk20 && (
          <div className="mt-3 border-t border-thread pt-3" data-testid="shadow">
            <span className="font-mono text-sm">Shadow account</span>
            <p className="mt-1 max-w-[60ch] text-xs leading-relaxed text-muted">
              An account the wallet derives for this dapp, with no public link to your main
              wallet. It can hold a position between transactions — a lending deposit, a vault
              subscription — which the router cannot.
            </p>
            {caps.shadow ? (
              <p className="mt-2 break-all font-mono text-xs text-gold">
                {shadow
                  ? `dapp ${SHADOW_DAPP} · partial commitment ${shadow}`
                  : `dapp ${SHADOW_DAPP} · asking the wallet for the commitment…`}
                <span className="mt-1 block font-sans text-muted">
                  Computed inside the wallet from your identity key and this dapp&apos;s name.
                  Nothing was sent, and it reveals no individual account.
                </span>
              </p>
            ) : (
              <p className="mt-2 break-all font-mono text-xs leading-relaxed text-warn">
                {connected} does not answer{' '}
                <span className="font-mono">wallet_strk20ShadowAccountCommitment</span> yet.
                {caps.shadowRefusal ? ` It said: ${caps.shadowRefusal}` : ''}
              </p>
            )}
          </div>
        )}

        <div className="mt-4 border-t border-thread py-3">
          <div className="flex items-baseline justify-between gap-4">
            <span className="font-mono text-sm text-muted">{shield.title}</span>
            <button
              onClick={() => pickWallet(-1)}
              disabled={!ROUTER_ADDRESS || !poolFee}
              className="shrink-0 rounded border border-strand px-3 py-1 text-xs hover:border-gold disabled:opacity-40"
            >
              {!poolFee
                ? paramsFailed
                  ? 'the pool could not be read — reload to try again'
                  : 'reading the pool fee…'
                : shieldHash
                ? 'shield again'
                : `shield · ${Number(shield.amount) / 1e18} STRK`}
            </button>
          </div>
          <p className="mt-1 max-w-[60ch] text-xs leading-relaxed text-muted">{shield.note}</p>
          {poolFee && (
            <p className="mt-1 max-w-[60ch] font-mono text-xs leading-relaxed text-gold">
              {Number(poolFee) / 1e18} STRK per private operation, read from get_fee_amount ·{' '}
              {RUNS.length + 1} operations here, so{' '}
              {Number(poolFee * BigInt(RUNS.length + 1)) / 1e18} STRK of the amount above is fee
              and {Number(shield.amount - poolFee * BigInt(RUNS.length + 1)) / 1e18} is what the
              runs spend
            </p>
          )}
          {shieldHash && (
            <a
              className="mt-1 block break-all font-mono text-xs text-gold"
              href={`https://voyager.online/tx/${shieldHash}`}
              target="_blank"
              rel="noreferrer"
            >
              {shieldHash}
            </a>
          )}
          {shieldHash && verdicts[shieldHash] && (
            <p className="mt-1 text-xs text-muted">{verdicts[shieldHash]}</p>
          )}
          {feedback(-1, shield.title)}
        </div>

        <ol className="mt-4">
          {RUNS.map((run, i) => (
            <li key={run.title} className="border-t border-thread py-3">
              <div className="flex items-baseline justify-between gap-4">
                <span className="font-mono text-sm">
                  {i + 1}. {run.title}
                </span>
                <span className="flex shrink-0 gap-2">
                  <button
                    onClick={() => pickWallet(i, 'simulate')}
                    disabled={!ROUTER_ADDRESS || (run.ballot && !params?.openProposal)}
                    title="Assembled by the wallet, not proved, not sent, not charged."
                    className="rounded border border-strand px-3 py-1 text-xs hover:border-gold disabled:opacity-40"
                  >
                    dry run
                  </button>
                  <button
                    onClick={() => pickWallet(i)}
                    // A ballot with no open proposal is a transaction that reverts
                    // after it has been paid for and proved. Offering the button
                    // anyway would be charging somebody to find that out. A short
                    // balance is the same shape of mistake, and the same button.
                    disabled={
                      !ROUTER_ADDRESS ||
                      (run.ballot && !params?.openProposal) ||
                      shortfall(run) !== null
                    }
                    className="rounded border border-strand px-3 py-1 text-xs hover:border-gold disabled:opacity-40"
                  >
                    {hashes[i] ? 'run again' : `run · ${Number(run.amount) / 1e18} STRK`}
                  </button>
                </span>
              </div>
              <p className="mt-1 max-w-[60ch] text-xs leading-relaxed text-muted">{run.note}</p>
              {shortfall(run) && (
                <p className="mt-1 max-w-[62ch] font-mono text-xs leading-relaxed text-warn">
                  {shortfall(run)}
                </p>
              )}

              {run.ballot &&
                params &&
                (params.openProposal ? (
                  <p className="mt-1 max-w-[62ch] font-mono text-xs text-gold">
                    voting on proposal {params.openProposal.id} · closes in{' '}
                    {params.openProposal.blocksLeft.toLocaleString()} blocks
                    {minutes(params.openProposal.blocksLeft)}
                  </p>
                ) : (
                  <p className="mt-1 max-w-[62ch] font-mono text-xs leading-relaxed text-warn">
                    No proposal is taking votes. Make one on the{' '}
                    <a className="underline underline-offset-2" href="/governance">
                      governance page
                    </a>
                    , then come back within the hour.
                  </p>
                ))}
              {run.title.includes('Endur') && quote && (
                <p className="mt-1 max-w-[62ch] font-mono text-xs text-gold">
                  vault quotes {(Number(quote.shares) / 1e18).toFixed(6)} xSTRK for{' '}
                  {Number(run.amount) / 1e18} STRK · floor{' '}
                  {(Number((quote.shares * 96n) / 100n) / 1e18).toFixed(6)}
                </p>
              )}
              {hashes[i] && (
                <a
                  className="mt-1 block break-all font-mono text-xs text-gold"
                  href={`https://voyager.online/tx/${hashes[i]}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {hashes[i]}
                </a>
              )}
              {hashes[i] && verdicts[hashes[i]!] && (
                <p className="mt-1 text-xs text-muted">{verdicts[hashes[i]!]}</p>
              )}
              {feedback(i, `${i + 1}. ${run.title}`)}
            </li>
          ))}
        </ol>

        {ballotSecret && (
          <p className="mt-3 break-all rounded border border-warn/40 bg-warn/10 p-3 font-mono text-xs text-warn">
            Ballot secret, save it: {ballotSecret}
            <span className="mt-1 block font-sans">
              The only thing that redeems the stake once voting closes. It exists nowhere else —
              not on chain, not on a server. Lose it and the stake stays in the governor for good.
            </span>
            <span className="mt-2 block font-sans">
              It is a bearer instrument: redeeming publishes it in calldata, so whoever sees the
              pending transaction first can spend it instead. Do not paste it anywhere.
            </span>
          </p>
        )}
      </section>

      <footer className="mt-12 max-w-[62ch] border-t border-thread pt-6 text-xs text-muted">
        <a className="text-gold underline underline-offset-2" href="https://github.com/PugarHuda/jalin">
          github.com/PugarHuda/jalin
        </a>{' '}
        · MIT · unaudited, written during the STRK20 Private Sprint
      </footer>
    </main>
  )
}

function Panel({
  title,
  note,
  children,
}: {
  title: string
  note?: string
  children: ReactNode
}) {
  // A rule above, not a box around. The editor's inputs are bordered blocks
  // already, and a bordered block inside a bordered block is the nesting the
  // craft floor calls always wrong - the panel was the outer one.
  return (
    <div className="border-t border-thread pt-4">
      <h2 className="font-mono text-sm">{title}</h2>
      {note && <p className="mb-3 mt-1 max-w-[60ch] text-xs text-muted">{note}</p>}
      {children}
    </div>
  )
}

function Field({ label: name, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block font-mono text-xs text-muted">{name}</span>
      {children}
    </label>
  )
}

function TokenSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <select
      value={value}
      aria-label="Token"
      onChange={(e) => onChange(e.target.value)}
      className="rounded border border-thread bg-raised px-2 py-1.5 text-sm"
    >
      <option value="">none</option>
      {TOKENS.map((token) => (
        <option key={token.address} value={token.address}>
          {token.symbol}
        </option>
      ))}
    </select>
  )
}

/**
 * `more` is the reasoning behind the group, not an extra fact: the reader who
 * wants to know why a cell is the unit, or why withdrawals are not counted,
 * opens it. Leaving it inline made the panel a wall nobody finished reading,
 * and the numbers above it are the part that has to land first.
 */
function Group({
  title,
  colour,
  items,
  more,
}: {
  title: string
  colour: string
  items: string[]
  more?: string[]
}) {
  return (
    <div>
      <h3 className={`font-mono text-xs uppercase tracking-wide ${colour}`}>{title}</h3>
      <ul className="mt-2 space-y-1.5">
        {items.map((item, i) => (
          <li key={i} className="text-sm leading-relaxed break-words text-muted">
            {item}
          </li>
        ))}
      </ul>
      {more && (
        <details className="mt-1.5">
          <summary className="cursor-pointer font-mono text-xs text-muted">why</summary>
          <ul className="mt-1.5 space-y-1.5">
            {more.map((item, i) => (
              <li key={i} className="text-xs leading-relaxed break-words text-muted">
                {item}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
