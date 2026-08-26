import Link from 'next/link'
import { readGovernance, type Proposal, type Stage } from '@/lib/governance'
import { GOVERNOR_ADDRESS, ROUTER_ADDRESS, label } from '@/lib/config'
import { Execute } from './execute'
import { Propose } from './propose'

/**
 * The governor, visible at last.
 *
 * Every router parameter is owned by a vote rather than by an admin key, and
 * that is only worth claiming if somebody can check it. Until this page nobody
 * could: the contract was deployed, governing, and had no interface at all.
 */
export const revalidate = 60

const KIND_TEXT: Record<string, string> = {
  pause: 'Stop every plan, or start them again',
  limits: 'Move the step and calldata bounds',
  fee: 'Set the fee, capped at 10% in the contract itself',
  deny: 'Break the circuit on one target, or restore it',
  label: 'Say what a contract is, without deciding whether you may call it',
}

function StageBadge({ stage }: { stage: Stage }) {
  const colour =
    stage.name === 'executed'
      ? 'text-hidden'
      : stage.name === 'rejected'
        ? 'text-warn'
        : stage.name === 'voting'
          ? 'text-gold'
          : 'text-muted'

  const text =
    stage.name === 'voting'
      ? `voting · ${stage.blocksLeft.toLocaleString()} blocks left`
      : stage.name === 'timelocked'
        ? `timelocked · ${stage.blocksLeft.toLocaleString()} blocks left`
        : stage.name === 'rejected'
          ? `rejected · ${stage.because}`
          : stage.name

  return <span className={`font-mono text-xs ${colour}`}>{text}</span>
}

function ProposalCard({ proposal, governor }: { proposal: Proposal; governor: string }) {
  const total = proposal.yes + proposal.no
  const forShare = total === 0n ? 0 : Number((proposal.yes * 1000n) / total) / 10

  return (
    <li className="border-t border-thread py-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <span className="font-mono text-sm">
          #{proposal.id} · {proposal.kind}
        </span>
        <StageBadge stage={proposal.stage} />
      </div>

      <p className="mt-1 text-sm text-muted">{KIND_TEXT[proposal.kind]}</p>

      <dl className="mt-3 grid gap-x-6 gap-y-1 font-mono text-xs sm:grid-cols-[auto_1fr]">
        <dt className="text-muted">target</dt>
        <dd className="break-all">{label(proposal.target)}</dd>
        {proposal.label && (
          <>
            <dt className="text-muted">label</dt>
            <dd>{proposal.label}</dd>
          </>
        )}
        <dt className="text-muted">for / against</dt>
        <dd>
          {proposal.yes.toString()} / {proposal.no.toString()}
          {total > 0n && ` · ${forShare}% for`}
        </dd>
        <dt className="text-muted">voting closed</dt>
        <dd>block {proposal.endBlock.toLocaleString()}</dd>
        <dt className="text-muted">executable from</dt>
        <dd>block {proposal.eta.toLocaleString()}</dd>
      </dl>

      {proposal.stage.name === 'executable' && (
        <Execute governor={governor} proposalId={proposal.id} />
      )}
    </li>
  )
}

