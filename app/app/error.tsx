'use client'
import Link from 'next/link'

import { useEffect } from 'react'

/**
 * The boundary that catches what a page throws.
 *
 * Without it a render-time throw shows Next's own error screen, which is what
 * happened the day the actions tab was handed a recipient that was not a felt:
 * a blank page with no way back. This says what broke and leaves the way out.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // The digest is what ties this to a server log line. Printing it is the
    // difference between a bug report and "it broke".
    console.error('[jalin]', error.digest ?? '(no digest)', error)
  }, [error])

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col px-5 py-24">
      <p className="font-mono text-xs text-warn">error</p>
      <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight">
        This page stopped part way through.
      </h1>
      <p className="mt-3 text-sm text-muted">
        Nothing was signed and nothing was sent — this is a rendering failure, not a transaction.
      </p>

      <p className="mt-4 rounded border border-thread bg-raised px-3 py-2 font-mono text-xs break-all">
        {error.message || 'no message'}
        {error.digest && <span className="text-muted"> · {error.digest}</span>}
      </p>

      <div className="mt-6 flex flex-wrap gap-3">
        <button
          onClick={reset}
          className="rounded-sm bg-gold px-4 py-2 text-sm font-medium text-ground hover:opacity-90"
        >
          Try again
        </button>
        <Link
          href="/"
          className="rounded border border-strand px-4 py-2 text-sm hover:border-gold"
        >
          Back to the start
        </Link>
      </div>
    </main>
  )
}
