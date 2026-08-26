import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Verify',
  description:
    'Check whether a Starknet transaction would count for the STRK20 Private Sprint: on chain, succeeded, touched the pool, and ran through the project’s own contract.',
}

export default function VerifyLayout({ children }: { children: React.ReactNode }) {
  return children
}
