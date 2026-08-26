import 'server-only'
import { hash } from 'starknet'
import { GOVERNOR_ADDRESS, ROUTER_ADDRESS } from './config'
import { readCrowd } from './crowd-source'

/**
 * Live contract state, read on the server.
 *
 * The RPC URL stays server-side: it carries an API key, and a key in
 * NEXT_PUBLIC_ is a key anyone can lift out of the bundle and spend. Reads
 * happen on request rather than at build, so the page shows what the contracts
 * say now and not what they said when it was compiled.
 */

const RPC = process.env.STARKNET_RPC_URL

async function call(contract: string, entrypoint: string, calldata: string[] = []) {
  if (!RPC || !contract) return null
  try {
    const response = await fetch(RPC, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 1,
        jsonrpc: '2.0',
        method: 'starknet_call',
        params: {
          block_id: 'latest',
          request: { contract_address: contract, entry_point_selector: selector(entrypoint), calldata },
        },
      }),
      next: { revalidate: 60 },
    })
    const body = (await response.json()) as { result?: string[] }
    return body.result ?? null
  } catch {
    // A page that cannot reach the chain still has a thesis to state.
    return null
  }
}

/**
 * Derived, not written down. An entry point id is starknet_keccak of the name,
 * and a hand-copied constant is a constant that can be wrong in a way nothing
 * catches until the call returns nothing.
 */
function selector(name: string): string {
  return hash.getSelectorFromName(name)
}

export interface ChainState {
  plansExecuted: number | null
  proposalCount: number | null
  depositors: number | null
  reachable: boolean
}

export async function readChainState(): Promise<ChainState> {
  const [plans, proposals, crowd] = await Promise.all([
    call(ROUTER_ADDRESS, 'plans_executed'),
    call(GOVERNOR_ADDRESS, 'proposal_count'),
    readCrowd(),
  ])
  return {
    plansExecuted: plans?.[0] ? Number(BigInt(plans[0])) : null,
    proposalCount: proposals?.[0] ? Number(BigInt(proposals[0])) : null,
    depositors: crowd?.depositors ?? null,
    reachable: plans !== null || proposals !== null,
  }
}
