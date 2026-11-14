import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { CSSProperties, JSX, MouseEvent as ReactMouseEvent } from 'react'
import { bus, engine } from './app/pianoApp'
import { inkOn, paletteFor } from './core/colour'
import { pianoRange, slotToMidi } from './core/layout'
import type { PianoRange } from './core/layout'
import type { Midi } from './core/types'
import { keyLabel, useLayoutMap } from './input/keyLabels'
import type { LayoutMap } from './input/keyLabels'
import { isTextEntryTarget } from './input/keyboardInput'
import { settingsStore, useSettings } from './state/settings'
import type { Settings } from './state/settings'
import { DropOverlay } from './ui/DropOverlay'
import { PlayerLine, SongProgressLine } from './ui/PlayerLine'
import { SettingsPanel, openSettingsOn } from './ui/SettingsPanel'
import { SongsPanel } from './ui/SongsPanel'
import { Stage } from './ui/Stage'
import { StartBox } from './ui/StartBox'
import { TopBar } from './ui/TopBar'
import { useAudioStatus, useKeyboardPiano, useNoStuckNotes, useSoundSettings } from './ui/hooks'
import { isFunctionKey } from './ui/keyEditorModel'
import { useAutoHide } from './ui/useAutoHide'
import { useKeyEditor } from './ui/useKeyEditor'
import { closeSongOptions, playSong, useSongOptionsOpen, useSongSession } from './ui/useSongs'

/** The two panels that open from the start box. Only one is open at a time. */
type PanelName = 'songs' | 'settings'

/** No key letters on the falling notes: what the sky gets while that setting is off. */
const NO_HINTS: ReadonlyMap<Midi, string> = new Map()

/** What the stage is called: the only way of playing that is built so far. */
const STAGE_NAME = 'Free Play'

/**
 * The whole screen: the stage (the sky and the piano) fills the window, and
 * everything else floats over it. The menu at the top (the Menu button, the
 * player line while a song is loaded, volume and sustain) hides when the
 * mouse is still. The start box, a small menu in the middle of the sky, is
 * open when the app opens and whenever the Menu button says so; the Settings
 * and Songs panels open from it. Of the box and the two panels only one is
 * open at a time. Until the first click or key press the app waits: the
 * whole window around the start box then starts it.
 *
 * How these share the window is explained at the top of src/styles/app.css.
 */
