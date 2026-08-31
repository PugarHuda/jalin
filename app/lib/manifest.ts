import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The submission's own `strk20.json`, read rather than transcribed.
 *
 * The three qualifying hashes were only ever in that file and on `/verify`, so
 * the page that argues for them never showed one. Copying them into a constant
 * here would fix the display and introduce the drift the manifest exists to
 * prevent: the file is what the panel reads, so the file is what the page reads.
 *
 * `process.cwd()` is the workspace during a local build and the repository root
 * on the deploy, so both are tried rather than guessed at. A miss is returned as
 * null and said out loud by the caller; it is never rendered as an empty space.
 */
export interface Manifest {
  transactions: string[]
  contracts: string[]
  demo_video?: string
  demo_url?: string
}

const CANDIDATES = ['strk20.json', join('..', 'strk20.json')]

export const manifest: Manifest | null = (() => {
  for (const relative of CANDIDATES) {
    try {
      const parsed = JSON.parse(readFileSync(join(process.cwd(), relative), 'utf8')) as Manifest
      if (Array.isArray(parsed.transactions) && parsed.transactions.length > 0) return parsed
    } catch {
      // Next candidate. The last failure is reported by the caller, not here.
    }
  }
  return null
})()
