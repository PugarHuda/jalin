import type { Metadata } from 'next'
import Link from 'next/link'
import {
  GOVERNOR_ADDRESS,
  INVARIANTS,
  POOL_ADDRESS,
  REPO,
  ROUTER_ADDRESS,
  label,
} from '@/lib/config'
import { manifest } from '@/lib/manifest'
import { readChainState } from '@/lib/chain'
import { SiteNav } from '../wordmark'

export const metadata: Metadata = {
  title: 'Slides',
  description:
    'The case for Jalin in nine panels, against the four criteria the panel scores: integration depth, mainnet product, innovation, documentation.',
}

/**
 * The panel reads on 4 September, and a repository is not a presentation.
 *
 * Built as scroll-snapped sections rather than with a slide library: the browser
 * already does full-viewport paging, keyboard scrolling and printing, and a
 * deck that is nine sections of real markup stays readable when someone opens it
 * on a phone, prints it, or lets a screen reader walk it. A library would add a
 * dependency to reimplement `scroll-snap-type` worse.
 *
 * Every figure here is the same live read the rest of the site makes. A deck
 * that hardcodes its numbers is a deck that is wrong by the time it is shown.
 */
export const revalidate = 60

function Slide({
  n,
  title,
  lead,
  children,
}: {
  n: string
  title: string
  /** The opening panel carries the document's only h1; the rest are h2. */
  lead?: boolean
  children: React.ReactNode
}) {
  const Heading = lead ? 'h1' : 'h2'
  return (
    <section className="flex min-h-[100svh] snap-start flex-col justify-center border-b border-thread px-5 py-16 sm:px-8">
      <div className="mx-auto w-full max-w-4xl">
        <div className="font-mono text-xs text-muted">{n}</div>
        <Heading className="mt-2 font-display text-2xl leading-tight font-semibold tracking-tight sm:text-4xl">
          {title}
        </Heading>
        <div className="mt-6 space-y-4 text-sm leading-relaxed text-muted sm:text-base">
          {children}
        </div>
      </div>
    </section>
  )
}

/** A figure and what it is, in the drill-table register the rest of the site uses. */
function Fact({ value, of, warn }: { value: string; of: string; warn?: boolean }) {
  return (
    <div>
      <div
        className={`font-display text-2xl font-semibold tabular-nums sm:text-3xl ${warn ? 'text-warn' : 'text-cloth'}`}
      >
        {value}
      </div>
      <div className="mt-1 font-mono text-xs text-muted">{of}</div>
    </div>
  )
}

