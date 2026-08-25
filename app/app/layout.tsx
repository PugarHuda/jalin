import type { Metadata } from 'next'
import { Bricolage_Grotesque, IBM_Plex_Mono, IBM_Plex_Sans } from 'next/font/google'
import './globals.css'

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

export const metadata: Metadata = {
  title: 'Jalin',
  description:
    'A programmable execution router for the STRK20 shielded pool. The pool allows one invoke per transaction, so Jalin weaves the whole plan inside it.',
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
