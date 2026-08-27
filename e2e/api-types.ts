import { expect, type APIResponse } from '@playwright/test'
import type { CellSummary, Crowd, Prospect, Verdict } from '@jalin/sdk'

/**
 * What each route promises, declared once.
 *
 * `response.json()` hands back `any`, so an assertion written against it checks
 * a value and nothing about the shape: rename a field in a route and every test
 * still compiles, then fails at runtime with `undefined` on the left of a
 * comparison. Fifty-eight accesses were in that state.
 *
 * Built on the SDK's own types where they exist, which makes this a contract
 * test rather than a second description that can drift: if `Verdict` gains a
 * field and `/api/tx` stops returning it, this file stops compiling.
 */

export interface QuoteResponse {
  assets: string
  shares: string
}

export type TxResponse = Verdict & { summary: string }

export interface CrowdResponse extends Crowd {
  windowBlocks: number
  head: number
  truncated: boolean
  cells: CellSummary
}

export type ProspectResponse = Prospect

export interface ParamsResponse {
  paused: boolean
  openProposal: { id: number; endBlock: number; blocksLeft: number } | null
  maxSteps: number
  maxCalldata: number
  feeBps: number
  /** The pool's flat charge per private operation, base units as a string. */
  poolFee: string
  denied: Record<string, boolean>
}

/** Every route uses the same shape when it refuses. */
export interface ErrorResponse {
  error: string
}

/**
 * Reads a response as `T`, having first checked the status.
 *
 * The status check lives here because a JSON body parsed off a 500 is the most
 * confusing way to fail: the assertion that follows reports a missing field
 * rather than a failed request.
 */
export async function json<T>(response: APIResponse, status = 200): Promise<T> {
  expect(response.status(), await response.text()).toBe(status)
  return (await response.json()) as T
}
