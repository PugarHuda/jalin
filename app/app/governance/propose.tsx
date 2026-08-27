'use client'

import { useMemo, useState } from 'react'
import { hash, shortString } from 'starknet'
import { KINDS as KIND_NAMES } from '@/lib/config'
import { describeError, readyWallets } from '@/lib/wallet'

/**
 * Submits a real `propose` call.
 *
 * Nothing about this needs STRK20: a proposal is a plain public invoke, which
 * is why governance is the one part of the project that runs end to end today
 * while a plan still waits on a proving service.
 */

/**
 * What each kind asks for. The names and their order come from
 * `lib/governance`, which is also what the contract's `kinds` module numbers -
 * a second list here meant the page could offer a kind the reader labels
 * differently, and nothing would have said so.
 */
const FIELDS: Record<
  (typeof KIND_NAMES)[number],
  { a: string; b: string | null; hint: string }
> = {
  pause: { a: 'paused', b: null, hint: '1 to pause every plan, 0 to resume' },
  limits: { a: 'max steps', b: 'max calldata', hint: 'both must be non-zero' },
  fee: { a: 'fee in bps', b: null, hint: 'target is the recipient · capped at 1000' },
  deny: { a: 'denied', b: null, hint: '1 to deny the target, 0 to allow it again' },
  label: { a: 'label text', b: null, hint: 'up to 31 characters' },
}

const KINDS = KIND_NAMES.map((name, code) => ({ code, name, ...FIELDS[name] }))

/** Text for a label, a plain number for everything else. */
function encodeValue(kind: number, raw: string): string {
  const trimmed = raw.trim()
  if (kind === 4) return trimmed === '' ? '0x0' : shortString.encodeShortString(trimmed)
  if (!/^\d+$/.test(trimmed)) throw new Error(`"${raw}" is not a whole number`)
  return `0x${BigInt(trimmed).toString(16)}`
}

export function Propose({ governor, router }: { governor: string; router: string }) {
  const [kind, setKind] = useState(4)
  const [target, setTarget] = useState(router)
  const [valueA, setValueA] = useState('JALIN_ROUTER')
  const [valueB, setValueB] = useState('0')
  const [status, setStatus] = useState<string | null>(null)
  const [sent, setSent] = useState<string | null>(null)

  const spec = KINDS[kind]!

  /**
   * The call, and separately whether one could be built.
   *
   * These used to be one object: the happy path returned the three call fields
   * plus `error: null`, and the whole thing was handed to the wallet. A wallet
   * that validates its payload refuses a call carrying a fourth field, so every
   * propose from Ready came back `INVALID_REQUEST_PAYLOAD` - a valid proposal
   * rejected for a key that only ever existed to colour this component's own
   * error line. `execute` and `sweep` send the same shape and were never
   * affected, because they never had a validation result to carry.
   */
  const { call, error: invalid } = useMemo(() => {
    try {
      if (!/^0x[0-9a-fA-F]{1,64}$/.test(target.trim())) {
        throw new Error('target must be a felt')
      }
      return {
        call: {
          contract_address: governor,
          entry_point_selector: hash.getSelectorFromName('propose'),
          calldata: [
            `0x${kind.toString(16)}`,
            `0x${BigInt(target.trim()).toString(16)}`,
            encodeValue(kind, valueA),
            spec.b ? encodeValue(kind, valueB) : '0x0',
          ],
        },
        error: null as string | null,
      }
    } catch (error) {
      return { call: null, error: error instanceof Error ? error.message : String(error) }
    }
  }, [governor, kind, target, valueA, valueB, spec.b])

  async function submit() {
    setStatus(null)
    setSent(null)
    try {
      const { wallets, error: noWallet } = await readyWallets()
      const wallet = wallets[0]
      if (!wallet) return setStatus(noWallet)

      if (!call) return setStatus(invalid)

      const { default: getStarknet } = await import('get-starknet-core')
      await getStarknet.enable(wallet)
      const response = (await wallet.request({
        type: 'wallet_addInvokeTransaction',
        params: { calls: [call as never] },
      })) as { transaction_hash: string }

      setSent(response.transaction_hash)
    } catch (error) {
      setStatus(describeError(error))
    }
  }

  return (
    <div className="mt-4 space-y-4">
      <div className="flex flex-wrap gap-2">
        {KINDS.map((entry) => (
          <button
            key={entry.code}
            onClick={() => setKind(entry.code)}
            className={`rounded border px-3 py-1.5 text-sm ${
              kind === entry.code ? 'border-gold text-gold' : 'border-strand hover:border-gold'
            }`}
          >
            {entry.name}
          </button>
        ))}
      </div>

      <p className="font-mono text-xs text-muted">{spec.hint}</p>

      <label className="block">
        <span className="font-mono text-xs text-muted">target</span>
        <input
          value={target}
          onChange={(event) => setTarget(event.target.value)}
          className="mt-1 w-full rounded border border-strand bg-raised px-3 py-2 font-mono text-xs"
        />
      </label>

      <div className="flex flex-wrap gap-3">
        <label className="min-w-0 flex-1">
          <span className="font-mono text-xs text-muted">{spec.a}</span>
          <input
            value={valueA}
            onChange={(event) => setValueA(event.target.value)}
            className="mt-1 w-full rounded border border-strand bg-raised px-3 py-2 font-mono text-xs"
          />
        </label>
        {spec.b && (
          <label className="min-w-0 flex-1">
            <span className="font-mono text-xs text-muted">{spec.b}</span>
            <input
              value={valueB}
              onChange={(event) => setValueB(event.target.value)}
              className="mt-1 w-full rounded border border-strand bg-raised px-3 py-2 font-mono text-xs"
            />
          </label>
        )}
      </div>

      {invalid ? (
        <p className="rounded border border-warn/40 bg-warn/10 px-3 py-2 font-mono text-xs text-warn">
          {invalid}
        </p>
      ) : (
        <details>
          <summary className="cursor-pointer font-mono text-xs text-muted">
            the exact call this would send
          </summary>
          <pre className="mt-1 overflow-x-auto rounded border border-thread bg-raised p-3 font-mono text-[11px]">
            {JSON.stringify(call, null, 2)}
          </pre>
        </details>
      )}

      <button
        onClick={submit}
        disabled={Boolean(invalid) || !governor}
        className="rounded-sm px-4 py-2 text-sm font-medium transition-colors enabled:bg-gold enabled:text-ground enabled:hover:opacity-90 disabled:cursor-not-allowed disabled:border disabled:border-strand disabled:text-muted"
      >
        Sign and propose
      </button>

      {sent && (
        <p className="break-all font-mono text-xs text-hidden">
          sent ·{' '}
          <a
            className="text-gold underline underline-offset-2"
            href={`https://voyager.online/tx/${sent}`}
            target="_blank"
            rel="noreferrer"
          >
            {sent}
          </a>
        </p>
      )}
      {status && <p className="break-all font-mono text-xs text-warn">{status}</p>}
    </div>
  )
}
