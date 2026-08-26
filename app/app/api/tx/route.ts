import { checkReceipt, describeVerdict } from '@jalin/sdk'
import { RpcError, rpc } from '@/lib/rpc'
import { GOVERNOR_ADDRESS, POOL_ADDRESS, ROUTER_ADDRESS } from '@/lib/config'

/**
 * Judge a transaction by the sprint's own rules, so the demo can say whether
 * what you signed would count rather than handing you a hash and a block
 * explorer. The rules live in the SDK, shared with the manifest verifier.
 *
 * `contracts` names the project's own contracts, because the rule is
 * conditional: a project that deployed contracts has to have gone through one
 * of them, and a project that deployed none is judged on the pool alone.
 * Without the parameter it answers for this project, which is what the composer
 * asks.
 */
export const dynamic = 'force-dynamic'

const MAX_CONTRACTS = 16

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams
  const hash = params.get('hash')
  if (!hash || !/^0x[0-9a-fA-F]{1,64}$/.test(hash)) {
    return Response.json({ error: 'hash must be a felt' }, { status: 400 })
  }

  const given = params.get('contracts')
  let ours = [ROUTER_ADDRESS, GOVERNOR_ADDRESS].filter(Boolean)

  if (given !== null) {
    const listed = given.split(',').map((entry) => entry.trim()).filter(Boolean)
    if (listed.length > MAX_CONTRACTS) {
      return Response.json({ error: `at most ${MAX_CONTRACTS} contracts` }, { status: 400 })
    }
    const bad = listed.find((entry) => !/^0x[0-9a-fA-F]{1,64}$/.test(entry))
    if (bad) {
      return Response.json({ error: `${bad} is not a felt` }, { status: 400 })
    }
    // An empty `contracts=` is a real answer, not a missing one: it says this
    // project deployed nothing, and the rule about going through your own
    // contract does not apply to it.
    ours = listed
  }

  let receipt: unknown = null
  try {
    receipt = await rpc.receipt(hash)
  } catch (error) {
    if (error instanceof RpcError && error.kind === 'unconfigured') {
      return Response.json({ error: 'no rpc configured' }, { status: 503 })
    }
    // A transaction that is not on chain yet is a verdict, not a failure: the
    // demo polls this while the wallet is still proving.
  }

  const verdict = checkReceipt(receipt as never, { pool: POOL_ADDRESS, ours })
  return Response.json({ ...verdict, summary: describeVerdict(verdict) })
}
