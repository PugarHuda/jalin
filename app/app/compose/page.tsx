import { decodeDraft } from 'jalin-sdk'
import { Composer } from './composer'

/**
 * Reads a shared plan out of the URL, on the server.
 *
 * The composer is a client component and the draft lives in React state, so
 * doing this in an effect meant rendering a preset and replacing it a tick
 * later - a second render, a hydration mismatch, and the same class of race
 * that already cost this project a form which discarded what you typed.
 *
 * The server decodes it and hands over a starting draft. Both sides then render
 * the same thing, and a shared link is in the HTML rather than applied to it.
 */
export default async function ComposePage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string | string[] }>
}) {
  const { plan } = await searchParams
  const encoded = Array.isArray(plan) ? plan[0] : plan

  // decodeDraft returns null for anything malformed: the string came from a URL
  // somebody was handed, and a chat client that ate the last character should
  // open an empty composer rather than an error page.
  return <Composer shared={encoded ? decodeDraft(encoded) : null} />
}
