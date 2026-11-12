import { memo, useEffect, useId, useLayoutEffect, useRef } from 'react'
import type { CSSProperties, FocusEvent, JSX, RefObject } from 'react'
import { player } from '../app/songsApp'
import { MAX_SPEED, MIN_SPEED, formatDuration, instrumentName } from '../songs/song'
import type { SongPlayOptions, SongTrack } from '../songs/song'
import { Field, Switch } from './controls'
import { formatPercent, toPercent } from './format'
import {
  changeSongOptions,
  closeSong,
  closeSongOptions,
  openSongOptions,
  useLoadedSong,
  usePlayerState,
  useSongOptionsOpen,
} from './useSongs'
import type { LoadedSong } from './useSongs'
import './songs.css'

/** The speed slider moves in steps of this many percent. */
const SPEED_STEP = 5

/** The shapes of the three icons, drawn in a square of 16 by 16. Restart is a bar with an arrow pointing back at it. */
const PLAY_ICON = 'M4 2.5v11l9-5.5z'
const PAUSE_ICON = 'M3.5 2.5h3v11h-3zm6 0h3v11h-3z'
const RESTART_ICON = 'M3 2.5h2v11H3zM13 2.5v11L5.5 8z'

/**
 * Takes the song back to its beginning, where it waits: "Play" starts it
 * again from there. The button is named for where the song goes, not "Stop":
 * next to "Pause" and "Close", a button that stops was one too many to tell apart.
 */
function restart(): void {
  player.stop()
}

/**
 * The line of controls for the song in the player: play, pause, restart, where
 * the song is, how fast it goes, and its options. Nothing when no song is loaded.
 */
export function PlayerLine(): JSX.Element | null {
  const loaded = useLoadedSong()
  return loaded === null ? null : <LoadedPlayerLine loaded={loaded} />
}

function LoadedPlayerLine({ loaded }: { loaded: LoadedSong }): JSX.Element {
  const state = usePlayerState()
  // Kept with the song, not here: Escape closes the options from the app
  // shell, and every song starts with them closed (see useSongs.ts).
  const optionsOpen = useSongOptionsOpen()
  const optionsId = useId()
  const line = useRef<HTMLElement>(null)
  const optionsButton = useRef<HTMLButtonElement>(null)

  // Like a menu, the options go away at a press of the mouse anywhere else, so
  // that they are never left hanging over a panel that is opened next. A file
  // dropped on the page opens the Songs panel without any press: they go then too.
  useEffect(() => {
    if (!optionsOpen) return
    const closeWhenPressedOutside = (event: PointerEvent): void => {
      if (event.target instanceof Node && !line.current?.contains(event.target)) {
        closeSongOptions()
      }
    }
    const closeWhenDropped = (): void => {
      closeSongOptions()
    }
    window.addEventListener('pointerdown', closeWhenPressedOutside)
    window.addEventListener('drop', closeWhenDropped)
    return () => {
      window.removeEventListener('pointerdown', closeWhenPressedOutside)
      window.removeEventListener('drop', closeWhenDropped)
    }
  }, [optionsOpen])

  /** The same for the keyboard: they go away when Tab moves on to a control outside the line. */
  function closeWhenFocusMovesOut(event: FocusEvent<HTMLElement>): void {
    const movedTo = event.relatedTarget
    if (movedTo !== null && !event.currentTarget.contains(movedTo)) closeSongOptions()
  }

  const playing = state.status === 'playing'
  return (
    <section
      ref={line}
      className="player-line"
      aria-label="Song player"
      onBlur={closeWhenFocusMovesOut}
    >
      <div className="player-line__controls">
        <button
          type="button"
          className="button button--primary"
          onClick={() => (playing ? player.pause() : player.play())}
        >
          <Icon shape={playing ? PAUSE_ICON : PLAY_ICON} />
          {playing ? 'Pause' : 'Play'}
        </button>
        <button type="button" className="button" onClick={restart}>
          <Icon shape={RESTART_ICON} />
          Restart
        </button>
        <span className="player-line__title" title={state.title}>
          {state.title}
        </span>
        <PositionSlider position={state.position} duration={state.duration} />
        <SpeedSlider speed={state.speed} />
        <button
          ref={optionsButton}
          type="button"
          className="button button--quiet"
          aria-expanded={optionsOpen}
          aria-controls={optionsOpen ? optionsId : undefined}
          onClick={() => (optionsOpen ? closeSongOptions() : openSongOptions())}
        >
          Song options
          <span className="button__chevron" aria-hidden="true">
            ▾
          </span>
        </button>
        <button type="button" className="button button--quiet" onClick={() => closeSong()}>
          Close
        </button>
      </div>
      {optionsOpen && <SongOptions id={optionsId} loaded={loaded} opener={optionsButton} />}
    </section>
  )
}

/**
 * The thin line along the very top edge of the window that fills up as the
 * song goes on. Nothing when no song is loaded. It is a component of its own
 * because it stays on screen when the menu, and the player line with it, hides.
 */
export function SongProgressLine(): JSX.Element | null {
  const loaded = useLoadedSong()
  const { position, duration } = usePlayerState()
  if (loaded === null) return null

  const share = duration > 0 ? position / duration : 0
  const style = { '--song-progress': share } as CSSProperties
  return <div className="song-progress" aria-hidden="true" style={style} />
}

function Icon({ shape }: { shape: string }): JSX.Element {
  return (
    <svg className="player-line__icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d={shape} />
    </svg>
  )
}

