import { cached } from '@/lib/cache'

/**
 * What the sprint's own hub says about a project.
 *
 * The hub repository publishes `projects.json`: one entry per registered
 * project, with the transactions its verifier accepted, which of the three
 * requirements are met, and whether the panel starred it. That is the verdict
 * that counts, and until now the only way to see it was to open the file and
 * search 167 entries by hand. This reads it and returns one entry, so the
 * verify page can put the hub's answer beside its own - and a team whose two
 * answers differ finds out before the deadline rather than after.
 *
 * One URL, fixed. The caller supplies a repository name that is matched
 * against the entries; nothing the caller sends becomes part of a request.
 */
export const revalidate = 300

const HUB = 'https://raw.githubusercontent.com/starkience/strk20-hackathon/main/projects.json'
const NAME = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/

interface HubProject {
  slug?: string
  repo_url?: string
  status?: string
  starred?: boolean
  verified_txs?: number
  requirements?: { demo?: boolean; video?: boolean; mainnet?: boolean }
  transactions?: { hash: string; ok?: boolean; pool?: boolean; mine?: boolean }[]
  pushed_at?: string
}

export async function GET(request: Request) {
  const repo = new URL(request.url).searchParams.get('repo')?.trim() ?? ''
  if (!NAME.test(repo)) {
    return Response.json({ error: 'repo must be owner/name' }, { status: 400 })
  }

  let projects: HubProject[]
  try {
    const response = await fetch(HUB, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
      next: { revalidate },
    })
    if (!response.ok) {
      return Response.json({ error: `the hub answered ${response.status}` }, { status: 502 })
    }
    const body: unknown = await response.json()
    projects = Array.isArray(body) ? (body as HubProject[]) : []
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError'
    return Response.json(
      { error: timedOut ? 'the hub did not answer in time' : 'could not reach the hub' },
      { status: 502 },
    )
  }

  const wanted = repo.toLowerCase()
  const entry = projects.find((p) => (p.repo_url ?? '').toLowerCase().replace(/^https?:\/\/github\.com\//, '').replace(/\/$/, '') === wanted)
  if (!entry) {
    return cached({ registered: false, projects: projects.length }, 60)
  }

  return cached(
    {
      registered: true,
      projects: projects.length,
      slug: entry.slug ?? null,
      status: entry.status ?? null,
      starred: entry.starred ?? false,
      verifiedTransactions: entry.verified_txs ?? 0,
      requirements: {
        demo: entry.requirements?.demo ?? false,
        video: entry.requirements?.video ?? false,
        mainnet: entry.requirements?.mainnet ?? false,
      },
      transactions: (entry.transactions ?? []).map((t) => ({
        hash: t.hash,
        counted: Boolean(t.ok && t.pool && t.mine !== false),
      })),
      lastPush: entry.pushed_at ?? null,
    },
    revalidate,
  )
}
