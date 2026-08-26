import Link from 'next/link'

/**
 * Next ships a bare 404. This one is the same page as the rest of the site and
 * says where the four real pages are, because a dead end that names the exits
 * is not really a dead end.
 */
export default function NotFound() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col px-5 py-24">
      <p className="font-mono text-xs text-muted">404</p>
      <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight">
        No thread runs to this one.
      </h1>
      <p className="mt-3 text-sm text-muted">
        Nothing is served at that path. Everything Jalin does is on one of these four.
      </p>

      <ul className="mt-8 space-y-3 font-mono text-sm">
        <li>
          <Link className="text-gold underline underline-offset-2" href="/">
            /
          </Link>
          <span className="text-muted"> — what this is, and why one invoke is the constraint</span>
        </li>
        <li>
          <Link className="text-gold underline underline-offset-2" href="/compose">
            /compose
          </Link>
          <span className="text-muted"> — build a plan and see what it reveals</span>
        </li>
        <li>
          <Link className="text-gold underline underline-offset-2" href="/verify">
            /verify
          </Link>
          <span className="text-muted"> — check whether a transaction would count</span>
        </li>
        <li>
          <Link className="text-gold underline underline-offset-2" href="/governance">
            /governance
          </Link>
          <span className="text-muted"> — the parameters, and who owns them</span>
        </li>
      </ul>
    </main>
  )
}
