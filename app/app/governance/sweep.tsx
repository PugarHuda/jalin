'use client'

import { useState } from 'react'
import { describeError, readyWallets, sendCalls } from '@/lib/wallet'

/**
 * Clears a donation off the router.
 *
 * I4 says a touched token must end a plan at zero. A stranger transferring
 * tokens straight to the router address breaks that for the token they sent,
 * and every future plan touching it reverts — a denial of service that costs
 * the attacker one transfer.
 *
 * `sweep` is the escape hatch: permissionless, so the fix is never gated on a
 * maintainer, and undirected, so calling it is not profitable. It sends to the
 * governor's fee recipient, chosen by vote and never by the caller. All of
 * which was true and unreachable without hand-encoding a call.
 */
export function Sweep({ router, token, symbol }: { router: string; token: string; symbol: string }) {
  const [status, setStatus] = useState<string | null>(null)
  const [sent, setSent] = useState<string | null>(null)

  async function sweep() {
    setStatus(null)
    try {
      const { wallets, error: noWallet } = await readyWallets()
      const wallet = wallets[0]
      if (!wallet) return setStatus(noWallet)

      setSent(
        await sendCalls(wallet, [
          { contract_address: router, entry_point: 'sweep', calldata: [token] },
        ]),
      )
    } catch (error) {
      setStatus(describeError(error))
    }
  }

  return (
    <div className="mt-2">
      <button
        onClick={sweep}
        className="rounded border border-strand px-3 py-1 text-xs hover:border-gold"
      >
        Sweep {symbol}
      </button>
      {sent && (
        <p className="mt-1 break-all font-mono text-xs text-hidden">
          sent ·{' '}
          <a
            className="text-gold underline underline-offset-2"
            href={`https://voyager.online/tx/${sent}`}
            target="_blank"
            rel="noreferrer"
          >
            {sent}
          </a>
        </p>
      )}
      {status && <p className="mt-1 break-all font-mono text-xs text-warn">{status}</p>}
    </div>
  )
}
