import type { Metadata } from 'next'
import { Bricolage_Grotesque, IBM_Plex_Mono, IBM_Plex_Sans } from 'next/font/google'
import './globals.css'
import { SITE } from '@/lib/config'

// Bricolage reads as assembled rather than drawn, which is the right register for
// something whose whole idea is composition. Plex carries the engineering voice
// without sounding like every other developer tool.
const bricolage = Bricolage_Grotesque({
  variable: '--font-bricolage',
  subsets: ['latin'],
  weight: ['400', '600', '800'],
})

const plexSans = IBM_Plex_Sans({
  variable: '--font-plex-sans',
  subsets: ['latin'],
  weight: ['400', '500', '600'],
})

const plexMono = IBM_Plex_Mono({
  variable: '--font-plex-mono',
  subsets: ['latin'],
  weight: ['400', '500'],
})

const DESCRIPTION =
  'A programmable execution router for the STRK20 shielded pool. The pool allows one ' +
  'invoke per transaction, so Jalin weaves the whole plan inside it.'

/**
 * metadataBase is what turns the generated Open Graph image into an absolute URL.
 * Without it Next emits a relative path, which every unfurler ignores - so the
 * link that carries this submission would arrive as a bare grey rectangle.
 */
export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: { default: 'Jalin', template: '%s · Jalin' },
  description: DESCRIPTION,
  applicationName: 'Jalin',
  openGraph: {
    type: 'website',
    siteName: 'Jalin',
    title: 'Jalin — weaving a plan inside one invoke',
    description: DESCRIPTION,
  },
  twitter: { card: 'summary_large_image', title: 'Jalin', description: DESCRIPTION },
  robots: { index: true, follow: true },
}

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html
      lang="en"
      className={`${bricolage.variable} ${plexSans.variable} ${plexMono.variable} h-full`}
    >
      <body className="min-h-full">
        <div className="warp" aria-hidden />
        <div className="relative z-10">{children}</div>
      </body>
    </html>
  )
}