export function App(): JSX.Element {
  const settings = useSettings()
  const layoutMap = useLayoutMap()
  const audioStatus = useAudioStatus()
  const keyEditor = useKeyEditor(layoutMap)
  const { editing, selectedSlot } = keyEditor
  /**
   * False while the app waits to start: until the first click or key press,
   * which is what lets the browser play sound, or until a file is dropped.
   */
  const [started, setStarted] = useState(false)
  /** The start box is what the app opens with. */
  const [startBoxOpen, setStartBoxOpen] = useState(true)
  /**
   * Where the start box is drawn: over the whole window, which is how the app
   * opens, until it is closed for the first time; among the panels after
   * that. (It does not move when the app starts under it: "Full screen"
   * starts the app and leaves the box open, with the focus where it was.)
   */
  const [startBoxOverWindow, setStartBoxOverWindow] = useState(true)
  const [openPanel, setOpenPanel] = useState<PanelName | null>(null)
  /** The piano on screen, as the stage last reported it. A full piano until it has. */
  const [range, setRange] = useState<PianoRange>(() => pianoRange(88, settings.baseOctave))
  const song = useSongSession(range)
  const songOptionsOpen = useSongOptionsOpen()
  const menu = useAutoHide({
    enabled: settings.autoHideMenu,
    pinned: !started || startBoxOpen || openPanel !== null || (song.loaded && !song.playing),
  })

  const stageId = useId()
  const startBoxId = useId()
  const songsPanelId = useId()
  const settingsPanelId = useId()
  /** The Menu button: what opens the start box, and through it both panels. */
  const startBoxButton = useRef<HTMLButtonElement>(null)
  /** True as soon as the app has been started, before the screen is drawn again. */
  const hasStarted = useRef(false)
  /** What had the keyboard focus when Enter last went down as a new press. */
  const enterWentDownOn = useRef<Element | null>(null)
  /** True when the last click was Enter on a focused control, not the mouse. */
  const clickedWithKeyboard = useRef(false)

  const { bindings, customLabels, keyboardType, baseOctave, showKeyHints } = settings
  const keyLabels = useMemo(
    () => labelsBySlot(bindings, customLabels, layoutMap, keyboardType),
    [bindings, customLabels, layoutMap, keyboardType],
  )
  const hints = useMemo(
    () => (showKeyHints ? labelsByNote(keyLabels, baseOctave) : NO_HINTS),
    [showKeyHints, keyLabels, baseOctave],
  )
  const { accent, customColour, glow } = settings
  const light = useMemo(
    () => lightVariables(accent, customColour, glow),
    [accent, customColour, glow],
  )

  function start(): void {
    // One click can say "start" twice (a line of the start box closes the
    // box, which starts the app, and the click itself starts it too): the
    // sound is asked for once.
    if (hasStarted.current) return
    hasStarted.current = true
    setStarted(true)
    wakeAudio()
  }

  /**
   * When a line of `container` (the start box or a panel) has the keyboard
   * focus, puts the focus on the Menu button instead: the line is about to
   * leave the page, and someone working with the keyboard keeps their place.
   * (After a click with the mouse, `handleClick` lets go of the button again.
   * A box or panel that holds the focus itself was only ever used with the
   * mouse, and leaves the focus nowhere.)
   */
  function keepFocusOnMenuButton(container: HTMLElement | null): void {
    if (isOnALineOf(container)) startBoxButton.current?.focus()
  }

  /**
   * Takes the start box away. While the app waits to start, that is the
   * click that starts it: on the window around the box, or on one of its lines.
   */
  function closeStartBox(): void {
    if (!started) start()
    if (!startBoxOpen) return
    keepFocusOnMenuButton(document.getElementById(startBoxId))
    setStartBoxOpen(false)
    setStartBoxOverWindow(false)
  }

  /** The Menu button: opens the start box, in place of a panel that is open, and closes it. */
  function toggleStartBox(): void {
    if (startBoxOpen) {
      closeStartBox()
      return
    }
    setOpenPanel(null)
    setStartBoxOpen(true)
  }

  /** A line of the start box that opens a panel: the panel takes the place of the box. */
  function showPanel(panel: PanelName): void {
    closeStartBox()
    setOpenPanel(panel)
  }

  /** A song of the start box: it plays, and the box goes away so that the piano is in view. */
  function playFromStartBox(songId: string): void {
    closeStartBox()
    // A song that cannot be read is not played: the Songs panel says why.
    if (!playSong(songId)) setOpenPanel('songs')
  }

  /**
   * Closes the open panel. A control inside it that has the keyboard focus
   * goes away with it, so the focus is first put on the Menu button, which
   * the panel was opened through.
   */
  function closePanel(): void {
    if (openPanel === null) return
    const isSongs = openPanel === 'songs'
    keepFocusOnMenuButton(document.getElementById(isSongs ? songsPanelId : settingsPanelId))
    setOpenPanel(null)
  }

  /** A file was dropped on the page: the Songs panel shows what became of it. */
  function showDroppedSongs(): void {
    // A drop before the first click starts the app too, and takes the start
    // box away, or the panel would open behind it. The sound still waits for
    // a click or a key press, as the browser wants.
    hasStarted.current = true
    setStarted(true)
    setStartBoxOpen(false)
    setStartBoxOverWindow(false)
    setOpenPanel('songs')
  }

  /** Sees every key press before the piano does. Returns true when the press is used up here. */
  function interceptKey(event: KeyboardEvent): boolean {
    // Browser shortcuts (Ctrl+R, Alt+Tab…) and typing in a field are never the piano's business.
    if (event.ctrlKey || event.altKey || event.metaKey) return false
    if (isTextEntryTarget(event.target)) return false
    if (isEnter(event.code) && !event.repeat) enterWentDownOn.current = document.activeElement

    if (!started) {
      // The start box can be used with the keyboard before anything else:
      // Tab moves through its lines (and Shift, which goes down before Tab
      // on the way back, starts nothing either), and Enter presses the line
      // it is on, which starts the app as a click on it does.
      if (event.code === 'Tab' || isShift(event.code)) return false
      if (isEnter(event.code) && isOnALineOf(document.getElementById(startBoxId))) return false
      closeStartBox()
      // The key that starts the sound does nothing else. Function keys are
      // left to the browser (F5 still reloads the page).
      return !isFunctionKey(event.code)
    }
    wakeAudio()
    if (event.code === 'Escape') return pressEscape(event)
    // A held Enter sends the press again and again. It goes on pressing what
    // it went down on, and never what the focus has moved to since: the first
    // control of a panel that the press opened ("Import a MIDI file" would
    // open the file picker). On the Menu button and on a line of the start
    // box it counts once: the box would open and close in turn.
    if (event.repeat && isEnter(event.code)) {
      if (document.activeElement !== enterWentDownOn.current) return true
      if (isOnStartBoxOrItsButton()) return true
    }
    // A key of the piano takes the start box away and plays its note: the
    // keyboard is the piano's as soon as it is played. A key that was already
    // down when the box was opened is not played again, and leaves it open.
    if (startBoxOpen && !event.repeat && Object.hasOwn(settings.bindings, event.code)) {
      closeStartBox()
    }
    return keyEditor.handleKey(event)
  }

  /**
   * Escape takes back one thing at a time. The first of these that there is:
   *
   *   1. the piano key that is waiting for a computer key;
   *   2. the song options that are open under the player line;
   *   3. the open panel, or the start box;
   *   4. the keyboard focus, when it is inside the menu: the menu can then hide.
   *
   * With none of them, the key is left to the browser.
   */
  function pressEscape(event: KeyboardEvent): boolean {
    // The key editor leaves the selection alone when the key is only held down.
    if (selectedSlot !== null) return keyEditor.handleKey(event)
    // A key that is held down sends the press again and again. Escape has
    // then done its one thing: the repeats take nothing more back. They are
    // still used up while something is left that a new press would take back.
    if (event.repeat) {
      return songOptionsOpen || openPanel !== null || startBoxOpen || holdsFocus(menuElement())
    }
    if (closeSongOptions()) return true
    if (openPanel !== null) {
      closePanel()
      return true
    }
    if (startBoxOpen) {
      closeStartBox()
      return true
    }
    return letGoOfMenu()
  }

  /** True when the keyboard focus is on the Menu button or on a line of the start box. */
  function isOnStartBoxOrItsButton(): boolean {
    const focused = document.activeElement
    return focused === startBoxButton.current || isOnALineOf(document.getElementById(startBoxId))
  }

  function menuElement(): HTMLElement | null {
    return menu.menuProps.ref.current
  }

  /** Takes the keyboard focus off the menu. False when the focus was not inside it. */
  function letGoOfMenu(): boolean {
    const focused = document.activeElement
    if (!(focused instanceof HTMLElement) || !holdsFocus(menuElement())) return false
    focused.blur()
    return true
  }

  function handleClick(event: ReactMouseEvent): void {
    // The click that starts the app has asked for the sound already (see
    // `start`). A click anywhere on the start box starts it too, not only on
    // the window around it: on the very words that say "click", and on "Full
    // screen", which has no other way to say so.
    if (started) wakeAudio()
    else if (isInside(document.getElementById(startBoxId), event.target)) start()
    clickedWithKeyboard.current = isKeyboardClick(event)
    giveKeyboardBackToPiano(event)
  }

  useSoundSettings(settings)
  useNoStuckNotes(baseOctave, range)
  useKeyboardPiano(interceptKey)

  // The piano's keys can hold the keyboard focus only while the computer keys
  // are being chosen, where they are reached with Tab. When that ends while
  // one of them has it, the focus goes to the Menu button instead of being
  // lost: someone working with the keyboard alone keeps their place.
  useEffect(() => {
    if (!editing && holdsFocus(document.getElementById(stageId))) startBoxButton.current?.focus()
  }, [editing, stageId])

  // The same when the player line goes away under the focus: "Stop", pressed with Enter.
  useEffect(() => {
    if (!song.loaded && clickedWithKeyboard.current && focusIsNowhere()) {
      startBoxButton.current?.focus()
    }
  }, [song.loaded])

  const startBox = startBoxOpen && (
    <StartBox
      id={startBoxId}
      overWindow={startBoxOverWindow}
      waitingToStart={!started}
      opener={startBoxButton}
      onClose={closeStartBox}
      onPlaySong={playFromStartBox}
      onShowSongs={() => showPanel('songs')}
      onShowSettings={() => showPanel('settings')}
      onShowAbout={() => {
        openSettingsOn('about')
        showPanel('settings')
      }}
    />
  )

  return (
    <div
      className={menu.visible ? 'app' : 'app cursor-hidden'}
      style={light}
      onClick={handleClick}
    >
      <div className="app__screen" inert={!started}>
        <TopBar
          settings={settings}
          startBoxOpen={startBoxOpen}
          startBoxId={startBoxId}
          onToggleStartBox={toggleStartBox}
          menu={menu}
          startBoxButtonRef={startBoxButton}
        >
          <PlayerLine />
        </TopBar>

        <div className="app__panels">
          {!startBoxOverWindow && startBox}
          {openPanel === 'songs' && <SongsPanel id={songsPanelId} onClose={closePanel} />}
          {openPanel === 'settings' && (
            <SettingsPanel
              id={settingsPanelId}
              settings={settings}
              keyEditor={keyEditor}
              layoutMap={layoutMap}
              onClose={closePanel}
            />
          )}
        </div>

        <Stage
          id={stageId}
          label={STAGE_NAME}
          bus={bus}
          settings={settings}
          keyLabels={keyLabels}
          hints={hints}
          falling={song.falling}
          audioStatus={audioStatus}
          showHint={started && !editing && !startBoxOpen}
          editMode={editing}
          selectedSlot={selectedSlot}
          onSelectSlot={keyEditor.select}
          onNoteDown={playPointerNote}
          onNoteUp={releasePointerNote}
          onRangeChange={setRange}
          onSkyClick={closePanel}
        />

        <SongProgressLine />
      </div>

      {/* Until the first click the screen above cannot be used: the start box is put over it. */}
      {startBoxOverWindow && startBox}
      <DropOverlay onFilesDropped={showDroppedSongs} />
    </div>
  )
}

