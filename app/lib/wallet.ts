import type { StarknetWindowObject } from 'get-starknet-core'
import type {
  RequestFn,
  STRK20_ACTION,
  STRK20_BALANCE_ENTRY,
  STRK20_CALL_AND_PROOF,
} from '@starknet-io/types-js'

/**
 * Everything the app says to a wallet, in one module, typed.
 *
 * `get-starknet-core` pins `@starknet-io/types-js` 0.7, whose request map
 * predates STRK20. Every caller used to cast around that at the call site -
 * `as never` on the call, `as unknown as { request(...) }` on the wallet - and
 * two bugs hid behind those casts for days: a call with a field too many, and a
 * call with the JSON-RPC field name instead of the Wallet API one. The types
 * that would have refused both were installed the whole time, at 0.10.4, and
 * nothing looked at them.
 *
 * So there is exactly one cast, `asStrk20`, made once at connection. From there
 * `request` is typed by the Wallet API's own map: method names, parameter shapes,
 * result shapes, and which errors each can raise.
 */

/** A wallet whose `request` is typed by the current Wallet API rather than 0.7's. */
export type Strk20Wallet = Omit<StarknetWindowObject, 'request'> & { request: RequestFn }

export function asStrk20(wallet: StarknetWindowObject): Strk20Wallet {
  return wallet as unknown as Strk20Wallet
}

/**
 * A JSON-RPC error carries a code and usually a `data` field naming the field it
 * rejected. `error.message` alone reduces all of that to "An error occurred
 * (INVALID_REQUEST_PAYLOAD)", which is the difference between a fix and a guess.
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
 */
