/**
 * The key effects side by side: one piano per effect, all playing the same
 * notes. A page for choosing, not a part of the app.
 *
 * Nothing about the effects is written here. Every piano is the app's own
 * <Piano /> with the app's own stylesheet, and the notes go through the app's
 * own note bus and sound engine, so what a key does here is exactly what it
 * does in the app. The page starts from the player's saved settings (their
 * keys, their colour, their glow), and "Use in the app" saves the effect
 * there.
 */
import '../../src/styles/theme.css'
import './compare.css'
import { StrictMode, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { CSSProperties, JSX, MouseEvent as ReactMouseEvent } from 'react'
import { createRoot } from 'react-dom/client'
import { bus, engine } from '../../src/app/pianoApp'
import type { AudioStatus } from '../../src/audio/audioEngine'
import { inkOn, paletteFor } from '../../src/core/colour'
import { slotToMidi } from '../../src/core/layout'
import type { PianoRange } from '../../src/core/layout'
import { pitchClass } from '../../src/core/notes'
import type { AccentChoice, KeyEffect, KeyStyle, Midi } from '../../src/core/types'
import { keyLabel, useLayoutMap } from '../../src/input/keyLabels'
import { settingsStore, useSettings } from '../../src/state/settings'
import type { Settings } from '../../src/state/settings'
import { Piano } from '../../src/ui/Piano'
import { Segmented } from '../../src/ui/controls'
import {
  useAudioStatus,
  useKeyboardPiano,
  useNoStuckNotes,
  useSoundSettings,
} from '../../src/ui/hooks'

// ---------------------------------------------------------------------------
// What the page says about each effect
// ---------------------------------------------------------------------------

interface EffectCard {
  id: KeyEffect
  name: string
  /** One line, in plain words. */
  summary: string
}

/** In the order of the choice in Settings: the effect the app has always had first. */
const EFFECTS: readonly EffectCard[] = [
  {
    id: 'glow',
    name: 'Glow',
    summary: 'The key fills with light and glows onto its neighbours. The one the app started with.',
  },
  {
    id: 'press',
    name: 'Press',
    summary: 'The key goes down deep, in shade, with a little light near your finger.',
  },
  {
    id: 'edge',
    name: 'Edge',
    summary: 'Only the outline of the key and a line at its far end light up.',
  },
  {
    id: 'pop',
    name: 'Pop',
    summary: 'A short bright flash and a small bounce, then a quiet light.',
  },
]

/**
 * The effects on the page: all of them, or only the ones the address names
 * ("?show=glow,edge"), to look at a few of them closely.
 */
function effectsToShow(): readonly EffectCard[] {
  const asked = new URLSearchParams(window.location.search).get('show')?.split(',') ?? []
  const shown = EFFECTS.filter((effect) => asked.includes(effect.id))
  return shown.length > 0 ? shown : EFFECTS
}

const SHOWN = effectsToShow()

interface Fact {
  label: string
  values: Readonly<Record<KeyEffect, string>>
}

/** The table under the pianos: the same questions asked of every effect. */
const FACTS: readonly Fact[] = [
  {
    label: 'How much light',
    values: {
      glow: 'A lot',
      press: 'A little',
      edge: 'A little',
      pop: 'A lot for an instant, then some',
    },
  },
  {
    label: 'Where the light is',
    values: {
      glow: 'The whole key',
      press: 'Near your finger',
      edge: 'Around the key',
      pop: 'The whole key',
    },
  },
  {
    label: 'Glows onto the keys next to it',
    values: {
      glow: 'Yes',
      press: 'No',
      edge: 'A thin glow',
      pop: 'A flash, then a little',
    },
  },
  {
    label: 'How the key moves',
    values: {
      glow: 'Dips',
      press: 'Dips deep',
      edge: 'Dips',
      pop: 'Bounces, then barely down',
    },
  },
  {
    label: 'Letters on a played key',
    values: {
      glow: 'Change with the light',
      press: 'Keep their own colour',
      edge: 'Keep their own colour',
      pop: 'Keep their own colour',
    },
  },
  {
    label: 'Smoothness: quick notes and fast taps',
    values: { glow: '140 to 144', press: '144', edge: '144', pop: '143 to 144' },
  },
  {
    label: 'Smoothness: six notes at once, fast',
    values: { glow: '139 to 142', press: '142', edge: '141', pop: '138 to 142' },
  },
]

const KEY_STYLES: readonly KeyStyle[] = ['classic', 'midnight', 'glass']
const KEY_STYLE_OPTIONS: readonly { value: KeyStyle; label: string }[] = [
  { value: 'classic', label: 'Classic' },
  { value: 'midnight', label: 'Midnight' },
  { value: 'glass', label: 'Glass' },
]

const COLOUR_OPTIONS: readonly { value: AccentChoice; label: string }[] = [
  { value: 'red', label: 'Red' },
  { value: 'amber', label: 'Amber' },
  { value: 'blue', label: 'Blue' },
  { value: 'green', label: 'Green' },
  { value: 'purple', label: 'Purple' },
  { value: 'white', label: 'White' },
  { value: 'rainbow', label: 'Rainbow' },
  { value: 'custom', label: 'Yours' },
]
const COLOURS: readonly AccentChoice[] = COLOUR_OPTIONS.map((option) => option.value)

/** What the page says about the sound. Nothing once all is well. */
const SOUND_TEXT: Readonly<Record<AudioStatus, string | null>> = {
  idle: 'Click or press a key to start the sound.',
  loading: 'Loading piano sound…',
  ready: null,
  fallback: 'Using basic sound (piano sound could not be loaded).',
  error: 'Sound could not start. Click anywhere to try again.',
}

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

function ComparePage(): JSX.Element {
  const settings = useSettings()
  const layoutMap = useLayoutMap()
  const audioStatus = useAudioStatus()
  const held = useHeldNotes()

  // The look starts as the player has it in the app, or as the address asks.
  // Changing it here is for looking only: it is not saved.
  const [keyStyle, setKeyStyle] = useState(() => askedFor('style', KEY_STYLES, settings.keyStyle))
  const [accent, setAccent] = useState(() => askedFor('colour', COLOURS, settings.accent))

  const { bindings, customLabels, keyboardType, baseOctave } = settings
  const range = useMemo(() => rangeOfTheKeys(bindings, baseOctave), [bindings, baseOctave])
  const keyLabels = useMemo(() => {
    const labels = new Map<number, string>()
    for (const [code, slot] of Object.entries(bindings)) {
      labels.set(slot, keyLabel(code, layoutMap, customLabels, keyboardType))
    }
    return labels
  }, [bindings, customLabels, layoutMap, keyboardType])

  const demo = useDemo(range.first)

  useSoundSettings(settings)
  useKeyboardPiano(leaveEveryKeyToThePiano)
  useNoStuckNotes(baseOctave, range)
  useSoundStartsAtTheFirstGesture()

  const soundText = SOUND_TEXT[audioStatus]

  return (
    <main
      className="fx-page"
      style={lightVariables(accent, settings.customColour, settings.glow)}
      onClick={giveKeyboardBackToThePianos}
    >
      <header className="fx-head">
        <div className="fx-head__words">
          <h1 className="fx-title">Key effects, side by side</h1>
          <p className="fx-lead">
            Press the keys shown on the pianos, or click a key. All the pianos play the same note,
            each with its own effect.
          </p>
        </div>
        <div className="fx-controls">
          <span className="fx-control">
            <span className="fx-control__name">Key style</span>
            <Segmented
              value={keyStyle}
              options={KEY_STYLE_OPTIONS}
              onChange={(style) => setKeyStyle(style)}
            />
          </span>
          <span className="fx-control">
            <span className="fx-control__name">Colour</span>
            <Segmented
              value={accent}
              options={COLOUR_OPTIONS}
              onChange={(colour) => setAccent(colour)}
            />
          </span>
          <button
            type="button"
            className={demo.playing ? 'button' : 'button button--primary'}
            aria-pressed={demo.playing}
            onClick={demo.toggle}
          >
            {demo.playing ? 'Stop the demo' : 'Play a demo'}
          </button>
        </div>
      </header>

      <p className="fx-status" role="status">
        {soundText}
        {settings.sustain && (
          <span className="fx-status__badge">Sustain on (Space turns it off)</span>
        )}
      </p>

      <div
        className="fx-grid"
        style={{ '--fx-columns': Math.min(SHOWN.length, 4) } as CSSProperties}
      >
        {SHOWN.map((effect) => (
          <section key={effect.id} className="fx-card" aria-label={effect.name}>
            <header className="fx-card__head">
              <h2 className="fx-card__name">{effect.name}</h2>
              <p className="fx-card__summary">{effect.summary}</p>
              {settings.keyEffect === effect.id ? (
                <span className="fx-card__now">In the app now</span>
              ) : (
                <button
                  type="button"
                  className="button fx-card__use"
                  onClick={() => settingsStore.set({ keyEffect: effect.id })}
                >
                  Use in the app
                </button>
              )}
            </header>
            <div className="fx-card__stage">
              {/* A strip of the sky, with the line of light the piano sits under in the app. */}
              <div className="fx-card__sky" aria-hidden="true">
                <div className="fx-card__line" />
              </div>
              <Piano
                range={range}
                baseOctave={baseOctave}
                activeNotes={held}
                labelMode={settings.labelMode}
                noteNaming={settings.noteNaming}
                keyLabels={keyLabels}
                keyStyle={keyStyle}
                keyEffect={effect.id}
                accent={accent}
                customColour={settings.customColour}
                onNoteDown={pressWithTheMouse}
                onNoteUp={letGoWithTheMouse}
              />
            </div>
          </section>
        ))}
      </div>

      <section className="fx-facts" aria-labelledby="fx-facts-title">
        <h2 id="fx-facts-title" className="fx-facts__title">
          At a glance
        </h2>
        <div className="fx-facts__scroll">
          <table className="fx-table">
            <thead>
              <tr>
                <td />
                {SHOWN.map((effect) => (
                  <th key={effect.id} scope="col">
                    {effect.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {FACTS.map((fact) => (
                <tr key={fact.label}>
                  <th scope="row">{fact.label}</th>
                  {SHOWN.map((effect) => (
                    <td key={effect.id}>{fact.values[effect.id]}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="fx-facts__note">
          Smoothness is in pictures per second, in Firefox on a screen that shows 144 a second, with
          the full piano of 88 keys. 144 is the most there can be. It was measured in a few short runs
          while the computer was in use, so the numbers are rough.
        </p>
      </section>
    </main>
  )
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

function subscribeToNotes(onChange: () => void): () => void {
  return bus.subscribe(onChange)
}

function heldNotes(): ReadonlySet<Midi> {
  return bus.getActiveNotes()
}

/** The notes held right now, whatever is holding them. A new set whenever they change. */
function useHeldNotes(): ReadonlySet<Midi> {
  return useSyncExternalStore(subscribeToNotes, heldNotes, heldNotes)
}

function pressWithTheMouse(midi: Midi): void {
  bus.noteOn(midi, 'pointer', { velocity: settingsStore.get().velocity })
}

function letGoWithTheMouse(midi: Midi): void {
  bus.noteOff(midi, 'pointer')
}

/** Every key press is the piano's: the page has nothing to do with the keyboard itself. */
function leaveEveryKeyToThePiano(): boolean {
  return false
}

/**
 * The notes the pianos show: whole octaves around the notes the player's
 * computer keys play, and never fewer than two octaves. The fewer keys, the
 * bigger they are drawn, and the closer to their size in the app.
 */
function rangeOfTheKeys(bindings: Settings['bindings'], baseOctave: number): PianoRange {
  const slots = Object.values(bindings)
  const lowest = slotToMidi(slots.length > 0 ? Math.min(...slots) : 12, baseOctave)
  const highest = slotToMidi(slots.length > 0 ? Math.max(...slots) : 29, baseOctave)
  // From the C at or below the lowest note to the B at or above the highest.
  const first = lowest - pitchClass(lowest)
  const reach = Math.max(highest, first + 23)
  const last = reach + (11 - pitchClass(reach))
  return { first, last }
}

// ---------------------------------------------------------------------------
// The demo: the same short piece on every piano, again and again
// ---------------------------------------------------------------------------

interface DemoStep {
  /** Milliseconds from the start of the piece. */
  at: number
  /** The note, counted in keys up from the lowest C the pianos show. */
  key: number
  on: boolean
}

interface DemoPiece {
  steps: readonly DemoStep[]
  /** How long one time through lasts, with the rest at the end. */
  length: number
}

/**
 * Slow notes, a quick run over white and black keys, one note tapped fast,
 * and two chords held: what shows how the effects differ.
 */
function demoPiece(): DemoPiece {
  const steps: DemoStep[] = []
  let at = 300
  const play = (key: number, length: number): void => {
    steps.push({ at, key, on: true }, { at: at + length, key, on: false })
  }

  for (const key of [0, 4, 7, 12]) {
    play(key, 420)
    at += 560
  }
  at += 250
  for (const key of [0, 2, 4, 6, 7, 9, 10, 12, 10, 9, 7, 6, 4, 2, 0]) {
    play(key, 70)
    at += 105
  }
  at += 350
  for (let tap = 0; tap < 8; tap++) {
    play(7, 45)
    at += 95
  }
  at += 400
  for (const chord of [
    [0, 4, 7, 12],
    [1, 6, 10, 13],
  ]) {
    for (const key of chord) play(key, 1400)
    at += 1750
  }
  return { steps, length: at + 400 }
}

const DEMO = demoPiece()

interface Demo {
  playing: boolean
  toggle(): void
}

/** Plays the demo over and over, from the lowest C of the pianos, until it is stopped. */
function useDemo(firstNote: Midi): Demo {
  const [playing, setPlaying] = useState(false)
  const timers = useRef<number[]>([])

  useEffect(() => {
    if (!playing) return
    const velocity = settingsStore.get().velocity
    const playOnce = (): void => {
      timers.current = DEMO.steps.map((step) =>
        window.setTimeout(() => {
          if (step.on) bus.noteOn(firstNote + step.key, 'playback', { velocity })
          else bus.noteOff(firstNote + step.key, 'playback')
        }, step.at),
      )
      timers.current.push(window.setTimeout(playOnce, DEMO.length))
    }
    playOnce()
    return () => {
      for (const timer of timers.current) window.clearTimeout(timer)
      timers.current = []
      bus.allOff('playback')
    }
  }, [playing, firstNote])

  return { playing, toggle: () => setPlaying((now) => !now) }
}

// ---------------------------------------------------------------------------
// Small things
// ---------------------------------------------------------------------------

/** The choice named in the page's address ("?style=glass"), or `fallback` when it names none of them. */
function askedFor<Choice extends string>(
  name: string,
  choices: readonly Choice[],
  fallback: Choice,
): Choice {
  const asked = new URLSearchParams(window.location.search).get(name)
  return choices.find((choice) => choice === asked) ?? fallback
}

/** The colour of the light and how strongly it glows, as the variables the stylesheets read. */
function lightVariables(accent: AccentChoice, customColour: string, glow: number): CSSProperties {
  const palette = paletteFor(accent, customColour)
  return {
    '--light': palette.light,
    '--light-bright': palette.bright,
    '--light-deep': palette.deep,
    '--light-ink': inkOn(palette.light),
    '--glow': glow,
  } as CSSProperties
}

/**
 * Browsers only let sound start from a click or a key press: the first one
 * starts it, and so does a later one after an attempt that failed.
 */
function useSoundStartsAtTheFirstGesture(): void {
  useEffect(() => {
    const wake = (): void => {
      if (navigator.userActivation?.hasBeenActive === false) return
      const status = engine.getStatus()
      if (status === 'idle' || status === 'error') void engine.start()
    }
    window.addEventListener('pointerdown', wake)
    window.addEventListener('keydown', wake)
    return () => {
      window.removeEventListener('pointerdown', wake)
      window.removeEventListener('keydown', wake)
    }
  }, [])
}

/**
 * A button that was clicked with the mouse would keep the keyboard, and Space
 * (sustain) would press it again. It lets go, as in the app. Someone working
 * with the keyboard alone keeps their place.
 */
function giveKeyboardBackToThePianos(event: ReactMouseEvent): void {
  if (event.detail === 0) return
  const focused = document.activeElement
  if (focused instanceof HTMLElement && focused.matches('button')) focused.blur()
}

const container = document.getElementById('root')
if (!container) throw new Error('The page has no element with id "root" to draw in.')

createRoot(container).render(
  <StrictMode>
    <ComparePage />
  </StrictMode>,
)
