import type { StarknetWindowObject } from 'get-starknet-core'

/**
 * A JSON-RPC error carries a code and usually a `data` field naming the field it
 * rejected. `error.message` alone reduces all of that to "An error occurred
 * (INVALID_REQUEST_PAYLOAD)", which is the difference between a fix and a guess.
 *
 * This lived in the composer, which is where the lesson was learned. The
 * governance page kept `error.message` and paid for it: a propose call carrying
 * one field too many was refused with exactly that sentence, and the `data`
 * naming the field was thrown away before anyone could read it.
 */
export function describeError(error: unknown): string {
  const parts: string[] = []
  const anyError = error as { message?: string; code?: unknown; data?: unknown }
  if (anyError?.message) parts.push(anyError.message)
  else parts.push(String(error))
  if (anyError?.code !== undefined) parts.push(`code ${String(anyError.code)}`)
  if (anyError?.data !== undefined) {
    try {
      parts.push(`data ${JSON.stringify(anyError.data)}`)
    } catch {
      parts.push(`data ${String(anyError.data)}`)
    }
  }
  return parts.join(' · ')
}

/**
 * Ready, and only Ready.
 *
 * It is the one wallet whose STRK20 methods have been exercised against this
 * router on mainnet — the shield in 0x04816dbb…0278 came from it. Braavos may
 * well implement them too; nobody here has checked, and offering an untested
 * wallet offers somebody a proof they pay for before finding out.
 *
 * Matched on the id as well as the name, because Ready is the renamed Argent X
 * and the library's discovery list still reports the old one.
 */
export function isReady(wallet: { id?: string; name?: string }): boolean {
  return /ready|argent/i.test(`${wallet.id ?? ''} ${wallet.name ?? ''}`)
}

/**
 * The Ready wallets in this browser, or a sentence saying why there are none.
 *
 * Every page that signs used to reach for `getAvailableWallets()[0]` — whichever
 * wallet the browser happened to inject first. Narrowing the composer to Ready
 * therefore fixed one page out of four: governance went on opening Braavos,
 * which is a different account and a different signature from the one holding
 * the notes the rest of the demo spends.
 *
 * Proposing needs no STRK20 support, so Braavos could have signed it. That is
 * not the point: a demo that connects a different wallet on a different page is
 * a demo whose account changes underneath the reader.
 */
export async function readyWallets(): Promise<{
  wallets: StarknetWindowObject[]
  error: string | null
}> {
  const { default: getStarknet } = await import('get-starknet-core')
  const available = await getStarknet.getAvailableWallets()
  const offered = available.filter(isReady)
  if (offered.length > 0) return { wallets: offered, error: null }

  // The list comes from the library rather than from a hardcoded one here, so
  // it does not go stale. Whether Ready can be installed comes from the library
  // too; the name does not, because discovery still files it under "Argent X"
  // and telling somebody to install that names a wallet no longer called it.
  const installable = await getStarknet.getDiscoveryWallets()
  return {
    wallets: [],
    error:
      available.length > 0
        ? `This demo signs with Ready. ${available.map((w) => w.name).join(', ')} ${
            available.length > 1 ? 'are' : 'is'
          } installed here instead. Ready is the only wallet whose STRK20 support has been checked against this router on mainnet, and every page here uses the same one so the account does not change between them.`
        : installable.some(isReady)
        ? 'No Starknet wallet in this browser. This demo signs with Ready — install it and come back. The discovery list still files it under its old name, Argent X.'
        : 'No Starknet wallet found in this browser.',
  }
}

/**
 * The Wallet API's call shape, which is not the JSON-RPC one.
 *
 * `starknet_call` and the transaction specs name the field
 * `entry_point_selector` and take a selector hash. The Wallet API's own `Call`
 * names it `entry_point` and starknet.js's `WalletAccount.execute` fills it
 * with `entrypoint` verbatim - the function's name. Sending the RPC spelling is
 * refused with INVALID_REQUEST_PAYLOAD, code 114, and the code is all you get:
 * there is no `data` naming the field.
 *
 * The three governance components each sent the RPC spelling, each behind an
 * `as never` on the call itself, which is exactly the cast that would otherwise
 * have made the compiler say so. Typed here, once, and asserted nowhere.
 */
export interface WalletCall {
  contract_address: string
  /** The entrypoint's name — `propose`, not `0x1bfd59…`. */
  entry_point: string
  calldata?: string[]
}

/**
 * Sends calls through the connected wallet and returns the transaction hash.
 *
 * One cast, on `request` rather than on the call, because get-starknet-core
 * bundles a request map that predates some of these methods. The payload itself
 * stays typed, which is the half that was getting things wrong.
 */
export async function sendCalls(
  wallet: StarknetWindowObject,
  calls: WalletCall[],
): Promise<string> {
  const { default: getStarknet } = await import('get-starknet-core')
  await getStarknet.enable(wallet)
  const response = (await (
    wallet as unknown as { request(call: unknown): Promise<{ transaction_hash: string }> }
  ).request({ type: 'wallet_addInvokeTransaction', params: { calls } })) as {
    transaction_hash: string
  }
  return response.transaction_hash
}