/**
 * Starts the sound if it is not running: the very first time, and again after
 * an attempt that failed. Browsers only allow this from a click or a key
 * press, so it is called from those and nowhere else.
 */
function wakeAudio(): void {
  // Asking too early gets a warning in the console and a wait that ends in an
  // error. The next click or key press comes through here again.
  if (browserHasSeenNoGesture()) return
  const status = engine.getStatus()
  if (status === 'idle' || status === 'error') void engine.start()
}

/**
 * True while the browser says that no click or key press has counted yet. Not
 * every key counts: Escape and Shift do not. A browser that cannot say (it
 * has no `userActivation`) is taken to have seen one.
 */
function browserHasSeenNoGesture(): boolean {
  return navigator.userActivation?.hasBeenActive === false
}

/** `detail` is 0 when the "click" was Enter on a focused control. */
function isKeyboardClick(event: ReactMouseEvent): boolean {
  return event.detail === 0
}

/**
 * A button, slider or link that was clicked would keep the keyboard: a focus
 * ring appears on it at the next key press, and Enter presses it again. So
 * after a click with the mouse it lets go, and the player can go straight
 * back to playing.
 */
function giveKeyboardBackToPiano(event: ReactMouseEvent): void {
  // Someone working with the keyboard alone keeps their place on the page.
  if (isKeyboardClick(event)) return
  const focused = document.activeElement
  if (focused instanceof HTMLElement && focused.matches('button, input[type="range"], a')) {
    focused.blur()
  }
}

