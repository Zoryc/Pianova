import { useEffect, useEffectEvent, useId, useLayoutEffect, useRef } from 'react'
import type { JSX, ReactNode, RefObject } from 'react'
import { formatDuration } from '../songs/song'
import { useSongList } from '../songs/songLibrary'
import { STARTER_SONGS } from '../songs/starterSongs'
import './chrome.css'
import { focusedOutside } from './FloatingPanel'
import { FullscreenButton } from './FullscreenButton'
import { LogoMark, Wordmark } from './Logo'
import './startBox.css'
import { controlsIn } from './useAutoHide'

/** How many songs the box offers. All the others are behind "All songs…". */
export const START_BOX_SONGS = 3

/** What the box says while the app waits for the first click or key press. */
export const START_SENTENCE = 'Click or press any key to start'
/** What it says after that, when the Menu button has opened it. */
export const CLOSE_SENTENCE = 'Click outside or play a key to close'

export interface StartBoxProps {
  /** The element id, for aria-controls on the Menu button. */
  id: string
  /**
   * Whether the box hangs in a layer of its own over the whole window, which
   * is how the app opens, or is put where the app puts its panels.
   */
  overWindow: boolean
  /**
   * True until the first click or key press. The box then says how to start,
   * and the whole window around it is one button that starts the app.
   */
  waitingToStart: boolean
  /** The Menu button: a press of the mouse on it is not a press outside the box. */
  opener: RefObject<HTMLElement | null>
  /** "Free Play", the window around the box at the start, a press of the mouse outside it later. */
  onClose(): void
  onPlaySong(songId: string): void
  onShowSongs(): void
  onShowSettings(): void
  onShowAbout(): void
}

/**
 * The small menu in the middle of the sky. It is open when the app opens,
 * where it is also the welcome: the name, what the app is, the ways to play
 * and a few songs. The Menu button of the top bar opens it again.
 *
 * It holds what is used now and then, so that the bar keeps only what is
 * needed while playing: the ways to play, the songs, Settings, full screen
 * and About.
 *
 * Like the floating panel, it does not listen for Escape: the app does. It
 * does close itself at a press of the mouse anywhere else.
 */