export default async function Governance() {
  const governance = await readGovernance(revalidate)

  return (
    <main className="mx-auto w-full max-w-4xl px-5 py-10">
      <header className="border-b border-thread pb-6">
        <div className="flex items-baseline justify-between">
          <Link href="/" className="font-display text-lg font-extrabold tracking-tight hover:text-gold">
            jalin
          </Link>
          <nav className="flex gap-5 font-mono text-xs text-muted">
            <Link href="/compose" className="hover:text-gold">
              composer
            </Link>
            <Link href="/verify" className="hover:text-gold">
              verify
            </Link>
          </nav>
        </div>
        <h1 className="mt-6 font-display text-3xl font-semibold tracking-tight">Governance</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted">
          The router holds no admin key. Every parameter it reads — whether it is paused, how many
          steps a plan may have, what the fee is, which targets are denied — belongs to the
          governor, and the governor moves only by a vote that has cleared a timelock.
        </p>
        <p className="mt-3 font-mono text-xs text-muted">
          governor {GOVERNOR_ADDRESS ? label(GOVERNOR_ADDRESS) : 'not deployed'} · router{' '}
          {ROUTER_ADDRESS ? label(ROUTER_ADDRESS) : 'not deployed'}
        </p>
      </header>

      {!governance ? (
        <p className="mt-8 rounded border border-warn/40 bg-warn/10 px-3 py-2 font-mono text-xs text-warn">
          The governor could not be read. Everything below would have come from it, so nothing is
          shown rather than something invented.
        </p>
      ) : (
        <>
          <section className="mt-8">
            <h2 className="font-display text-xl font-semibold">What the router is running on</h2>
            <p className="mt-1 text-sm text-muted">
              Read from the governor at block {governance.head.toLocaleString()}. The router asks
              for these on every single plan, so this is not a mirror of the settings — it is the
              settings.
            </p>

            <dl className="mt-4 grid gap-x-6 gap-y-2 font-mono text-sm sm:grid-cols-[auto_1fr]">
              <dt className="text-muted">paused</dt>
              <dd className={governance.params.paused ? 'text-warn' : 'text-hidden'}>
                {governance.params.paused ? 'yes — every plan reverts' : 'no'}
              </dd>
              <dt className="text-muted">max steps</dt>
              <dd>{governance.params.maxSteps}</dd>
              <dt className="text-muted">max calldata</dt>
              <dd>{governance.params.maxCalldata} felts per step</dd>
              <dt className="text-muted">fee</dt>
              <dd>
                {governance.params.feeBps} bps
                {governance.params.feeBps === 0 && ' — nothing is taken'}
              </dd>
              <dt className="text-muted">fee recipient</dt>
              <dd className="break-all">{label(governance.params.feeRecipient)}</dd>
              {governance.votingBlocks !== null && (
                <>
                  <dt className="text-muted">voting window</dt>
                  <dd>{governance.votingBlocks.toLocaleString()} blocks</dd>
                </>
              )}
              {governance.timelockBlocks !== null && (
                <>
                  <dt className="text-muted">timelock</dt>
                  <dd>{governance.timelockBlocks.toLocaleString()} blocks after voting closes</dd>
                </>
              )}
            </dl>

            <p className="mt-4 rounded border border-strand px-3 py-2 text-xs leading-relaxed text-muted">
              The voting window and the timelock above are measured, not configured here:
              subtracted from a real proposal&apos;s own blocks. Quorum cannot be shown, because the
              governor stores it and exposes no view for it — a governance parameter nobody can
              read is a governance parameter nobody can check, and that is our omission rather than
              the protocol&apos;s. It is enforced at execution, so a proposal below can look ready
              and still fail on it.
            </p>
          </section>

          <section className="mt-10">
            <h2 className="font-display text-xl font-semibold">
              Proposals{' '}
              <span className="font-mono text-sm text-muted">({governance.proposals.length})</span>
            </h2>
            <p className="mt-1 text-sm text-muted">
              Ballots do not arrive here. They arrive through the pool, as{' '}
              <span className="font-mono">privacy_invoke</span> — the governor is an anonymizer
              helper like the router is. So the weight of a vote is public and the voter is not,
              and the stake stays escrowed here until the vote closes, which is what stops one set
              of funds voting twice.
            </p>

            {governance.proposals.length === 0 ? (
              <p className="mt-4 font-mono text-xs text-muted">None yet.</p>
            ) : (
              <ul className="mt-2">
                {governance.proposals.map((proposal) => (
                  <ProposalCard
                    key={proposal.id}
                    proposal={proposal}
                    governor={GOVERNOR_ADDRESS}
                  />
                ))}
              </ul>
            )}
          </section>

          <section className="mt-10 border-t border-thread pt-6">
            <h2 className="font-display text-xl font-semibold">Propose something</h2>
            <p className="mt-1 max-w-2xl text-sm text-muted">
              Permissionless, and the one part of Jalin that works end to end today: proposing is
              an ordinary public transaction, so it needs no STRK20 wallet support and no proving
              service. Spam is answered by quorum rather than by a gate on who may speak — a gate
              would only move the admin key somewhere less visible.
            </p>
            <Propose governor={GOVERNOR_ADDRESS} router={ROUTER_ADDRESS} />
          </section>
        </>
      )}
    </main>
  )
}