/** True when the keyboard focus is on something inside `container`. */
function holdsFocus(container: HTMLElement | null): boolean {
  return container !== null && container.contains(document.activeElement)
}

/**
 * True when the keyboard focus is on one of the controls of `container`: not
 * on the container itself, and not on a part of it that only scrolls, which
 * a click between two lines gives the focus to.
 */
function isOnALineOf(container: HTMLElement | null): boolean {
  const focused = document.activeElement
  if (container === null || !(focused instanceof HTMLElement)) return false
  return focused !== container && container.contains(focused) && focused.matches(CONTROL)
}

/** What counts as a control: something to press, move or type in. Not a part that only scrolls. */
const CONTROL = 'a[href], button, input, select, textarea'

/** True when what was clicked is `container` or something in it. */
function isInside(container: HTMLElement | null, clicked: EventTarget): boolean {
  return container !== null && clicked instanceof Node && container.contains(clicked)
}

/** One of the two Shift keys. */
function isShift(code: string): boolean {
  return code === 'ShiftLeft' || code === 'ShiftRight'
}

/** Enter, on the main block of keys or on the number pad. */
function isEnter(code: string): boolean {
  return code === 'Enter' || code === 'NumpadEnter'
}

/** True when no control has the keyboard focus: the one that had it has left the page. */
function focusIsNowhere(): boolean {
  return document.activeElement === null || document.activeElement === document.body
}

