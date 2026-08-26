import { ImageResponse } from 'next/og'

/**
 * The card that appears when the link is pasted into Telegram, Discord or X —
 * which is how a hackathon submission actually travels. Drawn here rather than
 * checked in as a PNG so it stays in step with the palette and the thesis.
 *
 * The motif is a real interlace, not a grid. A grid is what you get if every
 * horizontal simply sits on top of every vertical, and it reads as graph paper.
 * Cloth alternates: at each crossing one strand passes over and the neighbour
 * passes under. That alternation is the whole idea of the project, so the card
 * has to actually do it rather than gesture at it.
 */
export const alt = 'Jalin — a programmable execution router for the STRK20 shielded pool'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

const GROUND = '#101423'
const WARP = '#2f3a5c'
const WEFT = '#c9a227'
const CLOTH = '#e6e2d8'
const MUTED = '#8b93ad'

const BANDS = 5
const THICK = 48
const GAP = 34
const SPAN = BANDS * THICK + (BANDS - 1) * GAP
const LEFT = 1200 - 72 - SPAN
const TOP = (630 - SPAN) / 2

const at = (i: number) => i * (THICK + GAP)

/**
 * Paint order is the whole trick. Wefts first, then warps over them, then the
 * weft is redrawn only at the crossings where it should be the one on top.
 */
function weave() {
  const pieces = []

  for (let row = 0; row < BANDS; row += 1) {
    pieces.push(
      <div
        key={`weft-${row}`}
        style={{
          position: 'absolute',
          left: LEFT,
          top: TOP + at(row),
          width: SPAN,
          height: THICK,
          background: WEFT,
        }}
      />,
    )
  }

  for (let col = 0; col < BANDS; col += 1) {
    pieces.push(
      <div
        key={`warp-${col}`}
        style={{
          position: 'absolute',
          left: LEFT + at(col),
          top: TOP,
          width: THICK,
          height: SPAN,
          background: WARP,
        }}
      />,
    )
  }

  for (let row = 0; row < BANDS; row += 1) {
    for (let col = 0; col < BANDS; col += 1) {
      if ((row + col) % 2 !== 0) continue
      pieces.push(
        <div
          key={`over-${row}-${col}`}
          style={{
            position: 'absolute',
            left: LEFT + at(col),
            top: TOP + at(row),
            width: THICK,
            height: THICK,
            background: WEFT,
          }}
        />,
      )
    }
  }

  return pieces
}

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          background: GROUND,
          padding: 72,
          position: 'relative',
        }}
      >
        {weave()}

        <div style={{ display: 'flex', flexDirection: 'column', width: 640 }}>
          <div style={{ fontSize: 112, fontWeight: 800, color: CLOTH, letterSpacing: -4 }}>
            jalin
          </div>
          <div style={{ fontSize: 32, color: MUTED, marginTop: 12, lineHeight: 1.35 }}>
            A programmable execution router for the STRK20 shielded pool.
          </div>
          <div style={{ fontSize: 28, color: WEFT, marginTop: 36, lineHeight: 1.35 }}>
            One invoke per transaction. So the composition moves inside it.
          </div>
          <div style={{ fontSize: 22, color: MUTED, marginTop: 36 }}>starknet mainnet</div>
        </div>
      </div>
    ),
    size,
  )
}