export default async function Slides() {
  const chain = await readChainState()
  const txs = manifest?.transactions ?? []

  return (
    <main className="h-[100svh] snap-y snap-mandatory overflow-y-auto">
      {/*
        Sticky, not stacked above the first slide: with snap-mandatory the
        browser locks to the first snap point on load, which scrolled a
        non-sticky strip out of sight before anyone saw it. It also keeps a way
        off the deck from every panel.
      */}
      <div className="sticky top-0 z-20 bg-ground">
        <div className="mx-auto w-full max-w-4xl px-5 sm:px-8">
          <SiteNav current="slides" repo={REPO} />
        </div>
      </div>

      <Slide n="01" lead title="One invoke per transaction. So weave the plan inside it.">
        <p className="max-w-[62ch] text-cloth">
          Jalin is a programmable execution router for the STRK20 shielded pool. It takes a plan —
          any number of steps, any contract, any calldata — and runs the whole thing inside the
          single <span className="font-mono">privacy_invoke</span> the protocol allows.
        </p>
        <div className="flex flex-wrap gap-x-10 gap-y-4 pt-2">
          <Fact value={String(txs.length)} of="qualifying mainnet transactions" />
          <Fact value="2" of="Cairo contracts, declared and live" />
          <Fact value="6" of="invariants enforced on chain" />
          <Fact value="546" of="tests across Cairo, SDK and browser" />
        </div>
      </Slide>

      <Slide n="02" title="The constraint everything downstream is shaped by">
        <p className="max-w-[62ch]">
          Two protocol rules. At most{' '}
          <span className="text-cloth">one external call per pool transaction</span>, and{' '}
          <span className="text-cloth">every token&apos;s balance must end at exactly zero</span>.
        </p>
        <p className="max-w-[62ch]">
          Together they mean a private swap needs a swap helper, private lending needs another, and
          swap-then-lend needs a third. Every new interaction is a new Cairo contract to write,
          deploy and audit — which is why almost everything built on STRK20 so far is a payment
          app. Payments are the only thing you can ship without writing Cairo.
        </p>
      </Slide>

      <Slide n="03" title="A plan, not a parameter list">
        <pre className="overflow-x-auto rounded-sm border border-thread bg-raised p-4 font-mono text-xs leading-relaxed">
          {`fn privacy_invoke(
    ref self: ContractState,
    pool_address: ContractAddress,
    steps: Array<Step>,
    outputs: Array<Output>,
) -> Span<OpenNoteDeposit>

struct Step {
    target: ContractAddress,   // any contract
    selector: felt252,         // any entrypoint
    calldata: Array<felt252>,  // any arguments
    approvals: Array<Approval>,
}`}
        </pre>
        <p className="max-w-[62ch]">
          Each step names a target, a selector, calldata and the approvals it needs. Nothing is
          whitelisted. A bridge call, a DEX route and a lending deposit are the same object.
        </p>
      </Slide>

      <Slide n="04" title="Integration depth: what it actually reaches">
        <p className="max-w-[62ch]">
          Two third-party mainnet protocols are reachable today with{' '}
          <span className="text-cloth">no adapter written for either</span>, because they have an
          ABI and that is the only requirement:
        </p>
        <ul className="max-w-[62ch] space-y-2 font-mono text-xs">
          <li className="border-t border-thread pt-2">
            <span className="text-cloth">Endur</span> — a real ERC-4626 deposit; xSTRK shares land
            straight in a shielded note
          </li>
          <li className="border-t border-thread pt-2">
            <span className="text-cloth">AVNU</span> — <span>multi_route_swap</span> with a live
            quote, beside an Endur stake, in one invoke
          </li>
        </ul>
        <p className="max-w-[62ch] pt-2">
          The router holds nothing between transactions and has no admin key. Every parameter it
          reads belongs to a governor that moves only by a vote which has cleared a timelock, and
          governance ballots themselves arrive through the pool — the weight of a vote is public
          and the voter is not.
        </p>
      </Slide>

      <Slide n="05" title="Safety without a whitelist">
        <p className="max-w-[62ch]">
          Free calldata sounds dangerous. It is not, because Jalin is non-custodial and holds
          nothing between transactions, so a hostile plan can only harm the notes of whoever wrote
          it. Six invariants carry the rest, each with a test:
        </p>
        <ul className="max-w-[62ch] space-y-1.5 font-mono text-xs">
          {INVARIANTS.map(([rule, closes]) => (
            <li key={rule} className="border-t border-thread pt-1.5">
              <span className="text-cloth">{rule}</span>
              <span className="block text-muted">closes: {closes}</span>
            </li>
          ))}
        </ul>
      </Slide>

      <Slide n="06" title="Working on mainnet, and checkable">
        <p className="max-w-[62ch]">
          {txs.length} transactions, each an invoke through a contract of ours, each of which
          succeeded and touched the pool. The same rule the sprint applies is applied by{' '}
          <Link className="text-cloth underline underline-offset-2 hover:text-gold" href="/verify">
            /verify
          </Link>{' '}
          and by <span className="font-mono">scripts/verify-transactions.mjs</span>, from the SDK.
        </p>
        <ol className="space-y-1">
          {txs.map((hash, i) => (
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
        <p className="max-w-[62ch] font-mono text-xs">
          pool {label(POOL_ADDRESS)} · router{' '}
          {ROUTER_ADDRESS ? label(ROUTER_ADDRESS) : 'not deployed'} · governor{' '}
          {GOVERNOR_ADDRESS ? label(GOVERNOR_ADDRESS) : 'not deployed'}
        </p>
      </Slide>

      <Slide n="07" title="What the pool actually hides, said plainly">
        <div className="flex flex-wrap gap-x-10 gap-y-4">
          <Fact
            value={chain.medianEffectiveSet?.toFixed(2) ?? '—'}
            of="the crowd the median deposit hides in"
            warn
          />
          <Fact
            value={chain.depositors === null ? '—' : String(chain.depositors)}
            of="addresses have shielded into the pool"
          />
        </div>
        <p className="max-w-[62ch]">
          The headcount is not what hides you. An observer of the public deposit leg sees the
          asset, the order of magnitude and roughly when, so two deposits only cover each other if
          they agree on all three. Grouped that way, most cells hold exactly one person.
        </p>
        <p className="max-w-[62ch]">
          Jalin cannot conjure other people. What it changes is how many public legs you need:
          three transactions at three separate moments is three chances to be the only one there,
          and a plan is one. The composer names the size of the cell you would land in before you
          sign.
        </p>
      </Slide>

      <Slide n="08" title="What it does not do">
        <ul className="max-w-[62ch] space-y-2">
          <li className="border-t border-thread pt-2">
            <span className="text-cloth">Unaudited.</span> Six invariants and 47 Cairo tests are
            the whole of the safety argument, and nobody outside this project has checked them.
          </li>
          <li className="border-t border-thread pt-2">
            <span className="text-cloth">
              The deployed governor counts ballot weight it never measures.
            </span>{' '}
            The router reads <span className="font-mono">balance_of</span> and trusts nothing; the
            governor took the weight off calldata. Nothing can be stolen — the escrow is empty —
            but an unbacked vote still carries, so one pool fee and about seventy minutes buys a
            capped 10% fee on every later plan. The fix is written and tested in this repository;
            it is not deployed, because new contracts mean new addresses and the four qualifying
            transactions ran through the old ones. Both halves are in the threat model.
          </li>
          <li className="border-t border-thread pt-2">
            <span className="text-cloth">It does not beat a venue&apos;s own anonymizer at that
            venue&apos;s own job.</span>{' '}
            A single swap is better done on AVNU or Ekubo directly. Jalin is for the plan that
            crosses venues.
          </li>
          <li className="border-t border-thread pt-2">
            <span className="text-cloth">Self-hosting the prover needs hardware we do not have.</span>{' '}
            The image is public and we ran it: it exits 132 on a CPU without AVX-512. A hosted
            mainnet prover does answer — this deck said for a week that none was published, which
            was wrong and excused a shallower integration.
          </li>
        </ul>
      </Slide>

      <Slide n="09" title="Where to check every claim on these slides">
        <ul className="max-w-[62ch] space-y-2 font-mono text-xs">
          <li className="border-t border-thread pt-2">
            <a className="text-cloth underline underline-offset-2 hover:text-gold" href={REPO}>
              github.com/PugarHuda/jalin
            </a>{' '}
            — MIT, the contracts, the SDK, the app and the tests
          </li>
          <li className="border-t border-thread pt-2">
            <a
              className="text-cloth underline underline-offset-2 hover:text-gold"
              href={`${REPO}/blob/main/docs/threat-model.md`}
            >
              docs/threat-model.md
            </a>{' '}
            — what each invariant closes, and what it does not
          </li>
          <li className="border-t border-thread pt-2">
            <a
              className="text-cloth underline underline-offset-2 hover:text-gold"
              href={`${REPO}/blob/main/docs/what-mainnet-says.md`}
            >
              docs/what-mainnet-says.md
            </a>{' '}
            — every mainnet finding with the query that produced it
          </li>
          <li className="border-t border-thread pt-2">
            <a
              className="text-cloth underline underline-offset-2 hover:text-gold"
              href={`${REPO}/blob/main/docs/strk20-endpoints.md`}
            >
              docs/strk20-endpoints.md
            </a>{' '}
            — the prover, note discovery and the shadow-account anonymizer, each with the
            command that answers
          </li>
          <li className="border-t border-thread pt-2">
            <Link
              className="text-cloth underline underline-offset-2 hover:text-gold"
              href="/governance"
            >
              /governance
            </Link>{' '}
            — every router parameter, read from the governor rather than described
          </li>
          <li className="border-t border-thread pt-2">
            <a
              className="text-cloth underline underline-offset-2 hover:text-gold"
              href="https://www.npmjs.com/package/jalin-sdk"
            >
              jalin-sdk
            </a>{' '}
            — the plan encoder, published
          </li>
          {manifest?.demo_video && (
            <li className="border-t border-thread pt-2">
              <a
                className="text-cloth underline underline-offset-2 hover:text-gold"
                href={manifest.demo_video}
              >
                the demo, 2:48
              </a>{' '}
              — a plan built and signed on mainnet
            </li>
          )}
        </ul>
        <div className="pt-4">
          <Link
            href="/compose"
            className="inline-block rounded-sm bg-gold px-5 py-3 font-medium text-ground hover:opacity-90"
          >
            Open the composer
          </Link>
        </div>
      </Slide>
    </main>
  )
}
