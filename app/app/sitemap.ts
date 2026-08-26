import type { MetadataRoute } from 'next'

import { SITE } from '@/lib/config'

/** The four pages. The API routes answer questions; they are not pages. */
export default function sitemap(): MetadataRoute.Sitemap {
  return ['', '/compose', '/verify', '/governance'].map((path) => ({
    url: `${SITE}${path}`,
    changeFrequency: 'daily',
    priority: path === '' ? 1 : 0.8,
  }))
}
