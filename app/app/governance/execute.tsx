'use client'

import { useState } from 'react'
import { hash } from 'starknet'
import { describeError, readyWallets } from '@/lib/wallet'

/**
 * Anyone may execute a proposal that has carried and cleared its timelock.
 *
 * The page had been showing that a proposal was executable and offering no way
 * to execute it, which leaves the last step of governance to whoever is willing
 * to hand-encode a call. Permissionless is only true if it is reachable.
 *
 * Quorum is enforced here and cannot be read beforehand, so this can fail on a
 * proposal that looks ready. The button says so rather than pretending.
 */
export function Execute({ governor, proposalId }: { governor: string; proposalId: number }) {
  const [status, setStatus] = useState<string | null>(null)
  const [sent, setSent] = useState<string | null>(null)

  async function execute() {
    setStatus(null)
    try {
      const { wallets, error: noWallet } = await readyWallets()
      const wallet = wallets[0]
      if (!wallet) return setStatus(noWallet)

      const { default: getStarknet } = await import('get-starknet-core')

      await getStarknet.enable(wallet)
      const response = (await wallet.request({
        type: 'wallet_addInvokeTransaction',
        params: {
          calls: [
            {
              contract_address: governor,
              entry_point_selector: hash.getSelectorFromName('execute'),
              calldata: [`0x${proposalId.toString(16)}`],
            } as never,
          ],
        },
      })) as { transaction_hash: string }

      setSent(response.transaction_hash)
    } catch (error) {
      const message = describeError(error)
      setStatus(
        /NO_QUORUM/i.test(message)
          ? 'GOV_NO_QUORUM: it carried, but not by enough weight. Quorum is stored in the governor with no view to read it, so this was not knowable before sending.'
          : message,
      )
    }
  }

  return (
    <div className="mt-3">
      <button
        onClick={execute}
        className="rounded border border-strand px-3 py-1 text-xs hover:border-gold"
      >
        Execute #{proposalId}
      </button>
      <p className="mt-1 text-xs text-muted">
        Anyone may send this. It can still fail on quorum, which is enforced here and cannot be
        read first.
      </p>
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
