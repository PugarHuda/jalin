'use client'

import { useState } from 'react'
import { hash, shortString } from 'starknet'
import { BALLOT_TAG, redeemBallotActions, type BallotStage } from 'jalin-sdk'
import { GOVERNOR_ADDRESS, TOKENS } from '@/lib/config'
import { asStrk20, describeError, readyWallets, simulate, submit } from '@/lib/wallet'

/**
 * Taking a ballot stake back out of the governor.
 *
 * The composer mints a secret when a ballot is cast, prints it once, and says
 * "you redeem it with the secret this page gives you". That sentence was not
 * true of any code: `redeem` was written in Cairo, tested in Cairo, and reached
 * from nowhere — no form, no script phase, no SDK helper. Every ballot cast
 * against this governor was a stake with no way back, and the page that took it
 * said otherwise.
 *
 * Three things this panel does that a bare "send it" button would not:
 *
 * 1. **The secret stays in the browser until it is spent.** The lookup sends
 *    `poseidon_hash_span([BALLOT_TAG, secret])`, which is what the governor
 *    stores; the secret itself first leaves this machine inside the redeem
 *    transaction, where it has to. A form that posted the secret to a route
 *    would put a bearer instrument through a URL and a CDN.
 * 2. **It reads the stage from the chain rather than guessing.** `redeem`
 *    asserts `block_number > proposal.end_block`, so an early attempt costs gas
 *    and reverts; the button is only offered when the governor would accept it.
 * 3. **It shows the escrow behind the answer.** `outstanding()` is what the
 *    governor owes every unclaimed ballot and `balanceOf` is what it holds. A
 *    redeemer's real question is whether the contract can pay, and both numbers
 *    were readable on chain and read by nothing.
 */

const STRK = TOKENS[0]!

interface Reading {
  stage: BallotStage
  ballot: { proposalId: string; amount: string; claimed: boolean }
  proposal: { id: string; endBlock: number; eta: number; executed: boolean } | null
  head: number
  escrow: { outstanding: string | null; held: string; token: string }
}

function strk(amount: string): string {
  const value = Number(BigInt(amount)) / 10 ** STRK.decimals
  return `${value.toFixed(value >= 1 ? 2 : 4)} STRK`
}

/** The commitment the governor stores, computed the way the contract computes it. */
export function commitmentOf(secret: string): string {
  return hash.computePoseidonHashOnElements([shortString.encodeShortString(BALLOT_TAG), secret])
}

