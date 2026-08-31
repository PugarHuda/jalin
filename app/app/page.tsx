import Link from 'next/link'
import { GOVERNOR_ADDRESS, REPO, ROUTER_ADDRESS } from '@/lib/config'
import { manifest } from '@/lib/manifest'
import { readChainState } from '@/lib/chain'
import { SiteNav } from './wordmark'


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
  size = 12,
}: {
  x: number
  y: number
  delay: number
  anchor?: 'end'
  text: string
  fill: string
  size?: number
}) {
  return (
    <text
      x={x}
      y={y}
      className="lift"
      style={{ ['--delay' as string]: `${delay}ms` }}
      fill={fill}
      fontSize={size}
      fontFamily="var(--font-drill)"
      textAnchor={anchor}
    >
      {text}
    </text>
  )
}


/**
 * The anonymity set over the pool's life.
 *
 * One median says the pool is thin; it cannot say whether that is improving,
 * and a single number that reads 1.00 forever looks like a broken gauge rather
 * than a finding. Two lines: what a typical deposit got in each six-hour slot,
 * and the best any single deposit managed.
 *
 * Drawn as SVG rather than with a charting library. This is a server component,
 * so a library would be client JavaScript shipped to draw twenty points.
 */
function Trend({
  periods,
  labelSize = 10,
}: {
  periods: { fromBlock: number; medianEffectiveSet: number; bestEffectiveSet: number }[]
  labelSize?: number
}) {
  if (periods.length < 3) return null

  const width = 720
  const height = 132
  const pad = { top: 12, right: 8, bottom: 20, left: 28 }
  const ceiling = Math.max(2, ...periods.map((period) => period.bestEffectiveSet))

  /**
   * Positioned by block, not by index.
   *
   * Slots with no deposits are absent from the series - a day nobody shielded
   * is not a day the anonymity set was zero. Spacing the points evenly then
   * draws those quiet stretches as if no time passed, which is the one thing a
   * chart about a trend over time must not do. Today's data has two such gaps
   * in forty-four points.
   */
  const first = periods[0]!.fromBlock
  const span = Math.max(1, periods.at(-1)!.fromBlock - first)
  const x = (fromBlock: number) =>
    pad.left + ((fromBlock - first) / span) * (width - pad.left - pad.right)
  // 1 is the floor, not 0: a deposit alone in its cell is a crowd of one, and
  // there is no such thing as a crowd of zero.
  const y = (value: number) =>
    height - pad.bottom - ((value - 1) / (ceiling - 1)) * (height - pad.top - pad.bottom)

  const path = (pick: (period: (typeof periods)[number]) => number) =>
    periods
      .map(
        (period, index) =>
          `${index === 0 ? 'M' : 'L'} ${x(period.fromBlock).toFixed(1)} ${y(pick(period)).toFixed(1)}`,
      )
      .join(' ')

  return (
    <figure className="mt-5">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full"
        role="img"
        aria-label={`Effective anonymity set across ${periods.length} six-hour windows. The typical deposit ends at ${periods.at(-1)!.medianEffectiveSet.toFixed(2)}; the best single deposit in the last window reached ${periods.at(-1)!.bestEffectiveSet.toFixed(2)}.`}
      >
        <line
          x1={pad.left}
          x2={width - pad.right}
          y1={y(1)}
          y2={y(1)}
          stroke="var(--thread)"
          strokeWidth="1"
        />
        <text x={0} y={y(1) + 4} fontSize={labelSize} fill="var(--muted)" fontFamily="var(--font-drill)">
          1.00
        </text>
        <text
          x={0}
          y={y(ceiling) + 4}
          fontSize={labelSize}
          fill="var(--muted)"
          fontFamily="var(--font-drill)"
        >
          {ceiling.toFixed(1)}
        </text>

        <path d={path((period) => period.bestEffectiveSet)} fill="none" stroke="var(--hidden)" strokeWidth="1.5" strokeDasharray="3 3" />
        <path d={path((period) => period.medianEffectiveSet)} fill="none" stroke="var(--warn)" strokeWidth="2" />

        <text
          x={pad.left}
          y={height - 4}
          fontSize={labelSize}
          fill="var(--muted)"
          fontFamily="var(--font-drill)"
        >
          block {periods[0]!.fromBlock.toLocaleString()}
        </text>
        <text
          x={width - pad.right}
          y={height - 4}
          textAnchor="end"
          fontSize={labelSize}
          fill="var(--muted)"
          fontFamily="var(--font-drill)"
        >
          now
        </text>
      </svg>

      <figcaption className="mt-2 max-w-[62ch] font-mono text-xs text-muted">
        <span className="text-warn">solid</span> the typical deposit ·{' '}
        <span className="text-hidden">dashed</span> the best one · each point is a six-hour window
      </figcaption>
    </figure>
  )
}
/**
 * `labelSize` is in user units, so it is divided by however far the viewBox is
 * scaled down. At 390px this diagram renders into a 332px box, a scale of 0.46,
 * and the 12 that reads correctly on a desktop lands at 5.5 CSS px there - the
 * one product-specific thing on the page reduced to an unlabelled smudge. The
 * phone gets the same drawing lettered for the size it is actually shown at.
 */
