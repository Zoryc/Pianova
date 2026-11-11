import { useEffect, useRef } from 'react'
import type { JSX } from 'react'
import type { PianoRange } from '../../core/layout'
import type { NoteBus } from '../../core/noteBus'
import type {
  AccentChoice,
  BackgroundName,
  BarStyle,
  Midi,
  SparksLevel,
} from '../../core/types'
import type { PlayableNote } from '../../songs/song'
import { runSky } from './skyRunner'
import type { SkyRunner } from './skyRunner'
import './sky.css'

export interface SkyProps {
  bus: NoteBus
  range: PianoRange
  /** Light bars on/off (the `showTrails` setting). */
  showBars: boolean
  barStyle: BarStyle
  sparks: SparksLevel
  /** 0..1 */
  glow: number
  background: BackgroundName
  accent: AccentChoice
  customColour: string
  /** While a song is loaded: where its falling notes come from. Null in free play. */
  falling: FallingSource | null
  /** Note -> label of the computer key that plays it, for the letters on falling bars. Empty when hints are off. */
  hints: ReadonlyMap<Midi, string>
}

export interface FallingSource {
  /** Sorted by time. Same array until the arrangement changes. */
  getNotes(): readonly PlayableNote[]
  /** Seconds into the song, right now. */
  getPosition(): number
  /** True while the song is advancing. */
  isPlaying(): boolean
}

/**
 * The sky above the piano: one canvas on which all the light is drawn (the
 * bars that rise from the keys, the notes of a song that fall onto them,
 * sparks, and the background). Purely decorative. It listens to the bus
 * itself and draws frame by frame, so React never re-renders while light is
 * moving.
 *
 * The parent gives the canvas its box. The bottom edge of that box must be
 * the top edge of the piano, with the same width and left edge, so that the
 * light lines up with the keys.
 */
export function Sky(props: SkyProps): JSX.Element {
  const { bus, ...scene } = props
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const runnerRef = useRef<SkyRunner | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const runner = canvas ? runSky(canvas, bus) : null
    runnerRef.current = runner
    return () => {
      runnerRef.current = null
      runner?.stop()
    }
  }, [bus])

  // After every render, on purpose: the runner compares what it is shown with
  // what it had, keeps the light that is in the air, and redraws only for a real change.
  useEffect(() => {
    runnerRef.current?.show(scene)
  })

  return <canvas ref={canvasRef} className="sky" aria-hidden="true" />
}