export function Redeem() {
  const [secret, setSecret] = useState('')
  const [reading, setReading] = useState<Reading | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [sent, setSent] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const looksLikeFelt = /^0x[0-9a-fA-F]{1,64}$/.test(secret.trim())

  async function look() {
    setStatus(null)
    setSent(null)
    setReading(null)
    if (!looksLikeFelt) {
      return setStatus('A ballot secret is a felt: 0x followed by up to 64 hex digits.')
    }

    setBusy(true)
    try {
      const commitment = commitmentOf(secret.trim())
      const response = await fetch(`/api/ballot?commitment=${commitment}`)
      const body = await response.json()
      if (!response.ok) {
        return setStatus(
          `The governor could not be read: ${String(body?.error ?? response.status)}.`,
        )
      }
      setReading(body as Reading)
    } catch (error) {
      // A failed lookup that says nothing is how a redeemer concludes the stake
      // is gone. It is a network error and it is worth saying so.
      setStatus(`The lookup did not complete: ${describeError(error)}`)
    } finally {
      setBusy(false)
    }
  }

  async function redeem() {
    setStatus(null)
    setBusy(true)
    try {
      const { wallets, error: noWallet } = await readyWallets()
      const found = wallets[0]
      if (!found) return setStatus(noWallet)

      const wallet = asStrk20(found)
      const [account] = await wallet.request({ type: 'wallet_requestAccounts' })
      if (!account) return setStatus('The wallet returned no account.')

      const actions = redeemBallotActions({
        governor: GOVERNOR_ADDRESS,
        secret: secret.trim(),
        ballotToken: STRK.address,
        recipient: account,
      })

      // Dry run first. The governor's refusals — voting still open, already
      // claimed — are cheap to hear before proving and expensive after.
      await simulate(wallet, actions)
      setSent(await submit(wallet, actions))
      setReading(null)
    } catch (error) {
      const message = describeError(error)
      setStatus(
        /VOTING_OPEN/i.test(message)
          ? 'GOV_VOTING_OPEN: the proposal this ballot was cast on has not closed yet. The stake is redeemable from the block after end_block.'
          : /ALREADY_CLAIMED/i.test(message)
            ? 'GOV_ALREADY_CLAIMED: this secret has already been spent. A ballot redeems once.'
            : /NO_BALLOT/i.test(message)
              ? 'GOV_NO_BALLOT: the governor holds no ballot for this secret.'
              : message,
      )
    } finally {
      setBusy(false)
    }
  }

  const stage = reading?.stage
  const owed = reading?.escrow.outstanding
  const shortfall =
    reading && owed !== null && owed !== undefined && BigInt(reading.escrow.held) < BigInt(owed)
      ? BigInt(owed) - BigInt(reading.escrow.held)
      : 0n

  return (
    <section className="mt-8 max-w-[62ch] border-t border-thread pt-4" id="redeem">
      <h2 className="font-display text-lg font-semibold">Redeem a ballot stake</h2>
      <p className="mt-2 max-w-[62ch] font-mono text-xs text-muted">
        A ballot stakes STRK in the governor and hands you a secret. Voting closes at the
        proposal&apos;s end block; from the block after it, this takes the stake back into a fresh
        note. The secret is hashed here and only the hash is sent to look it up.
      </p>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="flex-1 basis-72">
          <span className="block font-mono text-xs text-muted">Ballot secret</span>
          <input
            className="mt-1 w-full rounded border border-strand bg-raised px-3 py-2 font-mono text-xs"
            value={secret}
            onChange={(event) => setSecret(event.target.value)}
            placeholder="0x…"
            spellCheck={false}
            autoComplete="off"
            aria-label="Ballot secret"
          />
        </label>
        <button
          className="rounded border border-strand px-3 py-1.5 text-sm hover:border-gold disabled:opacity-40"
          onClick={look}
          disabled={busy || secret.trim().length === 0}
        >
          Look it up
        </button>
      </div>

      {reading && (
        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 font-mono text-xs">
          <dt className="text-muted">Stage</dt>
          <dd data-testid="ballot-stage">
            {stage?.name === 'unknown'
              ? 'No ballot. The governor holds nothing against this secret.'
              : stage?.name === 'voting'
                ? `Voting. ${stage.blocksLeft.toLocaleString()} blocks until it closes.`
                : stage?.name === 'claimed'
                  ? 'Claimed. This secret has already been spent.'
                  : 'Redeemable now.'}
          </dd>

          {reading.proposal && (
            <>
              <dt className="text-muted">Proposal</dt>
              <dd>
                #{reading.proposal.id}, ends at block{' '}
                {reading.proposal.endBlock.toLocaleString()}
              </dd>
              <dt className="text-muted">Stake</dt>
              <dd>{strk(reading.ballot.amount)}</dd>
            </>
          )}

          <dt className="text-muted">Escrow</dt>
          <dd>
            {owed === null ? (
              <>
                {strk(reading.escrow.held)} held. What it owes is unreadable: the deployed
                governor predates <span className="font-mono">outstanding()</span>, and the
                answer is that nobody can ask rather than that nothing is owed.
              </>
            ) : (
              <>
                {strk(reading.escrow.held)} held against {strk(owed!)} owed
                {shortfall > 0n ? ` — short by ${strk(shortfall.toString())}` : ''}
              </>
            )}
          </dd>

          <dt className="text-muted">Head</dt>
          <dd>{reading.head.toLocaleString()}</dd>
        </dl>
      )}

      {stage?.name === 'redeemable' && (
        <button
          className="mt-4 rounded-sm px-4 py-2 text-sm font-medium transition-colors enabled:bg-gold enabled:text-ground enabled:hover:opacity-90 disabled:cursor-not-allowed disabled:border disabled:border-strand disabled:text-muted"
          onClick={redeem}
          disabled={busy}
        >
          Redeem {strk(reading!.ballot.amount)}
        </button>
      )}

      {stage?.name === 'voting' && (
        <p className="mt-3 max-w-[62ch] font-mono text-xs text-muted">
          Sending it now would revert with GOV_VOTING_OPEN and still cost the gas, so the button
          is not offered until the governor would accept it.
        </p>
      )}

      {sent && (
        <p className="mt-3 max-w-[62ch] font-mono text-xs">
          Sent.{' '}
          <a
            className="underline underline-offset-2"
            href={`https://voyager.online/tx/${sent}`}
            target="_blank"
            rel="noreferrer"
          >
            {sent.slice(0, 10)}…
          </a>{' '}
          The stake lands as an open note owned by the account that signed this, and the secret is
          in the calldata from now on.
        </p>
      )}

      {status && (
        <p className="mt-3 max-w-[62ch] font-mono text-xs text-warn" role="alert">
          {status}
        </p>
      )}
    </section>
  )
}
