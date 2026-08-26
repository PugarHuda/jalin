import Link from 'next/link'
import { GOVERNOR_ADDRESS, ROUTER_ADDRESS } from '@/lib/config'
import { readChainState } from '@/lib/chain'

const REPO = 'https://github.com/PugarHuda/jalin'

/**
 * Four steps in, one invoke, notes out - which is both the protocol constraint
 * and what the name means.
 *
 * The strands cross before they converge, and the ones drawn last carry a
 * ground-coloured halo so they read as passing over. Without that they only
 * funnel, and a funnel is not a weave.
 */
/**
 * Hoisted out of the diagram rather than closed over inside it. A component
 * declared during render is a new component type on every render, so React
 * throws the subtree away and rebuilds it - which restarts the entrance
 * animation these labels exist to carry.
 */
function Label({
  x,
  y,
  delay,
  anchor,
  text,
  fill,
}: {
  x: number
  y: number
  delay: number
  anchor?: 'end'
  text: string
  fill: string
}) {
  return (
    <text
      x={x}
      y={y}
      className="lift"
      style={{ ['--delay' as string]: `${delay}ms` }}
      fill={fill}
      fontSize="12"
      fontFamily="var(--font-plex-mono)"
      textAnchor={anchor}
    >
      {text}
    </text>
  )
}

function Weave() {
  const under = [
    { d: 'M 0 40 C 62 40, 140 105, 236 105 C 300 105, 330 115, 352 115', label: 'approve', y: 40 },
    {
      d: 'M 0 140 C 62 140, 140 185, 236 185 C 300 185, 330 115, 352 115',
      label: 'deposit',
      y: 140,
    },
  ]
  const over = [
    { d: 'M 0 90 C 62 90, 140 45, 236 45 C 300 45, 330 115, 352 115', label: 'swap', y: 90 },
    {
      d: 'M 0 190 C 62 190, 140 135, 236 135 C 300 135, 330 115, 352 115',
      label: 'bridge',
      y: 190,
    },
  ]

  const Strand = ({
    d,
    delay,
    halo,
  }: {
    d: string
    delay: number
    halo?: boolean
  }) => (
    <>
      {halo && (
        <path
          className="thread-draw"
          style={{ ['--len' as string]: '560', ['--delay' as string]: `${delay}ms` }}
          d={d}
          fill="none"
          stroke="var(--ground)"
          strokeWidth="7"
        />
      )}
      <path
        className="thread-draw"
        style={{ ['--len' as string]: '560', ['--delay' as string]: `${delay}ms` }}
        d={d}
        fill="none"
        stroke="var(--strand)"
        strokeWidth="1.75"
      />
    </>
  )

  return (
    <svg
      viewBox="0 18 720 184"
      className="w-full"
      role="img"
      aria-label="Four steps interlace, converge into a single privacy_invoke, and emerge as shielded notes"
    >
      {under.map((s, i) => (
        <Strand key={s.label} d={s.d} delay={i * 120} />
      ))}
      {over.map((s, i) => (
        <Strand key={s.label} d={s.d} delay={60 + i * 120} halo />
      ))}

      {[...under, ...over].map((s, i) => (
        <Label
          key={s.label}
          x={4}
          y={s.y - 11}
          delay={i * 90 + 240}
          text={s.label}
          fill="var(--muted)"
        />
      ))}

      <path
        className="thread-draw"
        style={{ ['--len' as string]: '160', ['--delay' as string]: '560ms' }}
        d="M 352 115 L 468 115"
        fill="none"
        stroke="var(--gold)"
        strokeWidth="5"
        strokeLinecap="round"
      />
      <Label x={352} y={100} delay={760} text="privacy_invoke" fill="var(--gold)" />

      {[
        { d: 'M 468 115 C 570 115, 610 78, 716 78', y: 78 },
        { d: 'M 468 115 C 570 115, 610 152, 716 152', y: 152 },
      ].map((out, i) => (
        <g key={out.y}>
          <path
            className="thread-draw"
            style={{ ['--len' as string]: '320', ['--delay' as string]: `${760 + i * 110}ms` }}
            d={out.d}
            fill="none"
            stroke="var(--strand)"
            strokeWidth="1.75"
          />
          <Label
            x={716}
            y={out.y - 11}
            delay={960 + i * 110}
            anchor="end"
            text="note"
            fill="var(--muted)"
          />
        </g>
      ))}
    </svg>
  )
}

const INVARIANTS = [
  ['The pool is the only caller', 'Anyone calling the router directly'],
  ['No step may target the pool or the router', 'Reentrancy into the sandwich'],
  ['Every approval is reset after its step', 'A stale allowance draining the next user'],
  ['Zero residue: touched tokens end at zero', "Sweeping another user's leftovers"],
  ['Each output clears its floor', 'Slippage and hostile routes'],
  ['Steps and calldata are bounded', 'Griefing the proof budget'],
]