export function StartBox(props: StartBoxProps): JSX.Element {
  const { id, overWindow, waitingToStart, opener, onClose } = props
  const box = useRef<HTMLElement>(null)
  const playHeadingId = useId()
  const songsHeadingId = useId()
  const songs = useSongChoice()

  /*
   * As for the floating panel: opened with the keyboard, from a button that
   * still has the focus, the focus goes to the first line of the box and back
   * to that button when the box closes. Opened with the mouse, the box takes
   * the focus itself, so that Tab carries on inside it. At the start nobody
   * has opened it: the focus is left where the browser put it.
   */
  useLayoutEffect(() => {
    const element = box.current
    if (!element || waitingToStart) return
    const cameFrom = focusedOutside(element)
    const target = cameFrom ? (controlsIn(element)[0] ?? element) : element
    target.focus()
    return () => {
      if (element.contains(document.activeElement)) cameFrom?.focus()
    }
    // Only when the box appears: the click that starts the app must not move the focus.
  }, [])

  // Like a menu, the box goes away at a press of the mouse anywhere else. At
  // the start the window around it does that, and starts the app too.
  const close = useEffectEvent(onClose)
  useEffect(() => {
    if (waitingToStart) return
    const closeWhenPressedOutside = (event: PointerEvent): void => {
      const pressed = event.target
      if (!(pressed instanceof Node)) return
      if (box.current?.contains(pressed) || opener.current?.contains(pressed)) return
      close()
    }
    window.addEventListener('pointerdown', closeWhenPressedOutside)
    return () => window.removeEventListener('pointerdown', closeWhenPressedOutside)
  }, [waitingToStart, opener])

  const theBox = (
    <section ref={box} id={id} className="start-box" role="dialog" aria-label="Menu" tabIndex={-1}>
      <header className="start-box__head">
        <Picture />
        <h1 className="start-box__name">
          <LogoMark />
          <Wordmark />
        </h1>
        <p className="start-box__tagline">A piano you play with your computer keyboard.</p>
      </header>

      {/* Its lines are reached with Tab: the part that scrolls is no stop of its own. */}
      <div className="start-box__body" tabIndex={-1}>
        <div className="start-box__columns">
          <section aria-labelledby={playHeadingId}>
            <h2 id={playHeadingId} className="start-box__heading">
              Play
            </h2>
            <ul className="start-box__list">
              <li>
                <button
                  type="button"
                  className="start-box__row"
                  aria-pressed="true"
                  onClick={onClose}
                >
                  <KeysIcon />
                  <Words name="Free Play" note="Play anything you like" />
                </button>
              </li>
              <ComingMode name="Practice" note="The song waits for you" icon={<TargetIcon />} />
              <ComingMode name="Real-time" note="Your timing is scored" icon={<StarIcon />} />
            </ul>
          </section>

          <section aria-labelledby={songsHeadingId}>
            <h2 id={songsHeadingId} className="start-box__heading">
              Songs
            </h2>
            <ul className="start-box__list">
              {songs.map((song) => (
                <li key={song.id}>
                  <button
                    type="button"
                    className="start-box__row"
                    aria-label={`Play ${song.title}`}
                    // The name says what the line does; the length is told after it.
                    aria-describedby={`${songsHeadingId}-${song.id}`}
                    onClick={() => props.onPlaySong(song.id)}
                  >
                    <NoteIcon />
                    <span className="start-box__title" title={song.title}>
                      {song.title}
                    </span>
                    <span id={`${songsHeadingId}-${song.id}`} className="start-box__length">
                      {formatDuration(song.duration)}
                    </span>
                  </button>
                </li>
              ))}
              <li>
                <button type="button" className="start-box__row" onClick={props.onShowSongs}>
                  <ListIcon />
                  All songs…
                </button>
              </li>
            </ul>
          </section>
        </div>
      </div>

      <footer className="start-box__foot">
        <button type="button" className="start-box__row" onClick={props.onShowSettings}>
          <SlidersIcon />
          Settings
        </button>
        <FullscreenButton rowClassName="start-box__row" />
        <button type="button" className="start-box__row" onClick={props.onShowAbout}>
          About
        </button>
        {/* While the app waits, the window button says the same sentence: a screen reader hears it once. */}
        <p className="start-box__way-out" aria-hidden={waitingToStart || undefined}>
          {waitingToStart ? START_SENTENCE : CLOSE_SENTENCE}
        </p>
      </footer>
    </section>
  )

  // Opened with the Menu button, the box is put where the app puts its
  // panels. When the app opens, it hangs in a layer of its own over the whole
  // window, and until the first click the window around it is one unseen
  // button. (The box keeps its place in the layer when that button goes.)
  if (!overWindow) return theBox
  return (
    <div className="start-layer">
      {waitingToStart && (
        <button
          type="button"
          className="start-layer__window"
          aria-label={START_SENTENCE}
          onClick={onClose}
        />
      )}
      {theBox}
    </div>
  )
}

/** A song as the box lists it: the player's own and the built-in ones have these in common. */
interface SongChoice {
  id: string
  title: string
  duration: number
}

/** The songs the box offers: the player's own, newest first, then the starter songs. */
function useSongChoice(): readonly SongChoice[] {
  const own = useSongList()
  return [...own, ...STARTER_SONGS].slice(0, START_BOX_SONGS)
}

/** The name of a line with a short explanation under it. */
function Words({ name, note }: { name: string; note: string }): JSX.Element {
  return (
    <span className="start-box__words">
      {name}
      <span className="start-box__note">{note}</span>
    </span>
  )
}

interface ComingModeProps {
  name: string
  note: string
  icon: ReactNode
}

/**
 * A way to play that is announced but not built yet: greyed out, with a
 * "Soon" badge, and not reached with the Tab key.
 */
function ComingMode({ name, note, icon }: ComingModeProps): JSX.Element {
  return (
    <li>
      <button
        type="button"
        className="start-box__row"
        aria-disabled="true"
        tabIndex={-1}
        title="Coming in a later update"
      >
        {icon}
        <Words name={name} note={note} />
        <span className="start-box__badge">Soon</span>
      </button>
    </li>
  )
}

