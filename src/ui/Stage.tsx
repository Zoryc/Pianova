import {
  useCallback,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import type { JSX, RefObject } from 'react'
import type { AudioStatus } from '../audio/audioEngine'
import { pianoRange, resolvePianoSize } from '../core/layout'
import type { PianoRange, PianoSize } from '../core/layout'
import type { NoteBus } from '../core/noteBus'
import { noteName } from '../core/notes'
import type { Midi, NoteNaming } from '../core/types'
import type { Settings } from '../state/settings'
import { Piano } from './Piano'
import { formatSigned } from './format'
import { labelModeWhileEditing } from './keyEditorModel'
import { Sky } from './sky/Sky'
import type { FallingSource } from './sky/Sky'
import './stage.css'

export interface StageProps {
  /** The stage's own id, and what it is called: the way of playing that is on ("Free Play"). */
  id: string
  label: string
  /** Where the notes come from: the keys that are lit and the light in the sky follow it. */
  bus: NoteBus
  settings: Settings
  /** slot -> label of the computer key that plays it (the keycaps on the piano). */
  keyLabels: ReadonlyMap<number, string>
  /** Note -> label of the computer key that plays it, for the letters on falling notes. */
  hints: ReadonlyMap<Midi, string>
  /** The falling notes of the loaded song. Null in free play. */
  falling: FallingSource | null
  audioStatus: AudioStatus
  /**
   * Whether to say how to play, until the first note. Off while the start
   * box is open, and while the computer keys are being chosen, where a click on
   * the piano does something else.
   */
  showHint: boolean
  /** While the computer keys are being chosen: a click on a piano key selects it. */
  editMode: boolean
  selectedSlot: number | null
  onSelectSlot(slot: number): void
  /** The mouse pressed / released a piano key. */
  onNoteDown(midi: Midi): void
  onNoteUp(midi: Midi): void
  /** The piano on screen shows other notes than before (also called for the first piano). */
  onRangeChange(range: PianoRange): void
  /** The sky was clicked where nothing is. */
  onSkyClick(): void
}

/** What the stage says about the sound. Nothing while all is well. */
const SOUND_STATUS_TEXT: Readonly<Record<AudioStatus, string | null>> = {
  idle: null,
  loading: 'Loading piano sound…',
  ready: null,
  fallback: 'Using basic sound (piano sound could not be loaded).',
  error: 'Sound could not start. Click anywhere to try again.',
}

/** The most note names written above the piano. The rest are counted: "+3". */
const MAX_NOTE_NAMES = 8

/**
 * The stage: the sky with all its light, the light line, and the piano under
 * it. It decides which piano is drawn (how many keys fit the window, which
 * notes they are) and gives the same answer to the piano and to the sky, so
 * that the light always lines up with the keys.
 *
 * A few quiet words float over the sky: how to play (until the first note),
 * the names of the notes being played, and what the sound is doing when that
 * is worth saying (its status, and a badge while the piano is transposed or
 * sustain is on, so that the player knows why notes sound different).
 *
 * How the sky and the piano share the window is in stage.css.
 */
export function Stage(props: StageProps): JSX.Element {
  const { bus, settings, falling, editMode } = props
  const stage = useRef<HTMLDivElement>(null)
  const activeNotes = useHeldNotes(bus)
  const hasPlayed = useHasPlayed(activeNotes)

  const fittingSize = useFittingPianoSize(stage)
  const size = settings.pianoSize === 'auto' ? fittingSize : settings.pianoSize
  // The same object for the same piano, so it can be compared with ===.
  const range = pianoRange(size, settings.baseOctave)
  const reportRange = useEffectEvent(props.onRangeChange)
  // In braces: what the function gives back must not reach React, which
  // would take it for a clean-up to run later.
  useLayoutEffect(() => {
    reportRange(range)
  }, [range])

  const showHint = props.showHint && !hasPlayed
  const showNoteNames = settings.showNoteNames && falling === null && activeNotes.size > 0
  const soundStatus = SOUND_STATUS_TEXT[props.audioStatus]

  return (
    <div
      ref={stage}
      id={props.id}
      className={settings.autoHideMenu ? 'stage' : 'stage stage--below-menu'}
      role="region"
      aria-label={props.label}
    >
      <div className="stage__sky" onClick={props.onSkyClick}>
        <Sky
          bus={bus}
          range={range}
          showBars={settings.showTrails}
          barStyle={settings.barStyle}
          sparks={settings.sparks}
          glow={settings.glow}
          background={settings.background}
          accent={settings.accent}
          customColour={settings.customColour}
          falling={falling}
          hints={props.hints}
        />
        <p className={showHint ? 'stage__hint' : 'stage__hint stage__hint--gone'}>
          Press the keys shown on the piano, or click it
        </p>
        <div className="stage__foot">
          <div className="stage__sound">
            {/* Always present, so that screen readers announce the status when it changes. */}
            <span className="stage__status" role="status" data-status={props.audioStatus}>
              {soundStatus}
            </span>
            {settings.transpose !== 0 && (
              <span className="stage__badge">Transposed {formatSigned(settings.transpose)}</span>
            )}
            {/* Space switches sustain without showing the menu: this is the sign that stays. */}
            {settings.sustain && <span className="stage__badge">Sustain on</span>}
          </div>
          {showNoteNames && <NoteNames notes={activeNotes} naming={settings.noteNaming} />}
        </div>
        <div className="stage__line" aria-hidden="true" />
      </div>

      <div className="stage__piano">
        <Piano
          range={range}
          baseOctave={settings.baseOctave}
          activeNotes={activeNotes}
          labelMode={editMode ? labelModeWhileEditing(settings.labelMode) : settings.labelMode}
          noteNaming={settings.noteNaming}
          keyLabels={props.keyLabels}
          keyStyle={settings.keyStyle}
          keyEffect={settings.keyEffect}
          accent={settings.accent}
          customColour={settings.customColour}
          onNoteDown={props.onNoteDown}
          onNoteUp={props.onNoteUp}
          editMode={editMode}
          selectedSlot={props.selectedSlot}
          onSelectSlot={props.onSelectSlot}
        />
      </div>
    </div>
  )
}

interface NoteNamesProps {
  notes: ReadonlySet<Midi>
  naming: NoteNaming
}

/** The names of the notes being held, lowest first. One line however many there are. */
function NoteNames({ notes, naming }: NoteNamesProps): JSX.Element {
  const held = [...notes].sort((a, b) => a - b)
  const named = held.slice(0, MAX_NOTE_NAMES)
  const more = held.length - named.length

  return (
    <ul className="stage__notes" aria-label="Notes being played">
      {named.map((midi) => (
        <li key={midi} className="stage__note">
          {noteName(midi, naming)}
        </li>
      ))}
      {more > 0 && <li className="stage__note">+{more}</li>}
    </ul>
  )
}

/** The notes held right now, whatever is holding them. A new set whenever they change. */
function useHeldNotes(bus: NoteBus): ReadonlySet<Midi> {
  const subscribe = useCallback((onChange: () => void) => bus.subscribe(onChange), [bus])
  const heldNotes = useCallback(() => bus.getActiveNotes(), [bus])
  return useSyncExternalStore(subscribe, heldNotes, heldNotes)
}

/** False until the first note is played, by anyone; true from then on. */
function useHasPlayed(activeNotes: ReadonlySet<Midi>): boolean {
  const [hasPlayed, setHasPlayed] = useState(false)
  // Set while drawing: React draws again at once, before anything is shown.
  if (!hasPlayed && activeNotes.size > 0) setHasPlayed(true)
  return hasPlayed
}

/**
 * The piano the "Auto" size stands for: the largest one whose keys are still
 * comfortably wide on a stage as wide as this one is now. The stage is
 * measured before it is first shown, so the piano never appears at one size
 * and jumps to another. Until then (and where nothing can be measured) it is
 * the smallest piano.
 */
function useFittingPianoSize(stage: RefObject<HTMLElement | null>): PianoSize {
  const [size, setSize] = useState(() => resolvePianoSize('auto', 0))

  useLayoutEffect(() => {
    const element = stage.current
    if (!element) return
    const measure = (): void => {
      setSize(resolvePianoSize('auto', element.getBoundingClientRect().width))
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [stage])

  return size
}
