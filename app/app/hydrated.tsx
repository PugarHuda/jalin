'use client'

import { useEffect } from 'react'

/**
 * Marks the document as interactive.
 *
 * A controlled input holds its value in React state, so anything typed before
 * hydration lives only in the DOM and is discarded the moment React takes over.
 * On a fast machine the window is a few milliseconds; on a slow connection it is
 * long enough to lose a whole pasted field, and WebKit lost one reliably enough
 * to fail the same test on every run.
 *
 * The attribute gives the page an honest answer to "is this usable yet" - the
 * end-to-end suite waits on it instead of racing it, and anything that needs to
 * defer until the form is live can key off the same signal.
 */
export function Hydrated() {
  useEffect(() => {
    document.documentElement.dataset.hydrated = 'true'
  }, [])

  return null
}
