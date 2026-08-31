import { ImageResponse } from 'next/og'

/**
 * The card that appears when the link is pasted into Telegram, Discord or X —
 * which is how a hackathon submission actually travels. Drawn here rather than
 * checked in as a PNG so it stays in step with the palette and the thesis.
 *
 * The motif is a board fragment: a field of immersion-gold pads on solder mask,
 * with dimension-line traces routing between them and one heavier gold trunk
 * running through the middle and leaving to the right. Many conductors, one
 * trunk, which is both the mark and the protocol constraint.
 *
 * It used to be a plain weave of gold over indigo, which was the right motif for
 * the world before this one and survived the palette change looking like graph
 * paper in new colours. A motif inherited from a replaced world is the cheapest
 * way to ship a redesign that did not happen.
 */
export const alt = 'Jalin — a programmable execution router for the STRK20 shielded pool'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

const GROUND = '#0b0e0d'
const WARP = '#26302c'
const WEFT = '#e0a53c'
const CLOTH = '#e9ece7'
const MUTED = '#9aa8a0'

const PITCH = 68
const PAD = 30
const COLS = 5
const ROWS = 5
const FIELD = (COLS - 1) * PITCH + PAD
const LEFT = 1200 - 72 - FIELD
const TOP = (630 - ((ROWS - 1) * PITCH + PAD)) / 2
const MID = Math.floor(ROWS / 2)

const at = (i: number) => i * PITCH

/**
 * Traces first, then pads on top of them, because on a board the copper is
 * continuous and the pad is where it opens through the mask. Painting the pads
 * last is what makes them read as contacts rather than as squares in a grid.
 */
function board() {
  const pieces = []

  for (let row = 0; row < ROWS; row += 1) {
    const trunk = row === MID
    pieces.push(
      <div
        key={`trace-${row}`}
        style={{
          position: 'absolute',
          left: LEFT,
          top: TOP + at(row) + (PAD - (trunk ? 8 : 2)) / 2,
          width: trunk ? FIELD + 72 : FIELD,
          height: trunk ? 8 : 2,
          background: trunk ? WEFT : WARP,
        }}
      />,
    )
  }

  for (let col = 0; col < COLS; col += 1) {
    pieces.push(
      <div
        key={`riser-${col}`}
        style={{
          position: 'absolute',
          left: LEFT + at(col) + (PAD - 2) / 2,
          top: TOP,
          width: 2,
          height: (ROWS - 1) * PITCH + PAD,
          background: WARP,
        }}
      />,
    )
  }

  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      // A pad is where a conductor is meant to be contacted, not every crossing.
      if (row !== MID && (row + col) % 2 !== 0) continue
      pieces.push(
        <div
          key={`pad-${row}-${col}`}
          style={{
            position: 'absolute',
            left: LEFT + at(col),
            top: TOP + at(row),
            width: PAD,
            height: PAD,
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
        {board()}

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
