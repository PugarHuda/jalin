import { readCrowd } from '@/lib/crowd-source'

/**
 * The crowd, for the composer. The counting itself lives in lib/crowd-source so
 * the landing page can call it without asking this route over HTTP.
 */
export const revalidate = 300

export async function GET() {
  const crowd = await readCrowd(revalidate)
  if (!crowd) return Response.json({ error: 'pool unreachable' }, { status: 502 })
  return Response.json(crowd)
}
