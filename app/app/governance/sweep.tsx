'use client'

import { useState } from 'react'
import { hash } from 'starknet'
import { describeError } from '@/lib/wallet-error'

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
      const { default: getStarknet } = await import('get-starknet-core')
      const available = await getStarknet.getAvailableWallets()
      const wallet = available[0]
      if (!wallet) return setStatus('No Starknet wallet found in this browser.')

      await getStarknet.enable(wallet)
      const response = (await wallet.request({
        type: 'wallet_addInvokeTransaction',
        params: {
          calls: [
            {
              contract_address: router,
              entry_point_selector: hash.getSelectorFromName('sweep'),
              calldata: [token],
            } as never,
          ],
        },
      })) as { transaction_hash: string }

      setSent(response.transaction_hash)
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
        <p className="mt-1 break-all font-mono text-[11px] text-hidden">
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
      {status && <p className="mt-1 break-all font-mono text-[11px] text-warn">{status}</p>}
    </div>
  )
}
