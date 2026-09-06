'use client'

import { useEffect, useState } from 'react'

/**
 * The three STRK20 services, asked now rather than quoted from a document.
 *
 * `docs/strk20-endpoints.md` exists because six issues on the sprint's tracker
 * asked for a proving service that was already public, and the belief that it
 * did not exist excused leaving integrations unbuilt. That document is a
 * snapshot of one afternoon. This panel is the same claim, checked on every
 * load, on the page whose whole job is checking claims.
 *
 * The lag matters more than the tick beside it. Discovery reports how far
 * behind the chain it is, and a note created inside that window is on chain and
 * not yet findable by its recipient — which is what "the transfer landed and
 * they see nothing" actually is.
 *
 * Client-side rather than server-rendered, because a page that must not be held
 * open by somebody else's service should not have that service in its render
 * path. Three external hosts at eight seconds each is not a thing to put in
 * front of a verdict.
 */

interface Service {
  name: string
  url: string
  ok: boolean
  detail: string | null
}

interface Reading {
  prover: Service
  discovery: Service & { lagSeconds: number | null; chainHead: number | null }
  paymaster: Service & { gasTokens: string[] }
}

export function Services() {
  const [reading, setReading] = useState<Reading | null>(null)
  const [failed, setFailed] = useState<string | null>(null)

  useEffect(() => {
    const stop = new AbortController()
    fetch('/api/services', { signal: stop.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return response.json() as Promise<Reading>
      })
      .then(setReading)
      .catch((error: Error) => {
        // Only a real failure. An aborted fetch is this component unmounting.
        if (error.name !== 'AbortError') setFailed(error.message)
      })
    return () => stop.abort()
  }, [])

  return (
    <section className="mt-10 max-w-[62ch] border-t border-thread pt-4">
      <h2 className="font-display text-lg font-semibold">The services underneath</h2>
      <p className="mt-2 max-w-[62ch] font-mono text-xs text-muted">
        Six issues on the sprint tracker asked where the proving service was, and it had been
        answering the whole time. These are read on every load rather than quoted, so a claim that
        stops being true stops being made.
      </p>

      {failed && (
        <p className="mt-3 font-mono text-xs text-warn" role="alert">
          This check itself did not run: {failed}.
        </p>
      )}

      {!reading && !failed && (
        <p className="mt-3 font-mono text-xs text-muted">Asking all three…</p>
      )}

      {reading && (
        <ul className="mt-3 space-y-2 font-mono text-xs" data-testid="services">
          {[reading.prover, reading.discovery, reading.paymaster].map((service) => (
            <li key={service.name} className="flex gap-2">
              <span className={service.ok ? 'text-hidden' : 'text-warn'}>
                {service.ok ? '✓' : '✗'}
              </span>
              <span>
                <span className="text-cloth">{service.name}</span>
                {service.detail && <span className="text-warn"> — {service.detail}</span>}
                {service === reading.discovery && reading.discovery.lagSeconds !== null && (
                  <span className="text-muted">
                    {' '}
                    — {reading.discovery.lagSeconds}s behind the chain
                    {reading.discovery.chainHead !== null &&
                      ` at block ${reading.discovery.chainHead.toLocaleString()}`}
                    . A note newer than that is on chain and not yet discoverable.
                  </span>
                )}
                {service === reading.paymaster && reading.paymaster.gasTokens.length > 0 && (
                  <span className="text-muted">
                    {' '}
                    — takes gas in {reading.paymaster.gasTokens.join(', ')} among others, with no
                    API key.
                  </span>
                )}
                <span className="block break-all text-muted">{service.url}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
