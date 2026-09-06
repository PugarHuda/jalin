import {
  AbsoluteFill,
  Audio,
  OffthreadVideo,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion'
import timed from '../../timed.json'
import marksFile from '../../marks.json'
import cuesFile from '../../cues.json'

/**
 * The demo, composed.
 *
 * Three things are laid over the footage, and each is measured rather than
 * authored: the voiceover `tts.py` generated, subtitles built from the word
 * timings that came back with it, and pointer boxes whose coordinates the
 * recorder read off the real DOM while the page was holding still.
 *
 * Nothing here decides *when* anything happens. A subtitle line appears when
 * the speech synthesiser says its first word, and a pointer box appears when
 * the narration reaches the phrase it belongs to. Edit the script and both
 * follow; there is no second place to keep in sync.
 */

export const FPS = 30

/**
 * Playwright starts recording before the page has painted, so the first frames
 * of every clip are a white flash. Measured at 0.2s of white and 1.0s to the
 * painted page; a second is dropped from the head of each clip.
 */
const HEAD_SECONDS = 0.95

/** How long a pointer box stays up once the narration has introduced it. */
const MARK_SECONDS = 3.4

interface Cue {
  t: number
  d: number
  w: string
}

interface Mark {
  cue: string
  label: string
  x: number
  y: number
  w: number
  h: number
}

interface Measured {
  id: string
  settledAt: number
  marks: Mark[]
}

interface Scene {
  id: string
  text: string
  duration: number
}

const scenes = timed as Scene[]
const measured = marksFile as Measured[]

/**
 * Word cues for a scene.
 *
 * From one aggregate file rather than ten imports or a glob: Remotion bundles
 * with webpack, which cannot glob a directory the way Vite can, and ten
 * explicit imports would need editing every time the script gains a scene.
 * `tts.py` writes this alongside the audio it timed.
 */
const allCues = cuesFile as Record<string, Cue[]>
const cuesFor = (id: string): Cue[] => allCues[id] ?? []

export const totalFrames = Math.round(
  scenes.reduce((total, scene) => total + scene.duration, 0) * FPS,
)

/**
 * Word cues grouped into readable lines.
 *
 * One word at a time is technically accurate and unreadable: the eye lands on a
 * flicker rather than on a phrase. Lines cap at a length that fits the frame at
 * this type size, and each line lives from its first word to the end of its
 * last one.
 */
function lines(cues: Cue[]): { from: number; to: number; text: string }[] {
  const out: { from: number; to: number; text: string }[] = []
  let current: Cue[] = []
  const flush = () => {
    if (current.length === 0) return
    const text = current.map((c) => c.w).join(' ').replace(/\s+([,.?:;])/g, '$1')
    out.push({ from: current[0]!.t, to: current.at(-1)!.t + current.at(-1)!.d, text })
    current = []
  }

  for (const cue of cues) {
    current.push(cue)
    const text = current.map((c) => c.w).join(' ')
    // Break on a sentence end as well as on length: a line that runs past a
    // full stop reads as one thought when it is two.
    if (text.length >= 52 || /[.?!]$/.test(cue.w.trim())) flush()
  }
  flush()
  return out
}

const Subtitle: React.FC<{ text: string }> = ({ text }) => (
  <div
    style={{
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 64,
      display: 'flex',
      justifyContent: 'center',
    }}
  >
    <div
      style={{
        maxWidth: 1400,
        padding: '14px 28px',
        borderRadius: 8,
        background: 'rgba(10, 10, 12, 0.82)',
        color: '#f4f1ea',
        font: '500 38px/1.3 "Segoe UI", system-ui, sans-serif',
        textAlign: 'center',
        letterSpacing: 0.2,
      }}
    >
      {text}
    </div>
  </div>
)

/**
 * A box around the thing being talked about.
 *
 * The rectangle is a fraction of the viewport, measured by the recorder, so it
 * scales to the frame without knowing anything about the page's zoom. It grows
 * in on a spring rather than appearing, because a box that blinks into
 * existence reads as a rendering glitch.
 */
const Pointer: React.FC<{ mark: Mark; localFrame: number }> = ({ mark, localFrame }) => {
  const { fps, width, height } = useVideoConfig()
  const grow = spring({ frame: localFrame, fps, config: { damping: 200 }, durationInFrames: 12 })
  const fade = interpolate(
    localFrame,
    [0, 8, MARK_SECONDS * fps - 10, MARK_SECONDS * fps],
    [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  )

  const pad = 12
  const box = {
    left: mark.x * width - pad,
    top: mark.y * height - pad,
    width: mark.w * width + pad * 2,
    height: mark.h * height + pad * 2,
  }
  // Label above the box, unless the box is near the top of the frame.
  const labelBelow = box.top < 90

  return (
    <AbsoluteFill style={{ opacity: fade }}>
      <div
        style={{
          position: 'absolute',
          ...box,
          border: '4px solid #e8b530',
          borderRadius: 10,
          boxShadow: '0 0 0 9999px rgba(8, 8, 10, 0.34)',
          transform: `scale(${0.96 + grow * 0.04})`,
          transformOrigin: 'center',
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: Math.max(24, box.left),
          top: labelBelow ? box.top + box.height + 14 : box.top - 58,
          padding: '8px 16px',
          borderRadius: 6,
          background: '#e8b530',
          color: '#141414',
          font: '600 30px/1 "Segoe UI", system-ui, sans-serif',
        }}
      >
        {mark.label}
      </div>
    </AbsoluteFill>
  )
}

const SceneClip: React.FC<{ scene: Scene }> = ({ scene }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const seconds = frame / fps

  const cues = cuesFor(scene.id)
  const line = lines(cues).find((l) => seconds >= l.from && seconds <= l.to + 0.12)

  const found = measured.find((m) => m.id === scene.id)
  const settled = found?.settledAt ?? 0

  return (
    <AbsoluteFill style={{ backgroundColor: '#0a0a0c' }}>
      <OffthreadVideo
        src={staticFile(`clips/${scene.id}.webm`)}
        startFrom={Math.round(HEAD_SECONDS * fps)}
        muted
      />
      <Audio src={staticFile(`audio/${scene.id}.mp3`)} />

      {(found?.marks ?? []).map((mark) => {
        /**
         * When the box is shown.
         *
         * Every rectangle is measured with the page holding still at the end of
         * its shot, so the box is correct from `settledAt` onwards and the
         * narration is free to lead it. Measuring mid-shot was tried and
         * removed: the recorder's wall clock and the video's clock do not agree
         * — Playwright starts the file before the navigation finishes — so a
         * box timed from one and drawn on the other framed an empty strip of
         * background. A scene that needs to point at two things is two scenes.
         *
         * `HEAD_SECONDS` comes off because the clip is trimmed at the head.
         */
        const cue = cues.find((c) =>
          c.w.toLowerCase().includes(mark.cue.split(' ')[0]!.toLowerCase()),
        )
        const at = Math.max(cue?.t ?? settled, settled - HEAD_SECONDS)
        const local = seconds - at
        if (local < 0 || local > MARK_SECONDS) return null
        return <Pointer key={mark.label} mark={mark} localFrame={local * fps} />
      })}

      {line && <Subtitle text={line.text} />}
    </AbsoluteFill>
  )
}

export const Demo: React.FC = () => {
  let from = 0
  return (
    <AbsoluteFill style={{ backgroundColor: '#0a0a0c' }}>
      {scenes.map((scene) => {
        const durationInFrames = Math.round(scene.duration * FPS)
        const sequence = (
          <Sequence key={scene.id} from={from} durationInFrames={durationInFrames}>
            <SceneClip scene={scene} />
          </Sequence>
        )
        from += durationInFrames
        return sequence
      })}
    </AbsoluteFill>
  )
}
