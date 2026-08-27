import Link from 'next/link'

/**
 * The mark: separate strands woven into one.
 *
 * Which is what the word means, and what the router does — a plan's steps enter
 * apart and leave as the single `privacy_invoke` the pool allows. The hero
 * diagram on the landing page draws the same figure at full size, fanning back
 * out into notes; at 16px only the fan-in survives legibly, so that is what the
 * glyph keeps.
 *
 * Everything is `currentColor` at two weights rather than a palette. It has to
 * read on the site's ground, in a browser tab, and on whatever a wallet or a
 * social card puts behind it, and a mark that needs its own background is a
 * mark that will eventually be shown without one.
 */
export function Mark({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      aria-hidden="true"
      stroke="currentColor"
      strokeLinecap="round"
    >
      <g strokeWidth="2" opacity="0.55">
        <path d="M3 7c9 0 9 9 16 9" />
        <path d="M3 16h16" />
        <path d="M3 25c9 0 9-9 16-9" />
      </g>
      <path d="M19 16h10" strokeWidth="3.5" />
    </svg>
  )
}

/**
 * The mark and the name, together, in the one place every page's header reaches
 * for.
 *
 * Four headers each carried their own copy of the same classes and the same
 * string. That is how the composer ended up the only page with a wallet filter
 * and the only page with a usable error message: a thing written four times is
 * a thing fixed once and wrong three times.
 */
export function Wordmark({ home = false }: { home?: boolean }) {
  const inner = (
    <>
      <Mark />
      <span className="font-display text-lg font-extrabold tracking-tight">jalin</span>
    </>
  )

  // The home page links to itself otherwise, which is a link that looks like it
  // goes somewhere and does not.
  return home ? (
    <span className="flex items-center gap-2">{inner}</span>
  ) : (
    <Link href="/" className="flex items-center gap-2 hover:text-gold">
      {inner}
    </Link>
  )
}
