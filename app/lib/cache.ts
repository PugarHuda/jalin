/**
 * A JSON response the CDN is allowed to keep.
 *
 * `export const revalidate` on a route caches the fetches inside the function;
 * it says nothing about the response, so Vercel's edge answered every request
 * with a function invocation and `x-vercel-cache: MISS` on all six routes. A
 * cold `/api/params` took 2.8 seconds, which is how long the composer's shield
 * button read "reading the pool fee…" - and every visitor, or anyone hammering
 * `/api/crowd` on purpose, reached the node on the same shared key.
 *
 * `s-maxage` lets the edge serve repeats for `seconds`; `stale-while-revalidate`
 * lets it keep serving the last answer while it fetches the next one, so the
 * cold path is paid once per region per window rather than once per visitor.
 * Chain reads are the same for everyone, which is what makes them public.
 */
export function cached(body: unknown, seconds: number, init?: ResponseInit): Response {
  return Response.json(body, {
    ...init,
    headers: {
      ...init?.headers,
      'Cache-Control': `public, s-maxage=${seconds}, stale-while-revalidate=${seconds * 2}`,
    },
  })
}