/**
 * The colour of the light and how strongly it glows, as the variables every
 * stylesheet reads. They are set on the app's root element, so the menu and
 * the panels take the player's colour too.
 */
function lightVariables(
  accent: Settings['accent'],
  customColour: string,
  glow: number,
): CSSProperties {
  const palette = paletteFor(accent, customColour)
  return {
    '--light': palette.light,
    '--light-bright': palette.bright,
    '--light-deep': palette.deep,
    '--light-ink': inkOn(palette.light),
    '--glow': glow,
  } as CSSProperties
}

/** Piano key -> the label of the computer key that plays it (the keycaps drawn on the piano). */
function labelsBySlot(
  bindings: Settings['bindings'],
  customLabels: Settings['customLabels'],
  layoutMap: LayoutMap | null,
  keyboardType: Settings['keyboardType'],
): ReadonlyMap<number, string> {
  const labels = new Map<number, string>()
  for (const [code, slot] of Object.entries(bindings)) {
    labels.set(slot, keyLabel(code, layoutMap, customLabels, keyboardType))
  }
  return labels
}

/** Note -> the label of the computer key that plays it (the letters written on falling notes). */
function labelsByNote(
  keyLabels: ReadonlyMap<number, string>,
  baseOctave: number,
): ReadonlyMap<Midi, string> {
  const labels = new Map<Midi, string>()
  for (const [slot, label] of keyLabels) labels.set(slotToMidi(slot, baseOctave), label)
  return labels
}

// Notes played with the mouse. Like the keyboard's, they go to the bus,
// played as hard as the "Touch" setting says at that moment.

function playPointerNote(midi: Midi): void {
  bus.noteOn(midi, 'pointer', { velocity: settingsStore.get().velocity })
}

function releasePointerNote(midi: Midi): void {
  bus.noteOff(midi, 'pointer')
}
