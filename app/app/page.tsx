'use client'

import { useMemo, useState, type ReactNode } from 'react'
import type { StarknetWindowObject } from 'get-starknet-core'
import { hash } from 'starknet'
import {
  describeDisclosure,
  encodePlan,
  openNote,
  previewCalldata,
  toWalletActions,
  u256,
  type Plan,
  type Strk20Action,
} from '@jalin/sdk'
import { POOL_ADDRESS, ROUTER_ADDRESS, TOKENS, label, toBaseUnits, tokenOf } from '@/lib/config'

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
    name: 'Single swap',
    blurb: 'One leg. AVNU already does this better - see the README on when not to use Jalin.',
    draft: {
      inputToken: STRK,
      inputAmount: '10',
      steps: [
        {
          target: '',
          selector: 'swap',
          approveToken: STRK,
          approveAmount: '10',
          calldata: `${STRK}\n${ETH}\n{amount:u256}\n0\n0`,
        },
      ],
      outputs: [{ token: ETH, minAmount: '0.001' }],
    },
  },
  {
    name: 'Swap, then bridge',
    blurb: 'Two legs, one transaction. This is the case nothing else can do.',
    draft: {
      inputToken: STRK,
      inputAmount: '10',
      steps: [
        {
          target: '',
          selector: 'swap',
          approveToken: STRK,
          approveAmount: '10',
          calldata: `${STRK}\n${ETH}\n{amount:u256}\n0\n0`,
        },
        {
          target: '',
          selector: 'deposit_for_burn',
          approveToken: ETH,
          approveAmount: '0.002',
          calldata: '{amount:u256}\n0x0\n0x0',
        },
      ],
      outputs: [],
    },
  },
  {
    name: 'Bridge away',
    blurb: 'Credits nothing back. Legal because the pool accepts an empty Span.',
    draft: {
      inputToken: STRK,
      inputAmount: '10',
      steps: [
        {
          target: '',
          selector: 'deposit_for_burn',
          approveToken: STRK,
          approveAmount: '10',
          calldata: '{amount:u256}\n0x0\n0x0',
        },
      ],
      outputs: [],
    },
  },
]

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

  const result = useMemo(() => {
    try {
      const plan = buildPlan(draft)
      encodePlan(plan) // validates
      return { plan, error: null as string | null }
    } catch (error) {
      return { plan: null, error: error instanceof Error ? error.message : String(error) }
    }
  }, [draft])

  const patch = (change: Partial<Draft>) => setDraft((d) => ({ ...d, ...change }))
  const patchStep = (i: number, change: Partial<StepForm>) =>
    patch({ steps: draft.steps.map((s, j) => (i === j ? { ...s, ...change } : s)) })

  async function pickWallet() {
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
      await anyWallet.request({ type: 'wallet_strk20Balances' })
      return `STRK20 supported by ${who}. Wallet API ${versions}.`
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return `${who} does not answer wallet_strk20Balances, so it cannot sign a Jalin plan yet. Wallet API ${versions}. It said: ${message}`
    }
  }

  async function execute(wallet: StarknetWindowObject) {
    if (!result.plan) return
    setWallets([])
    setStatus('Connecting…')
    try {
      const { default: getStarknet } = await import('get-starknet-core')
      await getStarknet.enable(wallet)

      const [account] = (await wallet.request({
        type: 'wallet_requestAccounts',
      })) as string[]
      if (!account) return setStatus('Wallet returned no account.')

      setStatus('Checking what this wallet supports…')
      const capability = await probe(wallet)
      if (!capability.startsWith('STRK20 supported')) return setStatus(capability)
      if (!ROUTER_ADDRESS) {
        return setStatus(`${capability} The router is not deployed yet, so there is nothing to sign.`)
      }

      const actions = toWalletActions(result.plan, {
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
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    }
  }

  const disclosure = result.plan ? describeDisclosure(result.plan) : null

  return (
    <main className="mx-auto w-full max-w-6xl px-5 py-10">
      <header className="border-b border-border pb-6">
        <h1 className="font-mono text-2xl tracking-tight">jalin</h1>
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
            className="rounded border border-border bg-surface px-3 py-1.5 text-sm hover:border-accent"
          >
            {preset.name}
          </button>
        ))}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="space-y-5">
          <Panel title="Input" note="What the pool withdraws to the router before the plan runs.">
            <div className="flex gap-2">
              <TokenSelect
                value={draft.inputToken}
                onChange={(inputToken) => patch({ inputToken })}
              />
              <input
                value={draft.inputAmount}
                onChange={(e) => patch({ inputAmount: e.target.value })}
                className="w-32 rounded border border-border bg-surface px-2 py-1.5 text-sm"
              />
            </div>
          </Panel>

          {draft.steps.map((step, i) => (
            <Panel key={i} title={`Step ${i + 1}`} note="Any contract, any selector, any calldata.">
              <div className="grid gap-2">
                <Field label="target">
                  <input
                    value={step.target}
                    placeholder="0x… the DEX, market or bridge"
                    onChange={(e) => patchStep(i, { target: e.target.value })}
                    className="w-full rounded border border-border bg-surface px-2 py-1.5 text-xs"
                  />
                </Field>
                <Field label="selector">
                  <input
                    value={step.selector}
                    onChange={(e) => patchStep(i, { selector: e.target.value })}
                    className="w-full rounded border border-border bg-surface px-2 py-1.5 text-xs"
                  />
                </Field>
                <Field label="approve">
                  <div className="flex gap-2">
                    <TokenSelect
                      value={step.approveToken}
                      onChange={(approveToken) => patchStep(i, { approveToken })}
                    />
                    <input
                      value={step.approveAmount}
                      onChange={(e) => patchStep(i, { approveAmount: e.target.value })}
                      className="w-28 rounded border border-border bg-surface px-2 py-1.5 text-xs"
                    />
                  </div>
                </Field>
                <Field label="calldata">
                  <textarea
                    value={step.calldata}
                    rows={4}
                    onChange={(e) => patchStep(i, { calldata: e.target.value })}
                    className="w-full rounded border border-border bg-surface px-2 py-1.5 text-xs"
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
            className="rounded border border-dashed border-border px-3 py-1.5 text-sm text-muted hover:border-accent"
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
              <div key={i} className="mb-2 flex gap-2">
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
                  className="w-28 rounded border border-border bg-surface px-2 py-1.5 text-xs"
                />
                <span className="self-center font-mono text-xs text-muted">
                  {openNote(i)}
                </span>
              </div>
            ))}
            <button
              onClick={() =>
                patch({ outputs: [...draft.outputs, { token: ETH, minAmount: '0' }] })
              }
              className="mt-1 text-xs text-accent"
            >
              + output
            </button>
          </Panel>
        </section>

        <section className="space-y-4">
          <div className="flex gap-2 border-b border-border">
            {(['reveals', 'calldata', 'actions'] as const).map((name) => (
              <button
                key={name}
                onClick={() => setTab(name)}
                className={`px-3 py-2 text-sm ${
                  tab === name ? 'border-b-2 border-accent text-foreground' : 'text-muted'
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
            <div className="space-y-4 text-sm">
              <Group title="Hidden" colour="text-hidden" items={disclosure.hidden} />
              <Group title="Visible" colour="text-visible" items={disclosure.visible} />
              {disclosure.warnings.length > 0 && (
                <Group title="Gives it back" colour="text-warn" items={disclosure.warnings} />
              )}
            </div>
          )}

          {tab === 'calldata' && result.plan && (
            <pre className="overflow-x-auto rounded border border-border bg-surface p-3 font-mono text-xs">
              {previewCalldata(result.plan).map((felt, i) => `${String(i).padStart(3, '0')}  ${felt}`).join('\n')}
            </pre>
          )}

          {tab === 'actions' && result.plan && (
            <pre className="overflow-x-auto rounded border border-border bg-surface p-3 font-mono text-xs">
              {JSON.stringify(
                toWalletActions(result.plan, {
                  router: ROUTER_ADDRESS || '0xROUTER_NOT_DEPLOYED',
                  inputs: [
                    {
                      token: draft.inputToken,
                      amount: toBaseUnits(draft.inputAmount, decimalsOf(draft.inputToken)),
                    },
                  ],
                  recipient: '0xYOUR_ACCOUNT',
                }),
                (_, v) => (typeof v === 'bigint' ? `0x${v.toString(16)}` : v),
                2,
              )}
            </pre>
          )}

          <div className="rounded border border-border bg-surface p-4">
            <button
              onClick={pickWallet}
              disabled={!result.plan}
              className="rounded bg-accent px-4 py-2 text-sm text-background disabled:opacity-40"
            >
              {ROUTER_ADDRESS ? 'Sign and submit' : 'Check wallet support'}
            </button>
            {wallets.length > 0 && (
              <ul className="mt-3 space-y-1">
                {wallets.map((wallet) => (
                  <li key={wallet.id}>
                    <button
                      onClick={() => execute(wallet)}
                      className="w-full rounded border border-border px-3 py-2 text-left text-sm hover:border-accent"
                    >
                      {wallet.name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-xs text-muted">
              {ROUTER_ADDRESS
                ? 'Needs a wallet that implements wallet_strk20InvokeTransaction. Proving takes around 30 seconds.'
                : 'The router is not deployed yet, so there is nothing to sign — but this still connects your wallet and tells you whether it implements the STRK20 methods.'}
            </p>
            {status && <p className="mt-2 break-all font-mono text-xs">{status}</p>}
          </div>
        </section>
      </div>

      <footer className="mt-12 border-t border-border pt-6 text-xs text-muted">
        <a className="text-accent" href="https://github.com/PugarHuda/jalin">
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
    <div className="rounded border border-border bg-surface p-4">
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
      onChange={(e) => onChange(e.target.value)}
      className="rounded border border-border bg-surface px-2 py-1.5 text-sm"
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
          <li key={i} className="text-sm leading-relaxed text-muted">
            {item}
          </li>
        ))}
      </ul>
    </div>
  )
}
