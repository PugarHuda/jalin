'use client'
import Link from 'next/link'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { StarknetWindowObject } from 'get-starknet-core'
import { hash, shortString } from 'starknet'
import {
  depositStep,
  describeDisclosure,
  encodePlan,
  openNote,
  previewCalldata,
  feltsToStrings,
  toFelt,
  toWalletActions,
  u256,
  type Plan,
  type Strk20Action,
} from '@jalin/sdk'
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
const PROPOSAL_ID = 1n

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

/**
 * Enough to cover all three runs at once. Runs 1 and 2 are round trips - what
 * they withdraw comes straight back into a note - so only the ballot's stake
 * actually leaves, and one shield covers the lot.
 */
const SHIELD_AMOUNT = ONE

const SHIELD: MainnetRun = {
  title: 'Shield 1 STRK',
  note: 'Moves public STRK into the pool as an encrypted note. Not one of the three - it goes through the pool but not through a contract of ours, so it does not count. Combining it with the plan below would be quieter, and the wallet will not have it: a withdrawal is checked against the private balance you already hold, and a deposit in the same action set does not arrive in time to cover it.',
  amount: SHIELD_AMOUNT,
  shieldOnly: true,
}

const RUNS: MainnetRun[] = [
  {
    title: 'Two steps, one invoke',
    note: 'Two external calls inside the single invoke the pool allows - the composition nothing else can do. The calls move nothing and the whole balance is credited back, so this proves the sandwich for the price of fees.',
    amount: ONE / 2n,
    plan: proofOfMechanism(2),
  },
  {
    title: 'Stake on Endur, privately',
    note: 'A real ERC-4626 deposit into Endur’s liquid staking vault, which returns xSTRK straight into a shielded note. No Jalin-specific adapter and no contract written for Endur - the vault has an ABI, so it is reachable as a step.',
    amount: ONE / 4n,
    plan: endurStake(ONE / 4n),
  },
  {
    title: 'Private ballot',
    note: 'A vote on proposal 1 through JalinGovernor, which is an anonymizer helper in its own right. The weight is public, the voter is not.',
    amount: ONE / 10n,
    ballot: true,
  },
]

/**
 * A JSON-RPC error carries a code and usually a `data` field naming the field it
 * rejected. `error.message` alone reduces all of that to "An error occurred
 * (INVALID_REQUEST_PAYLOAD)", which is the difference between a fix and a guess.
 */