interface PositionSliderProps {
  /** Seconds into the song. */
  position: number
  /** The length of the song, in seconds. */
  duration: number
}

/** Where the song is, between the time played and its length. Dragging it moves the song. */
function PositionSlider({ position, duration }: PositionSliderProps): JSX.Element {
  const played = formatDuration(position)
  const length = formatDuration(duration)
  return (
    <div className="player-line__position">
      <span className="player-line__time">{played}</span>
      <input
        className="slider"
        type="range"
        min={0}
        max={duration}
        step="any"
        value={position}
        aria-label="Position in the song"
        aria-valuetext={`${played} of ${length}`}
        onChange={(event) => player.seek(Number(event.currentTarget.value))}
      />
      <span className="player-line__time">{length}</span>
    </div>
  )
}

function SpeedSlider({ speed }: { speed: number }): JSX.Element {
  return (
    <div className="player-line__speed">
      <span className="field__label">Speed</span>
      <input
        className="slider"
        type="range"
        min={toPercent(MIN_SPEED)}
        max={toPercent(MAX_SPEED)}
        step={SPEED_STEP}
        value={toPercent(speed)}
        aria-label="Speed"
        aria-valuetext={formatPercent(speed)}
        onChange={(event) => changeSongOptions({ speed: Number(event.currentTarget.value) / 100 })}
      />
      <span className="slider__value" aria-hidden="true">
        {formatPercent(speed)}
      </span>
    </div>
  )
}

interface SongOptionsProps {
  id: string
  loaded: LoadedSong
  /** The "Song options" button, which opened this panel. */
  opener: RefObject<HTMLButtonElement | null>
}

/**
 * The small panel under the line: which parts are played, melody only, fit to
 * the piano. It changes only with the song and its options, so it is not drawn
 * again each time the player says how far the song has got.
 */
const SongOptions = memo(function SongOptions(props: SongOptionsProps): JSX.Element {
  const { id, loaded, opener } = props
  const { song, options, arrangement } = loaded
  const parts = song.tracks.filter((track) => !track.isPercussion)
  const panel = useRef<HTMLDivElement>(null)

  // Escape closes the options while one of their controls may have the
  // keyboard focus, which would disappear with it. It goes to the button that
  // opened them instead: someone working with the keyboard alone keeps their place.
  useLayoutEffect(() => {
    const element = panel.current
    return () => {
      if (element?.contains(document.activeElement)) opener.current?.focus()
    }
  }, [opener])

  return (
    <div ref={panel} id={id} className="song-options" role="group" aria-label="Song options">
      {parts.length > 1 && <PartsField parts={parts} chosen={options.trackIds} />}
      <div className="song-options__switches">
        <Field label="Melody only" hint="Plays one note at a time: the highest one.">
          <Switch
            label="Melody only"
            on={options.melodyOnly}
            onChange={(melodyOnly) => changeSongOptions({ melodyOnly })}
          />
        </Field>
        <Field
          label="Fit to the piano"
          hint="Moves notes that are too low or too high onto the piano you see."
        >
          <Switch
            label="Fit to the piano"
            on={options.fitToPiano}
            onChange={(fitToPiano) => changeSongOptions({ fitToPiano })}
          />
        </Field>
        {arrangement.offPianoCount > 0 && (
          <p className="song-options__off-piano">{offPianoSentence(arrangement.offPianoCount)}</p>
        )}
      </div>
    </div>
  )
})

interface PartsFieldProps {
  /** The parts of the song that the piano can play (no drums), in the song's order. */
  parts: readonly SongTrack[]
  chosen: SongPlayOptions['trackIds']
}

/**
 * One checkbox per part. They are buttons, not the browser's own checkboxes,
 * like every on/off control of the app: Space belongs to the piano.
 */
function PartsField({ parts, chosen }: PartsFieldProps): JSX.Element {
  const checked = parts.filter((part) => chosen === 'auto' || chosen.includes(part.id))

  function toggle(toggled: SongTrack): void {
    const next = parts.filter((part) => (part === toggled) !== checked.includes(part))
    // 'auto' is how "every part" is saved: it is what a song starts with.
    const trackIds = next.length === parts.length ? 'auto' : next.map((part) => part.id)
    changeSongOptions({ trackIds })
  }

  return (
    <Field label="Parts">
      <ul className="song-parts">
        {parts.map((part, index) => {
          const isChecked = checked.includes(part)
          const label = partLabel(part, index)
          return (
            <li key={part.id}>
              <button
                type="button"
                className="song-part"
                role="checkbox"
                aria-checked={isChecked}
                // At least one part is always played: the last checked one stays checked.
                disabled={isChecked && checked.length === 1}
                onClick={() => toggle(part)}
              >
                <span className="song-part__box" aria-hidden="true" />
                <span className="song-part__label" title={label}>
                  {label}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </Field>
  )
}

/** "Right hand · Piano · 532 notes", or "Part 2 · Strings · 120 notes" when it has no name. */
function partLabel(part: SongTrack, index: number): string {
  const name = part.name === '' ? `Part ${index + 1}` : part.name
  const count = part.notes.length
  return `${name} · ${instrumentName(part)} · ${count} ${count === 1 ? 'note' : 'notes'}`
}

function offPianoSentence(count: number): string {
  return count === 1
    ? '1 note is too low or too high to show on the piano. It still plays.'
    : `${count} notes are too low or too high to show on the piano. They still play.`
}