function Weave({ labelSize = 12 }: { labelSize?: number } = {}) {
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
          size={labelSize}
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
      <Label x={352} y={100} delay={760} text="privacy_invoke" fill="var(--gold)" size={labelSize} />

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
            size={labelSize}
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
      <div className="flex items-baseline justify-between gap-4 font-mono text-xs uppercase tracking-[0.15em] text-gold">
        <span>{label}</span>
        <span className="tracking-normal text-muted normal-case group-hover:text-gold">voyager ↗</span>
      </div>
      <div className="mt-1 break-all font-mono text-sm text-cloth group-hover:text-gold sm:text-base">
        {value}
      </div>
    </a>
  )
}

/**
 * The three hashes the sprint is actually scored against.
 *
 * They lived in `strk20.json` and on `/verify`, which meant the page making the
 * case for them never showed one, and the closest thing to proof on this page
 * was a bare `3` two and a half thousand pixels down, next to `1 governance
 * proposal` at the same type weight. A panel with ninety seconds does not find
 * that, and this audience does not accept an unhashed claim.
 *
 * The gold square is a pad: in this world gold is the place contact is made, so
 * it marks value that landed and nothing else. The hashes themselves stay cloth,
 * because the one gold control in this viewport is the button above.
 */
function Qualifying() {
  if (!manifest) {
    return (
      <p className="mt-8 max-w-[62ch] border-t border-thread pt-4 font-mono text-xs text-warn">
        strk20.json could not be read when this page was built, so the qualifying transactions
        are not listed here. They are in the repository and on{' '}
        <Link className="underline underline-offset-2" href="/verify">
          verify
        </Link>
        .
      </p>
    )
  }

  return (
    <section className="mt-8 max-w-[62ch] border-t border-thread pt-4">
      <h2 className="font-mono text-xs uppercase tracking-[0.15em] text-muted">
        Qualifying transactions on mainnet
      </h2>
      <ol className="mt-2 space-y-1">
        {manifest.transactions.map((hash, i) => (
          <li key={hash} className="flex items-baseline gap-3">
            <span className="font-mono text-xs text-muted">T{i + 1}</span>
            <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 bg-gold" />
            <a
              href={`https://voyager.online/tx/${hash}`}
              target="_blank"
              rel="noreferrer"
              className="min-w-0 break-all font-mono text-xs text-cloth underline decoration-thread underline-offset-2 hover:decoration-gold"
            >
              {hash}
            </a>
          </li>
        ))}
      </ol>
      <p className="mt-3 font-mono text-xs text-muted">
        Each succeeded, touched the pool, and ran through a contract of ours —{' '}
        <Link className="text-cloth underline underline-offset-2 hover:text-gold" href="/verify">
          check them against the sprint&apos;s own rules
        </Link>
        .
      </p>
    </section>
  )
}