function describeError(error: unknown): string {
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

function decimalsOf(address: string): number {
  return tokenOf(address)?.decimals ?? 18
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
  denied: Record<string, boolean>
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

export default function Home() {
  const [draft, setDraft] = useState<Draft>(PRESETS[0]!.draft)
  const [tab, setTab] = useState<'reveals' | 'calldata' | 'actions'>('reveals')
  const [status, setStatus] = useState<string | null>(null)
  const [wallets, setWallets] = useState<StarknetWindowObject[]>([])
  const [pendingRun, setPendingRun] = useState<number | null>(null)
  const [hashes, setHashes] = useState<(string | null)[]>([null, null, null])
  const [ballotSecret, setBallotSecret] = useState<string | null>(null)
  const [lastPayload, setLastPayload] = useState<string | null>(null)
  const [shieldHash, setShieldHash] = useState<string | null>(null)
  const [account, setAccount] = useState<string | null>(null)
  const [params, setParams] = useState<LiveParams | null>(null)
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

  // The Endur run's floor comes from the vault rather than from a constant. A
  // constant cannot know the share price moved, so it is either too loose to
  // protect anything or tight enough to revert for no reason.
  useEffect(() => {
    let cancelled = false
    const assets = RUNS.find((r) => r.plan && r.title.includes('Endur'))?.amount
    if (!assets) return
    fetch(`/api/quote?assets=${assets.toString()}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (!cancelled && body?.shares) setQuote({ shares: BigInt(body.shares) })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  // The size of the crowd is the one privacy number every tool asks you to
  // assume. It is on chain, so it is measured rather than asserted.
  useEffect(() => {
    let cancelled = false
    fetch('/api/crowd')
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (!cancelled && typeof body?.depositors === 'number') setCrowd(body)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  /**
   * The crowd for this deposit, not for the pool. An observer of the public leg
   * sees the asset, the order of magnitude and roughly when, so the set that
   * covers you is the one that agrees on all three. Re-asked as the amount
   * changes, because changing it moves you to a different cell.
   */
  useEffect(() => {
    let cancelled = false
    let amount = 0n
    try {
      amount = toBaseUnits(draft.inputAmount, decimalsOf(draft.inputToken))
    } catch {
      return
    }

    // Clearing runs on the same timer as asking. Calling setState straight out
    // of an effect body forces a second render pass before paint, and doing it
    // only on the empty-amount branch meant one path was debounced and the
    // other was not.
    const timer = setTimeout(() => {
      if (amount <= 0n) {
        if (!cancelled) setProspect(null)
        return
      }

      const query = new URLSearchParams({ asset: draft.inputToken, amount: amount.toString() })
      fetch(`/api/crowd?${query}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((body) => {
          if (!cancelled && typeof body?.effectiveSetAfter === 'number') setProspect(body)
        })
        .catch(() => {})
    }, 300)

    return () => {
      cancelled = true
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
    let cancelled = false

    // Debounced, because every prefix of an address being typed is itself a
    // valid felt - so without this it was one node call per keystroke.
    const timer = setTimeout(() => {
      fetch(`/api/params?targets=${encodeURIComponent(targets)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((body) => {
          if (!cancelled && typeof body?.maxSteps === 'number') setParams(body)
        })
        .catch(() => {})
    }, 300)

    return () => {
      cancelled = true
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

  async function pickWallet(runIndex: number | null = null) {
    setPendingRun(runIndex)
    const { default: getStarknet } = await import('get-starknet-core')
    const available = await getStarknet.getAvailableWallets()
    if (available.length === 0) {
      setStatus('No Starknet wallet found in this browser.')
      return
    }
    setWallets(available)
    setStatus(null)
  }

  /**
   * Whether this wallet implements the STRK20 methods at all. The account class
   * on chain says nothing about it - support lives in the wallet, not in the
   * account - so the only honest test is to call one and see. `strk20Balances`
   * is the read-only one, which makes it the safe probe.
   */
  async function probe(wallet: StarknetWindowObject): Promise<string> {
    const anyWallet = wallet as unknown as {
      request(call: { type: string; params?: unknown }): Promise<unknown>
    }

    // Name the wallet in the answer. Without it a pasted result cannot be told
    // apart from the last one, and "not implemented" is only useful when you
    // know which wallet said it.
    const named = wallet as unknown as { id?: string; name?: string; version?: string }
    const who = `${named.name ?? 'unknown wallet'}${named.version ? ` ${named.version}` : ''} (id: ${named.id ?? '?'})`

    let versions = 'unknown'
    try {
      const supported = (await anyWallet.request({ type: 'wallet_supportedWalletApi' })) as string[]
      versions = supported.join(', ')
    } catch {}

    try {
      // `tokens` is required; an empty array means every shielded token. Calling
      // it with no params at all returns INVALID_REQUEST_PAYLOAD, which reads
      // like a missing method and is not one.
      await anyWallet.request({ type: 'wallet_strk20Balances', params: { tokens: [] } })
      return `STRK20 supported by ${who}. Wallet API ${versions}.`
    } catch (error) {
      const message = describeError(error)
      // NOT_REGISTERED is the pool saying "I know this method, you have no notes
      // yet" - which is support, not the absence of it.
      if (/NOT_REGISTERED/i.test(message)) {
        return `STRK20 supported by ${who}, but this account has not joined the pool yet. Shield once from inside the wallet and it registers you in the same transaction. Wallet API ${versions}.`
      }
      return `${who} does not answer wallet_strk20Balances, so it cannot sign a Jalin plan yet. Wallet API ${versions}. It said: ${message}`
    }
  }

  function buildRunActions(run: MainnetRun, account: string): Strk20Action[] {
    const strk = TOKENS[0]!.address

    if (run.shieldOnly) {
      return [{ type: 'deposit', token: toFelt(strk), amount: toFelt(run.amount) }]
    }

    if (run.ballot) {
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
            PROPOSAL_ID,
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
  async function judge(hash: string) {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      try {
        const response = await fetch(`/api/tx?hash=${hash}`)
        if (response.ok) {
          const body = (await response.json()) as { exists?: boolean; summary?: string }
          if (body.summary) setVerdicts((v) => ({ ...v, [hash]: body.summary! }))
          if (body.exists) return
        }
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 5000))
    }
  }

  async function execute(wallet: StarknetWindowObject) {
    const run =
      pendingRun === null ? null : pendingRun === -1 ? SHIELD : RUNS[pendingRun]!
    if (!run && !result.plan) return
    setWallets([])
    setStatus('Connecting…')
    try {
      const { default: getStarknet } = await import('get-starknet-core')
      await getStarknet.enable(wallet)

      const [account] = (await wallet.request({
        type: 'wallet_requestAccounts',
      })) as string[]
      if (!account) return setStatus('Wallet returned no account.')
      setAccount(account)

      setStatus('Checking what this wallet supports…')
      const capability = await probe(wallet)
      if (!capability.startsWith('STRK20 supported')) return setStatus(capability)
      if (!ROUTER_ADDRESS) {
        return setStatus(`${capability} The router is not deployed yet, so there is nothing to sign.`)
      }

      const actions = run
        ? buildRunActions(run, account)
        : toWalletActions(result.plan!, {
            router: ROUTER_ADDRESS,
            inputs: [
              {
                token: draft.inputToken,
                amount: toBaseUnits(draft.inputAmount, decimalsOf(draft.inputToken)),
              },
            ],
            recipient: account,
          })

      setStatus('Proving. This takes around 30 seconds; the wallet stays open.')
      setLastPayload(JSON.stringify(actions, null, 2))
      console.log('[jalin] strk20 actions', actions)
      // get-starknet-core bundles an older @starknet-io/types-js whose request
      // map predates STRK20, so the method it is about to call is not in its
      // types. The wallet either implements wallet_strk20InvokeTransaction or
      // rejects the call - which is what the catch below reports.
      const strk20 = wallet as unknown as {
        request(call: {
          type: 'wallet_strk20InvokeTransaction'
          params: { actions: Strk20Action[] }
        }): Promise<{ transaction_hash: string }>
      }
      const response = await strk20.request({
        type: 'wallet_strk20InvokeTransaction',
        params: { actions },
      })

      setStatus(`Submitted: ${response.transaction_hash}`)
      judge(response.transaction_hash)
      if (pendingRun === -1) {
        setShieldHash(response.transaction_hash)
      } else if (pendingRun !== null) {
        const index = pendingRun
        setHashes((previous) =>
          previous.map((h, i) => (i === index ? response.transaction_hash : h)),
        )
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
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
          <Link href="/" className="font-display text-lg font-extrabold tracking-tight hover:text-gold">
            jalin
          </Link>
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
        <p className="mt-2 max-w-2xl text-sm text-muted">
          A programmable execution router for the STRK20 shielded pool. The pool allows one
          invoke per transaction, so a private DeFi action is normally only as expressive as
          the single helper contract it calls. Jalin takes a plan instead, and composition
          happens inside that one invoke.
        </p>
        <p className="mt-3 font-mono text-xs text-muted">
          pool {label(POOL_ADDRESS)} · router {ROUTER_ADDRESS ? label(ROUTER_ADDRESS) : 'not deployed yet'}
        </p>
      </header>

      <div className="mt-6 flex flex-wrap gap-2">
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
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
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

        <section className="min-w-0 space-y-4">
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
                      ? `Nobody else has shielded this much of this token in the current window. Your effective anonymity set would be ${prospect.effectiveSetAfter.toFixed(2)} — you, alone. The public deposit leg would identify this transaction completely.`
                      : `${prospect.headcount} other ${prospect.headcount === 1 ? 'address is' : 'addresses are'} in the same cell — same token, same order of magnitude, same six-hour window. Your effective anonymity set would be ${prospect.effectiveSetAfter.toFixed(2)}.`,
                    'A cell, not the pool. An observer of the public leg sees the asset, the magnitude and roughly when, so only deposits agreeing on all three cover each other. The figure is a perplexity over the flow, because a cell one address dominates is not the crowd its headcount claims.',
                    'Changing the amount moves you to a different cell. Rounding to whatever your neighbours used is the cheapest privacy available here.',
                    `This cell closes in ${prospect.blocksLeftInCell.toLocaleString()} blocks — about ${Math.round((prospect.blocksLeftInCell * 1.68) / 60)} minutes at mainnet's 1.68s. Sign after that and the deposit lands in the next one, which starts empty.`,
                  ]}
                />
              )}
              {crowd && (
                <Group
                  title="The pool"
                  colour="text-muted"
                  items={[
                    `${crowd.depositors} distinct addresses have shielded into the pool. Across every cell the median effective set is ${crowd.cells.medianEffectiveSet.toFixed(2)} and ${Math.round(crowd.cells.aloneShare * 100)}% of cells hold exactly one person; the largest crowd anywhere is ${crowd.cells.largestEffectiveSet.toFixed(1)}.`,
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
              <p className="rounded border border-thread bg-raised px-3 py-2 text-xs leading-relaxed text-muted">
                {result.plan
                  ? 'Connect a wallet and the exact calls appear here, recipient included. Your address is one of them, and there is no honest stand-in for it — a made-up one would show you a transaction you are not going to send. Running any of the numbered transactions below connects the wallet.'
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
            {wallets.length > 0 && (
              <ul className="mt-3 space-y-1">
                {wallets.map((wallet) => (
                  <li key={wallet.id}>
                    <button
                      onClick={() => execute(wallet)}
                      className="w-full rounded border border-strand px-3 py-2 text-left text-sm hover:border-gold"
                    >
                      {wallet.name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {params?.paused && (
              <p className="mt-2 rounded border border-warn/40 bg-warn/10 px-3 py-2 text-xs leading-relaxed text-warn">
                Governance has the router paused, so every plan reverts. Nothing here can override
                it — that is the point of it. See{' '}
                <a className="underline underline-offset-2" href="/governance">
                  governance
                </a>
                .
              </p>
            )}
            {deniedTargets.length > 0 && (
              <p className="mt-2 rounded border border-warn/40 bg-warn/10 px-3 py-2 text-xs leading-relaxed text-warn break-all">
                Governance has denied {deniedTargets.join(', ')}. The router refuses a denied
                target, so this plan would revert. The deny list is a circuit breaker, not an
                allow list — everything not on it stays callable.
              </p>
            )}
            <p className="mt-2 text-xs text-muted">
              {draftIncomplete
                ? 'One of the steps has no target yet. A step needs the contract it calls, and there is no honest default for which contract that is. To send something that already works, use the numbered runs below.'
                : ROUTER_ADDRESS
                ? 'Needs a wallet that implements wallet_strk20InvokeTransaction. Proving takes around 30 seconds.'
                : 'The router is not deployed yet, so there is nothing to sign — but this still connects your wallet and tells you whether it implements the STRK20 methods.'}
            </p>
            {status && <p className="mt-2 break-all font-mono text-xs">{status}</p>}
            {status?.includes('NOT_REGISTERED') && (
              <p className="mt-2 rounded border border-strand px-3 py-2 text-xs leading-relaxed">
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
                <pre className="mt-1 max-h-64 overflow-auto rounded border border-thread p-2 font-mono text-[10px] break-all whitespace-pre-wrap">
                  {lastPayload}
                </pre>
              </details>
            )}
          </div>
        </section>
      </div>

      <section className="mt-10 rounded border border-thread bg-raised p-5">
        <h2 className="font-mono text-sm">The mainnet run</h2>
        <p className="mt-1 max-w-3xl text-xs text-muted">
          Three transactions on Starknet mainnet, each an invoke through a contract of ours.
          Small and deliberately dull: the point is to prove the mechanism with real value, not
          to take a market position. Run them in order - the first one shields the note the
          other two spend.
        </p>

        <p className="mt-3 rounded border border-thread px-3 py-2 text-xs leading-relaxed text-muted">
          <span className="font-mono">0.</span> First time on this account? The pool needs your
          public viewing key before anything can be sent to you privately, and that is not a step
          any dapp can do for you — there is no register method in the Wallet API. Shield any
          amount once from inside your wallet and it publishes the key in that same transaction.
          Verified on mainnet in{' '}
          <a
            className="text-gold underline underline-offset-2"
            href="https://voyager.online/tx/0x04816dbb3ec04d21cc5da879358e485afdbfe52a3d8f6b8bf4a678003b6e0278"
            target="_blank"
            rel="noreferrer"
          >
            0x04816dbb…0278
          </a>
          , where one Ready shield emitted <span className="font-mono">ViewingKeySet</span>,{' '}
          <span className="font-mono">Deposit</span> and{' '}
          <span className="font-mono">EncNoteCreated</span> together. Skipping it gives you{' '}
          <span className="font-mono">NOT_REGISTERED</span>.
        </p>

        <div className="mt-4 border-t border-thread py-3">
          <div className="flex items-baseline justify-between gap-4">
            <span className="font-mono text-sm text-muted">{SHIELD.title}</span>
            <button
              onClick={() => pickWallet(-1)}
              disabled={!ROUTER_ADDRESS}
              className="shrink-0 rounded border border-strand px-3 py-1 text-xs hover:border-gold disabled:opacity-40"
            >
              {shieldHash ? 'shield again' : `shield · ${Number(SHIELD.amount) / 1e18} STRK`}
            </button>
          </div>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted">{SHIELD.note}</p>
          {shieldHash && (
            <a
              className="mt-1 block break-all font-mono text-[11px] text-gold"
              href={`https://voyager.online/tx/${shieldHash}`}
              target="_blank"
              rel="noreferrer"
            >
              {shieldHash}
            </a>
          )}
          {shieldHash && verdicts[shieldHash] && (
            <p className="mt-1 text-[11px] text-muted">{verdicts[shieldHash]}</p>
          )}
        </div>

        <ol className="mt-4">
          {RUNS.map((run, i) => (
            <li key={run.title} className="border-t border-thread py-3">
              <div className="flex items-baseline justify-between gap-4">
                <span className="font-mono text-sm">
                  {i + 1}. {run.title}
                </span>
                <button
                  onClick={() => pickWallet(i)}
                  disabled={!ROUTER_ADDRESS}
                  className="shrink-0 rounded border border-strand px-3 py-1 text-xs hover:border-gold disabled:opacity-40"
                >
                  {hashes[i] ? 'run again' : `run · ${Number(run.amount) / 1e18} STRK`}
                </button>
              </div>
              <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted">{run.note}</p>
              {run.title.includes('Endur') && quote && (
                <p className="mt-1 font-mono text-[11px] text-gold">
                  vault quotes {(Number(quote.shares) / 1e18).toFixed(6)} xSTRK for{' '}
                  {Number(run.amount) / 1e18} STRK · floor{' '}
                  {(Number((quote.shares * 96n) / 100n) / 1e18).toFixed(6)}
                </p>
              )}
              {hashes[i] && (
                <a
                  className="mt-1 block break-all font-mono text-[11px] text-gold"
                  href={`https://voyager.online/tx/${hashes[i]}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {hashes[i]}
                </a>
              )}
              {hashes[i] && verdicts[hashes[i]!] && (
                <p className="mt-1 text-[11px] text-muted">{verdicts[hashes[i]!]}</p>
              )}
            </li>
          ))}
        </ol>

        {ballotSecret && (
          <p className="mt-3 break-all rounded border border-warn/40 bg-warn/10 p-3 font-mono text-[11px] text-warn">
            Ballot secret, save it: {ballotSecret}
            <span className="mt-1 block font-sans">
              This is the only thing that redeems the stake once voting closes. It exists
              nowhere else — not on chain, not on a server. Lose it and the stake stays in the
              governor for good.
            </span>
            <span className="mt-2 block font-sans">
              It is a bearer instrument. Redeeming publishes it, because an invoke action&apos;s
              calldata is public, so whoever sees the pending transaction first can spend it
              instead — the same window a swap has against a sandwich. It is worth exactly this
              stake, and worth nothing once spent. Do not paste it anywhere.
            </span>
          </p>
        )}
      </section>

      <footer className="mt-12 border-t border-thread pt-6 text-xs text-muted">
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
  return (
    <div className="rounded border border-thread bg-raised p-4">
      <h2 className="font-mono text-sm">{title}</h2>
      {note && <p className="mb-3 mt-1 text-xs text-muted">{note}</p>}
      {children}
    </div>
  )
}

function Field({ label: name, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block font-mono text-[11px] text-muted">{name}</span>
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

function Group({ title, colour, items }: { title: string; colour: string; items: string[] }) {
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
    </div>
  )
}
