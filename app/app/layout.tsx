import type { Metadata } from 'next'
import { Archivo, Azeret_Mono } from 'next/font/google'
import './globals.css'
import { SITE } from '@/lib/config'
import { Hydrated } from './hydrated'

/*
 * A fabrication drawing letters everything in one system, so this world has one
 * family for the legend and one for the drill table, not three faces.
 *
 * Archivo carries the silkscreen legend: a grotesque with an industrial spine,
 * variable so the display weight and the caption weight are the same drawing at
 * two masses. Azeret Mono sets every figure the chain or the wallet hands back -
 * engineered rather than editorial, and its numerals hold a column.
 *
 * The faces that were here, Bricolage and IBM Plex, are on the list of defaults
 * Impeccable names as the sign you stopped looking. They were replaced for that
 * reason, not for taste.
 */
const legend = Archivo({
  variable: '--font-legend',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
})

const drill = Azeret_Mono({
  variable: '--font-drill',
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
      className={`${legend.variable} ${drill.variable} h-full`}
    >
      <body className="min-h-full">
        <Hydrated />
        <div className="warp" aria-hidden />
        <div className="relative z-10">{children}</div>
      </body>
    </html>
  )
}
