import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // The SDK is shipped as TypeScript source with explicit .ts specifiers, which
  // is what lets `node --test` run it without a build step. Next has to compile
  // it rather than expect a dist/.
  transpilePackages: ['@jalin/sdk'],
}

export default nextConfig
