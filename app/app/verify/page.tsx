'use client'

import { useState } from 'react'

/**
 * Check a submission against the sprint's rules before the panel does.
 *
 * Built for this project and then generalised, because the rules are the same
 * for everyone and nothing else checks them. Of the projects listed for this
 * sprint, most name transaction hashes; some of those hashes emit no pool event
 * at all, which means they will not score and nobody has told the teams. That is
 * a bad way to find out on the last day.
 */

interface Verdict {
  exists: boolean
  succeeded: boolean
  touchedPool: boolean
  throughOurs: boolean | null
  qualifies: boolean
  summary: string
}

interface Row {
  hash: string
  verdict: Verdict | null
  error: string | null
}

/**
 * Each hash is one node call on a shared key. The sprint asks for three; twenty
 * is room to check a whole manifest twice over. Without a cap this page reads
 * whatever it is handed, and what a public text box gets handed is a phone book.
 */
const MAX_HASHES = 20

const RULES = [
  ['exists', 'The transaction is on chain.'],
  ['succeeded', 'It did not revert.'],
  ['touchedPool', 'It emitted an event from the STRK20 pool.'],
  ['throughOurs', 'It ran through one of the project’s own contracts.'],
] as const

export default function Verify() {
  const [hashes, setHashes] = useState('')
  const [contracts, setContracts] = useState('')
  const [rows, setRows] = useState<Row[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [tooMany, setTooMany] = useState<number | null>(null)

  async function check() {
    const list = hashes
      .split(/[\s,]+/)
      .map((entry) => entry.trim())
      .filter(Boolean)

    if (list.length === 0) return
    if (list.length > MAX_HASHES) {
      setRows(null)
      setTooMany(list.length)
      return
    }
    setTooMany(null)
    setBusy(true)

    // Sequential rather than parallel: this reads a public node, and a burst of
    // twenty is how a shared endpoint starts refusing everyone.
    const results: Row[] = []
    for (const hash of list) {
      const query = new URLSearchParams({ hash, contracts: contracts.trim() })
      try {
        const response = await fetch(`/api/tx?${query}`)
        const body = await response.json()
        results.push(
          response.ok
            ? { hash, verdict: body as Verdict, error: null }
            : { hash, verdict: null, error: String(body.error) },
        )
      } catch (error) {
        results.push({ hash, verdict: null, error: String(error) })
      }
      setRows([...results])
    }

    setBusy(false)
  }

  const counted = rows?.filter((row) => row.verdict?.qualifies).length ?? 0

  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-10">
      <header className="border-b border-thread pb-6">
        <div className="flex items-baseline justify-between">
          <a href="/" className="font-display text-lg font-extrabold tracking-tight hover:text-gold">
            jalin
          </a>
          <nav className="flex gap-5 font-mono text-xs text-muted">
            <a href="/compose" className="hover:text-gold">
              composer
            </a>
            <a href="/governance" className="hover:text-gold">
              governance
            </a>
          </nav>
        </div>
        <h1 className="mt-6 font-display text-3xl font-semibold tracking-tight">
          Will these transactions count?
        </h1>
        <p className="mt-2 text-sm text-muted">
          The sprint scores a transaction if it exists, succeeded, touched the STRK20 pool, and —
          when the project deployed contracts — ran through one of them. Every one of those is
          readable from the chain, so there is no reason to find out on the last day. This works for
          any project’s hashes, not only ours.
        </p>
      </header>

      <div className="mt-6 space-y-4">
        <label className="block">
          <span className="font-mono text-xs text-muted">transaction hashes</span>
          <textarea
            value={hashes}
            onChange={(event) => setHashes(event.target.value)}
            rows={4}
            placeholder="0x… one per line, or comma separated"
            className="mt-1 w-full rounded border border-strand bg-raised px-3 py-2 font-mono text-xs"
          />
        </label>

        <label className="block">
          <span className="font-mono text-xs text-muted">
            your deployed contracts — leave empty if you deployed none
          </span>
          <input
            value={contracts}
            onChange={(event) => setContracts(event.target.value)}
            placeholder="0x…, 0x…"
            className="mt-1 w-full rounded border border-strand bg-raised px-3 py-2 font-mono text-xs"
          />
        </label>

        <button
          onClick={check}
          disabled={busy || hashes.trim() === ''}
          className="rounded-sm px-4 py-2 text-sm font-medium transition-colors enabled:bg-gold enabled:text-ground enabled:hover:opacity-90 disabled:cursor-not-allowed disabled:border disabled:border-strand disabled:text-muted"
        >
          {busy ? 'reading the chain…' : 'Check'}
        </button>
      </div>

      {tooMany !== null && (
        <p className="mt-4 rounded border border-warn/40 bg-warn/10 px-3 py-2 text-xs leading-relaxed text-warn">
          {tooMany} hashes at once, and this checks at most {MAX_HASHES}. Each one is a call to a
          Starknet node on a shared key. Check them in batches, or run{' '}
          <span className="font-mono">node scripts/verify-transactions.mjs</span> against your own
          node with no limit at all.
        </p>
      )}

      {rows && rows.length > 0 && (
        <section className="mt-8">
          <p className="font-mono text-sm">
            {counted} of {rows.length} would count
            {rows.length < 3 && counted === rows.length && (
              <span className="text-muted"> · the sprint asks for three</span>
            )}
          </p>

          <ul className="mt-4 space-y-4">
            {rows.map((row) => (
              <li key={row.hash} className="rounded border border-thread bg-raised p-4">
                <a
                  href={`https://voyager.online/tx/${row.hash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="block break-all font-mono text-xs text-gold underline underline-offset-2"
                >
                  {row.hash}
                </a>

                {row.error && <p className="mt-2 text-xs text-warn">{row.error}</p>}

                {row.verdict && (
                  <>
                    <p
                      className={`mt-2 text-sm ${row.verdict.qualifies ? 'text-hidden' : 'text-warn'}`}
                    >
                      {row.verdict.summary}
                    </p>
                    <ul className="mt-3 space-y-1">
                      {RULES.map(([key, text]) => {
                        const value = row.verdict![key]
                        return (
                          <li key={key} className="flex gap-2 font-mono text-xs">
                            <span
                              aria-hidden
                              className={
                                value === null
                                  ? 'text-muted'
                                  : value
                                    ? 'text-hidden'
                                    : 'text-warn'
                              }
                            >
                              {value === null ? '–' : value ? '✓' : '✗'}
                            </span>
                            <span className={value === null ? 'text-muted' : ''}>
                              {text}
                              {value === null && ' Not applicable — no contracts named.'}
                            </span>
                          </li>
                        )
                      })}
                    </ul>
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="mt-10 border-t border-thread pt-4 font-mono text-xs text-muted">
        Read-only. The same check runs offline over a manifest —{' '}
        <span className="text-cloth">node scripts/verify-transactions.mjs strk20.json</span> — and
        the rule itself lives in the SDK, so this page and that script cannot disagree.
      </p>
    </main>
  )
}