function Address({ label, value }: { label: string; value: string }) {
  if (!value) return null
  return (
    <a
      href={`https://voyager.online/contract/${value}`}
      target="_blank"
      rel="noreferrer"
      className="group block border-t border-thread py-4"
    >
      <div className="font-mono text-xs uppercase tracking-[0.15em] text-gold">{label}</div>
      <div className="mt-1 break-all font-mono text-sm text-cloth group-hover:text-gold sm:text-base">
        {value}
      </div>
    </a>
  )
}

/**
 * Stated rather than inherited. Without it the route's cache life came from
 * whichever fetch happened to be shortest, and one uncacheable call was enough
 * to prerender this page with no chain state on it at all.
 */
export const revalidate = 60

export default async function Landing() {
  const chain = await readChainState()

  return (
    <main>
      <header className="mx-auto flex w-full max-w-5xl items-baseline justify-between px-6 py-6">
        <span className="font-display text-lg font-extrabold tracking-tight">jalin</span>
        <nav className="flex gap-6 font-mono text-xs text-muted">
          <Link className="hover:text-gold" href="/compose">
            composer
          </Link>
          <Link className="hover:text-gold" href="/verify">
            verify
          </Link>
          <Link className="hover:text-gold" href="/governance">
            governance
          </Link>
          <a className="hover:text-gold" href={REPO} target="_blank" rel="noreferrer">
            source
          </a>
        </nav>
      </header>

      <section className="mx-auto w-full max-w-5xl px-6 pb-20 pt-10">
        <p
          className="lift font-mono text-xs uppercase tracking-[0.2em] text-gold"
          style={{ ['--delay' as string]: '0ms' }}
        >
          Live on Starknet mainnet
        </p>
        <h1
          className="lift mt-5 max-w-3xl font-display text-4xl leading-[1.05] font-extrabold tracking-tight sm:text-6xl"
          style={{ ['--delay' as string]: '80ms' }}
        >
          One invoke per transaction.
          <br />
          So weave the plan inside it.
        </h1>
        <p
          className="lift mt-6 max-w-2xl text-lg leading-relaxed text-muted"
          style={{ ['--delay' as string]: '160ms' }}
        >
          The STRK20 pool allows a single external call per private transaction. That makes a
          private DeFi action only as expressive as the one helper contract it reaches. Jalin
          takes a plan instead — any number of steps, any contract, any calldata — and runs it
          inside that single invoke.
        </p>

        <div className="mt-12">
          <Weave />
        </div>

        <div
          className="lift mt-6 flex flex-wrap items-center gap-4"
          style={{ ['--delay' as string]: '1000ms' }}
        >
          <Link
            href="/compose"
            className="rounded-sm bg-gold px-5 py-3 font-medium text-ground hover:opacity-90"
          >
            Open the composer
          </Link>
          <span className="font-mono text-xs text-muted">
            Build a plan, see what it reveals, sign it.
          </span>
        </div>
      </section>

      <section className="border-t border-thread bg-raised/40">
        <div className="mx-auto grid w-full max-w-5xl gap-10 px-6 py-16 md:grid-cols-2">
          <div>
            <h2 className="font-display text-2xl font-semibold">The constraint</h2>
            <p className="mt-4 leading-relaxed text-muted">
              Two protocol rules shape everything downstream. Together they mean a private swap
              needs a swap helper, lending needs another, and swap-then-lend needs a third. Every
              new interaction is a new Cairo contract — which is why almost everything built on
              STRK20 so far is a payment app. Payments are the only thing you can ship without
              writing Cairo.
            </p>
          </div>
          <div className="space-y-4">
            <blockquote className="border-l-2 border-gold pl-4 font-mono text-sm leading-relaxed">
              One <span className="text-gold">invoke</span> per transaction. At most one external
              call per pool transaction.
            </blockquote>
            <blockquote className="border-l-2 border-gold pl-4 font-mono text-sm leading-relaxed">
              Every token&apos;s balance must end at exactly{' '}
              <span className="text-gold">zero</span>. No value created or destroyed.
            </blockquote>
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-5xl px-6 py-16">
        <h2 className="font-display text-2xl font-semibold">A plan, not a parameter list</h2>
        <pre className="mt-6 overflow-x-auto rounded-sm border border-thread bg-raised p-5 font-mono text-xs leading-relaxed sm:text-sm">
          {`fn privacy_invoke(
    ref self: ContractState,
    pool_address: ContractAddress,
    steps: Array<Step>,
    outputs: Array<Output>,
) -> Span<OpenNoteDeposit>`}
        </pre>
        <p className="mt-6 max-w-2xl leading-relaxed text-muted">
          Each step names a target, a selector, calldata, and the approvals it needs. Nothing is
          whitelisted: any Starknet contract is a valid target and calldata is free-form, which is
          what makes a bridge call, a DEX route and a lending deposit the same object.
        </p>
      </section>

      <section className="border-t border-thread">
        <div className="mx-auto w-full max-w-5xl px-6 py-16">
          <h2 className="font-display text-2xl font-semibold">
            Why free calldata is safe here
          </h2>
          <p className="mt-4 max-w-2xl leading-relaxed text-muted">
            Jalin is non-custodial and holds nothing between transactions, so a hostile plan can
            only harm the notes of whoever wrote it. Safety comes from invariants enforced in
            Cairo, not from a gatekeeper&apos;s list. Each has a test.
          </p>
          <ul className="mt-8">
            {INVARIANTS.map(([rule, closes], i) => (
              <li
                key={rule}
                className="grid gap-1 border-t border-thread py-4 md:grid-cols-[3rem_1fr_1fr] md:gap-6"
              >
                <span className="font-mono text-xs text-gold">I{i + 1}</span>
                <span className="text-sm">{rule}</span>
                <span className="text-sm text-muted">closes: {closes}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="border-t border-thread bg-raised/40">
        <div className="mx-auto w-full max-w-5xl px-6 py-16">
          <h2 className="font-display text-2xl font-semibold">When not to use Jalin</h2>
          <div className="mt-4 grid gap-8 md:grid-cols-2">
            <p className="leading-relaxed text-muted">
              Private swaps are already live on AVNU through its own anonymizer, and Ekubo is
              next. For a single swap, use those — they are purpose-built and they will price
              better than a generic router calling the same pool.
            </p>
            <p className="leading-relaxed text-muted">
              One invoke per transaction means a venue&apos;s anonymizer and this router compete
              for the same slot rather than composing. That every venue has to write its own, and
              that none of them compose, is the argument for Jalin existing — not a reason to use
              it for one step.
            </p>
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-5xl px-6 py-16">
        <h2 className="font-display text-2xl font-semibold">Deployed</h2>
        <div className="mt-6">
          <Address label="JalinRouter" value={ROUTER_ADDRESS} />
          <Address label="JalinGovernor" value={GOVERNOR_ADDRESS} />

          {chain.reachable && (
            <div className="grid gap-6 border-t border-thread py-5 sm:grid-cols-3">
              <div>
                <div className="font-display text-3xl font-semibold tabular-nums">
                  {chain.plansExecuted ?? '—'}
                </div>
                <div className="mt-1 font-mono text-xs text-muted">
                  plans executed, read from the router
                </div>
              </div>
              <div>
                <div className="font-display text-3xl font-semibold tabular-nums">
                  {chain.proposalCount ?? '—'}
                </div>
                <div className="mt-1 font-mono text-xs text-muted">
                  governance proposals, read from the governor
                </div>
              </div>
              {chain.depositors !== null && (
                <div>
                  <div className="font-display text-3xl font-semibold tabular-nums">
                    {chain.depositorsAreAFloor ? `${chain.depositors}+` : chain.depositors}
                  </div>
                  <div className="mt-1 font-mono text-xs text-muted">
                    addresses have shielded into the pool
                  </div>
                </div>
              )}
            </div>
          )}

          {chain.medianEffectiveSet !== null && (
            <div className="border-t border-thread py-5">
              <div className="flex flex-wrap items-baseline gap-3">
                <span className="font-display text-3xl font-semibold tabular-nums text-warn">
                  {chain.medianEffectiveSet.toFixed(2)}
                </span>
                <span className="font-mono text-xs text-muted">
                  is the crowd the median deposit actually hides in
                </span>
              </div>
              <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted">
                That first number is the pool&apos;s headcount, and it is not what hides you. An
                observer of the public deposit leg sees the asset, the order of magnitude and
                roughly when — so two deposits only cover each other if they agree on all three.
                Grouped that way, {chain.aloneShare !== null && `${Math.round(chain.aloneShare * 100)}% of `}
                the resulting cells hold exactly one person, and the biggest crowd anywhere in the
                pool is {chain.largestEffectiveSet?.toFixed(1)}. The figure is a perplexity rather
                than a headcount, because a cell where one address carries most of the volume is
                not the crowd its headcount claims.
              </p>
              <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted">
                Jalin does not fix that — nothing a helper contract does can conjure other people.
                What it changes is how many transactions you need: three public legs at three
                separate moments is three chances to be the only one there, and a plan is one.
                The composer tells you the size of the cell you are about to land in, before you
                sign.
              </p>
            </div>
          )}

          <div className="border-t border-thread py-4 font-mono text-xs text-muted">
            Governance owns every router parameter and is an anonymizer helper itself: ballots
            arrive through privacy_invoke, so the weight of a vote is public and the voter is not.
            {chain.reachable
              ? ' Every figure above is a contract call or an event read made when this page was served, not a number typed into it.'
              : ''}
          </div>
        </div>
      </section>

      <footer className="border-t border-thread">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-4 px-6 py-8 font-mono text-xs text-muted">
          <span>
            <a className="text-gold hover:underline" href={REPO}>
              github.com/PugarHuda/jalin
            </a>{' '}
            · MIT · unaudited
          </span>
          <span>Built for the STRK20 Private Sprint</span>
        </div>
      </footer>
    </main>
  )
}
