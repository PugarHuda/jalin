import { Composition } from 'remotion'
import { Demo, FPS, totalFrames } from './Demo'

/**
 * One composition, sized to the footage.
 *
 * The length is not a constant here: it is the sum of the voiceover durations
 * that `tts.py` measured, so a script edit changes the video's length without
 * anyone remembering to change a number.
 */
export const RemotionRoot: React.FC = () => (
  <Composition
    id="Demo"
    component={Demo}
    durationInFrames={totalFrames}
    fps={FPS}
    width={1920}
    height={1080}
  />
)