export async function readyWallets(): Promise<{
  wallets: StarknetWindowObject[]
  error: string | null
}> {
  const { default: getStarknet } = await import('get-starknet-core')
  const available = await getStarknet.getAvailableWallets()

  // One entry per extension. Ready injects itself under both its old id and
  // its new one, and the library keys by id, so a single wallet arrived here
  // twice and the page offered a choice between a thing and itself.
  const seen = new Set<string>()
  const offered = available.filter((wallet) => {
    if (!isReady(wallet)) return false
    const key = (wallet.name ?? wallet.id).toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  if (offered.length > 0) return { wallets: offered, error: null }

  // Whether Ready can be installed comes from the library; the name does not,
  // because discovery still files it under "Argent X" and telling somebody to
  // install that names a wallet no longer called it.
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
 * refused with INVALID_REQUEST_PAYLOAD, code 114, and the code is all you get.
 */
export interface WalletCall {
  contract_address: string
  /** The entrypoint's name — `propose`, not `0x1bfd59…`. */
  entry_point: string
  calldata?: string[]
}

/** Sends public calls through the connected wallet and returns the transaction hash. */
export async function sendCalls(
  wallet: StarknetWindowObject,
  calls: WalletCall[],
): Promise<string> {
  const { default: getStarknet } = await import('get-starknet-core')
  await getStarknet.enable(wallet)
  const response = await asStrk20(wallet).request({
    type: 'wallet_addInvokeTransaction',
    params: { calls },
  })
  return response.transaction_hash
}

// ---------------------------------------------------------------------------
// STRK20
// ---------------------------------------------------------------------------

/**
 * What this wallet can do, established by asking rather than by brand.
 *
 * Support lives in the wallet, not in the account class on chain, so the only
 * honest test is to call a method and see. `strk20Balances` is the read-only
 * one and doubles as the answer to "how much can I spend", which is why it is
 * the probe. The shadow-account method is probed separately: it entered the
 * Wallet API at 0.10.4 and a wallet may implement the rest without it.
 *
 * NOT_REGISTERED is the pool saying "I know this method, you have no notes
 * yet" - which is support, not the absence of it.
 */
export interface Capabilities {
  /** What the wallet reports through `wallet_supportedWalletApi`. */
  versions: string[]
  strk20: boolean
  /**
   * The wallet asked and the person said no. Not a capability: a refusal
   * answers "do you want to right now", and the page must not read it as
   * "this wallet cannot".
   */
  declined: boolean
  /** The account has joined the pool, so balances and spends are possible. */
  registered: boolean
  /** `wallet_strk20ShadowAccountCommitment` answered. */
  shadow: boolean
  /** Whatever the wallet said when it refused, for the screen. */
  refusal: string | null
  shadowRefusal: string | null
  /** The balances that came back from the probe, so they are not asked twice. */
  balances: STRK20_BALANCE_ENTRY[]
}

export async function probe(wallet: Strk20Wallet): Promise<Capabilities> {
  const out: Capabilities = {
    versions: [],
    strk20: false,
    declined: false,
    registered: false,
    shadow: false,
    refusal: null,
    shadowRefusal: null,
    balances: [],
  }

  try {
    out.versions = await wallet.request({ type: 'wallet_supportedWalletApi' })
  } catch {}

  try {
    // `tokens` is required; an empty array means every shielded token. Calling
    // it with no params at all returns INVALID_REQUEST_PAYLOAD, which reads
    // like a missing method and is not one.
    out.balances = await wallet.request({ type: 'wallet_strk20Balances', params: { tokens: [] } })
    out.strk20 = true
    out.registered = true
  } catch (error) {
    const message = describeError(error)
    if (/NOT_REGISTERED/i.test(message)) {
      out.strk20 = true
    } else if (/USER_REFUSED|113/i.test(message)) {
      // Reject in the wallet. The third time this file has had to separate a
      // wallet's answer from a wallet's absence: NOT_REGISTERED means the pool
      // knows the method, INVALID_REQUEST_PAYLOAD meant the params were wrong,
      // and this means the person declined. Reporting it as missing support
      // sent the page back to its first-run state and told somebody with 24
      // STRK in the pool that they had not joined it.
      out.declined = true
      out.refusal = message
    } else {
      out.refusal = message
    }
  }

  if (out.strk20) {
    try {
      // The partial commitment, nonce omitted: computed locally by the wallet
      // from its private state, no transaction, no cost. Whether it answers is
      // the whole question.
      await wallet.request({
        type: 'wallet_strk20ShadowAccountCommitment',
        params: { dapp_name: SHADOW_DAPP },
      })
      out.shadow = true
    } catch (error) {
      const message = describeError(error)
      out.shadow = /NOT_REGISTERED/i.test(message)
      if (!out.shadow) out.shadowRefusal = message
    }
  }

  return out
}

/**
 * The dapp name that scopes this project's shadow accounts. A Cairo short
 * string, at most 31 ASCII characters, and stable for the life of the project:
 * change it and every user's shadow accounts derive to different addresses.
 */
export const SHADOW_DAPP = 'jalin'

export function shieldedBalances(
  wallet: Strk20Wallet,
  tokens: string[] = [],
): Promise<STRK20_BALANCE_ENTRY[]> {
  return wallet.request({ type: 'wallet_strk20Balances', params: { tokens } })
}

/**
 * Builds and proves without submitting. With `simulate` the wallet skips the
 * proof itself and only assembles the call, which is the cheapest way there is
 * to learn that a plan would revert - before a proof is paid for and before the
 * pool's fee is.
 */
export function simulate(
  wallet: Strk20Wallet,
  actions: STRK20_ACTION[],
): Promise<STRK20_CALL_AND_PROOF> {
  return wallet.request({
    type: 'wallet_strk20PrepareInvoke',
    params: { actions, simulate: true },
  })
}

export async function submit(wallet: Strk20Wallet, actions: STRK20_ACTION[]): Promise<string> {
  const response = await wallet.request({
    type: 'wallet_strk20InvokeTransaction',
    params: { actions },
  })
  return response.transaction_hash
}

/**
 * The commitment of one of the user's shadow accounts for this dapp, or - with
 * the nonce omitted - the partial commitment every one of them shares.
 *
 * The partial one is what a dapp publishes to recognise all of a user's shadow
 * accounts without learning any individual nonce. It is derived from the user,
 * their viewing key and the shadow-account anonymizer, and it never leaves the
 * wallet's own arithmetic: nothing is sent to anybody to compute it.
 */
export function shadowCommitment(wallet: Strk20Wallet, nonce?: string): Promise<string> {
  return wallet.request({
    type: 'wallet_strk20ShadowAccountCommitment',
    params: nonce === undefined ? { dapp_name: SHADOW_DAPP } : { dapp_name: SHADOW_DAPP, nonce },
  })
}
