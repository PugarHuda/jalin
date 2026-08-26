import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Governance',
  description:
    'Every JalinRouter parameter is owned by a timelocked vote rather than an admin key. Read the governor, and propose against it.',
}

export default function GovernanceLayout({ children }: { children: React.ReactNode }) {
  return children
}
