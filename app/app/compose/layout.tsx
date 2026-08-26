import type { Metadata } from 'next'

// The page itself is a client component, so its title lives here. Without it
// both tabs read "Jalin" and there is no telling them apart.
export const metadata: Metadata = { title: 'Composer' }

export default function ComposeLayout({ children }: { children: React.ReactNode }) {
  return children
}