/** The white keys of the small piano in the picture, and where a black key follows one. */
const PICTURE_KEYS = 28
const PICTURE_KEY_WIDTH = 660 / PICTURE_KEYS
const BLACK_FOLLOWS = [true, true, false, true, true, true, false] as const

/** Notes falling in the picture: the white key each is over, how far down it starts, how long it is. */
const PICTURE_NOTES: readonly (readonly [key: number, top: number, length: number])[] = [
  [15, 58, 40],
  [17, 12, 46],
  [18, 70, 30],
  [20, 34, 52],
  [22, 80, 22],
  [23, 6, 36],
  [25, 52, 44],
]

/**
 * The stage in small, behind the name: a piano, the line of light and a few
 * falling notes. The notes are dimmer than real ones, so that the only full
 * light on screen is the stage's own.
 */
function Picture(): JSX.Element {
  const whiteKeys = Array.from({ length: PICTURE_KEYS }, (_, key) => key)
  return (
    <svg
      className="start-box__picture"
      viewBox="0 0 660 132"
      preserveAspectRatio="xMaxYMax slice"
      aria-hidden="true"
    >
      <g className="start-box__picture-notes">
        {PICTURE_NOTES.map(([key, top, length]) => (
          <rect
            key={key}
            x={key * PICTURE_KEY_WIDTH + 2}
            y={top}
            width={PICTURE_KEY_WIDTH - 4}
            height={length}
            rx={5}
          />
        ))}
      </g>
      <rect className="start-box__picture-line" x={0} y={106} width={660} height={2} />
      <rect className="start-box__picture-white" x={0} y={108} width={660} height={24} />
      {whiteKeys.map((key) => (
        <rect
          key={key}
          className="start-box__picture-gap"
          x={key * PICTURE_KEY_WIDTH - 0.5}
          y={108}
          width={1}
          height={24}
        />
      ))}
      {whiteKeys
        .filter((key) => BLACK_FOLLOWS[key % 7])
        .map((key) => (
          <rect
            key={key}
            className="start-box__picture-black"
            x={(key + 1) * PICTURE_KEY_WIDTH - 7}
            y={108}
            width={14}
            height={14}
            rx={1.5}
          />
        ))}
    </svg>
  )
}

/** A piano's keys. */
function KeysIcon(): JSX.Element {
  return (
    <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2.5 3.5h11v9h-11zM6.2 8.5v4M9.8 8.5v4M5.2 3.5v5h2v-5M8.8 3.5v5h2v-5" />
    </svg>
  )
}

/** A target: playing the right key. */
function TargetIcon(): JSX.Element {
  return (
    <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="5.5" />
      <circle cx="8" cy="8" r="1.5" />
    </svg>
  )
}

/** A star: being scored. */
function StarIcon(): JSX.Element {
  return (
    <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 2.2l1.8 3.7 4 .5-3 2.8.8 4L8 11.2l-3.6 2 .8-4-3-2.8 4-.5z" />
    </svg>
  )
}

/** Two notes joined by a beam. */
function NoteIcon(): JSX.Element {
  return (
    <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M6 12V3.6l7-1.6v8.5" />
      <circle cx="4.4" cy="12" r="1.6" />
      <circle cx="11.4" cy="10.5" r="1.6" />
    </svg>
  )
}

/** The lines of a list. */
function ListIcon(): JSX.Element {
  return (
    <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M5.5 4h8M5.5 8h8M5.5 12h8M2.5 4h.01M2.5 8h.01M2.5 12h.01" />
    </svg>
  )
}

/** Three sliders. */
function SlidersIcon(): JSX.Element {
  return (
    <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2 4h6.5M12 4h2M2 8h1.5M7 8h7M2 12h7.5M13 12h1" />
      <circle cx="10.2" cy="4" r="1.7" />
      <circle cx="5.2" cy="8" r="1.7" />
      <circle cx="11.2" cy="12" r="1.7" />
    </svg>
  )
}
