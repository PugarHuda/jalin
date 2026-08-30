import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // The SDK is shipped as TypeScript source with explicit .ts specifiers, which
  // is what lets `node --test` run it without a build step. Next has to compile
  // it rather than expect a dist/.
  transpilePackages: ['@jalin/sdk'],

  /**
   * This page asks people to connect a wallet and sign. Framing it inside
   * another site is how a signing prompt gets put in front of someone who
   * thinks they are clicking something else, so nothing may frame it.
   *
   * The rest are the cheap ones that have no downside: no MIME sniffing, no
   * referrer leaking the path to third parties, and no cross-origin window
   * handle onto a page a wallet talks to.
   */
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
        ],
      },
      {
        /**
         * The demo video is twenty megabytes and never changes once published.
         * Served with the default `max-age=0, must-revalidate` every seek in a
         * player is a fresh conditional request, which is a scrub bar that
         * stalls. Immutable, because a new cut would be a new file.
         */
        source: '/jalin-demo.mp4',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
    ]
  },
}

export default nextConfig