/**
 * Stated rather than inherited. Without it the route's cache life came from
 * whichever fetch happened to be shortest, and one uncacheable call was enough
 * to prerender this page with no chain state on it at all.
 *
 * It is also why there is no loading.tsx. A loading boundary renders when a
 * segment suspends on a reader's request; with ISR the reader gets generated
 * HTML at once and revalidation happens behind them, so the boundary never
 * renders. One was written, measured against a deliberately delayed
 * navigation, and deleted.
 */
export const revalidate = 60

export default async function Landing() {
  const chain = await readChainState()

  return (
    <main>
      <header className="mx-auto w-full max-w-5xl px-6 py-6">
        <SiteNav current="home" repo={REPO} />
      </header>

      <section className="mx-auto w-full max-w-5xl px-6 pb-20 pt-10">
        {/*
          No kicker above the heading. The tracked-caps eyebrow is the one
          element the craft floor bans outright: the heading carries its own
          weight, and "live on mainnet" is a fact that belongs beside the
          action it licenses, not as a label over the sentence.
        */}
        <h1
          className="lift max-w-3xl font-display text-4xl leading-[1.05] font-extrabold tracking-tight sm:text-6xl"
          style={{ ['--delay' as string]: '0ms' }}
        >
          One invoke per transaction.
          <br />
          So weave the plan inside it.
        </h1>
        <p
          className="lift mt-6 max-w-[60ch] text-lg leading-relaxed text-cloth"
          style={{ ['--delay' as string]: '160ms' }}
        >
          The STRK20 pool allows a single external call per private transaction. That makes a
          private DeFi action only as expressive as the one helper contract it reaches. Jalin
          takes a plan instead — any number of steps, any contract, any calldata — and runs it
          inside that single invoke.
        </p>

        {/*
          The action comes before the diagram now. It used to sit under it, which
          put the top edge of the only button on this page at y=770 on a 1280x800
          screen and entirely below the fold on a 1366x768 laptop - the moment of
          highest intent given the weakest affordance. The weave is the argument
          and it survives being read second.
        */}
        <div
          className="lift mt-8 flex flex-wrap items-center gap-x-4 gap-y-2"
          style={{ ['--delay' as string]: '320ms' }}
        >
          <Link
            href="/compose"
            className="rounded-sm bg-gold px-5 py-3 font-medium text-ground hover:opacity-90"
          >
            Open the composer
          </Link>
          <span className="font-mono text-xs text-cloth">
            Live on Starknet mainnet
            {manifest && ` · ${manifest.transactions.length} qualifying transactions`}
          </span>
        </div>

        <Qualifying />

        <div className="mt-12">
          <div className="hidden sm:block">
            <Weave />
          </div>
          <div className="sm:hidden">
            <Weave labelSize={24} />
          </div>
        </div>
      </section>

      <section className="border-t border-thread bg-raised/40">
        <div className="mx-auto grid w-full max-w-5xl gap-10 px-6 py-16 md:grid-cols-2">
          <div>
            <h2 className="font-display text-2xl font-semibold">The constraint</h2>
            <p className="mt-4 max-w-[60ch] leading-relaxed text-muted">
              Two protocol rules shape everything downstream. Together they mean a private swap
              needs a swap helper, lending needs another, and swap-then-lend needs a third. Every
              new interaction is a new Cairo contract — which is why almost everything built on
              STRK20 so far is a payment app. Payments are the only thing you can ship without
              writing Cairo.
            </p>
          </div>
          <div className="space-y-4">
            <blockquote className="max-w-[60ch] border-l-2 border-gold pl-4 font-mono text-sm leading-relaxed">
              One <span className="text-gold">invoke</span> per transaction. At most one external
              call per pool transaction.
            </blockquote>
            <blockquote className="max-w-[60ch] border-l-2 border-gold pl-4 font-mono text-sm leading-relaxed">
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
        <p className="mt-6 max-w-[60ch] leading-relaxed text-muted">
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
          <p className="mt-4 max-w-[60ch] leading-relaxed text-muted">
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
                <span className="font-mono text-xs text-muted">I{i + 1}</span>
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
            <p className="max-w-[60ch] leading-relaxed text-muted">
              Private swaps are already live on AVNU through its own anonymizer, and Ekubo is
              next. For a single swap, use those — they are purpose-built and they will price
              better than a generic router calling the same pool.
            </p>
            <p className="max-w-[60ch] leading-relaxed text-muted">
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

          {/*
            Rendered whether or not the chain answered. This block used to be
            gated on `reachable`, so an RPC hiccup deleted three counters, the
            anonymity passage and the chart, and left a page that still looked
            finished with nothing on it to check. A reader cannot tell a product
            with no evidence from a read that failed, so the slot stays and says
            which one this is.
          */}
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
              <div>
                <div className="font-display text-3xl font-semibold tabular-nums">
                  {chain.depositors === null
                    ? '—'
                    : chain.depositorsAreAFloor
                      ? `${chain.depositors}+`
                      : chain.depositors}
                </div>
                <div className="mt-1 font-mono text-xs text-muted">
                  addresses have shielded into the pool
                </div>
              </div>
            </div>

          {!chain.reachable && (
            <p className="max-w-[62ch] border-t border-thread py-4 font-mono text-xs text-warn">
              These reads failed when this page was served. Every figure here is a live contract
              call, so nothing is cached in their place — reload and they come back.
            </p>
          )}

          {chain.medianEffectiveSet === null && (
            <p className="max-w-[62ch] border-t border-thread py-4 font-mono text-xs text-warn">
              The pool&apos;s anonymity figures could not be read when this page was served. They
              are the least flattering numbers here and they are not being withheld — the scan
              over the pool&apos;s deposit events failed, and it is a live read on every load.
            </p>
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
              <p className="mt-3 max-w-[62ch] text-sm leading-relaxed text-muted">
                That first number is the pool&apos;s headcount, and it is not what hides you. An
                observer of the public deposit leg sees the asset, the order of magnitude and
                roughly when — so two deposits only cover each other if they agree on all three.
                Grouped that way,{' '}
                {chain.aloneShare === null ? '—' : `${Math.round(chain.aloneShare * 100)}%`} of the
                resulting cells hold exactly one person, and the biggest crowd anywhere in the pool
                is {chain.largestEffectiveSet?.toFixed(1) ?? '—'}. The figure is a perplexity rather
                than a headcount, because a cell where one address carries most of the volume is
                not the crowd its headcount claims.
              </p>
              <p className="mt-3 max-w-[62ch] text-sm leading-relaxed text-muted">
                Jalin does not fix that — nothing a helper contract does can conjure other people.
                What it changes is how many transactions you need: three public legs at three
                separate moments is three chances to be the only one there, and a plan is one.
                The composer tells you the size of the cell you are about to land in, before you
                sign.
              </p>

              <div className="hidden sm:block">
                <Trend periods={chain.periods} />
              </div>
              <div className="sm:hidden">
                <Trend periods={chain.periods} labelSize={20} />
              </div>
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

      {/*
        The page used to end on 1.00 in red, a chart hugging the floor and the
        word "unaudited", with no interactive element after it but a GitHub
        link. Peak-end weights the close almost as heavily as the peak, and the
        honest bad news is the right thing to end the argument on - not the
        right thing to end the page on.
      */}
      <section className="border-t border-thread">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-4 gap-y-3 px-6 py-10">
          <Link
            href="/compose"
            className="rounded-sm bg-gold px-5 py-3 font-medium text-ground hover:opacity-90"
          >
            Open the composer
          </Link>
          <span className="font-mono text-xs text-muted">
            The composer names the size of the cell you would land in, before you sign
            {manifest && (
              <>
                {' · '}
                <Link className="text-cloth underline underline-offset-2 hover:text-gold" href="/verify">
                  check the {manifest.transactions.length} qualifying transactions
                </Link>
              </>
            )}
          </span>
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
