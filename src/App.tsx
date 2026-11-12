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
import { SettingsPanel } from './ui/SettingsPanel'
import { SongsPanel } from './ui/SongsPanel'
import { Stage } from './ui/Stage'
import { StartOverlay } from './ui/StartOverlay'
import { TopBar } from './ui/TopBar'
import type { PanelName } from './ui/TopBar'
import { useAudioStatus, useKeyboardPiano, useNoStuckNotes, useSoundSettings } from './ui/hooks'
import { isFunctionKey } from './ui/keyEditorModel'
import { useAutoHide } from './ui/useAutoHide'
import { useKeyEditor } from './ui/useKeyEditor'
import { closeSongOptions, useSongOptionsOpen, useSongSession } from './ui/useSongs'

/** No key letters on the falling notes: what the sky gets while that setting is off. */
const NO_HINTS: ReadonlyMap<Midi, string> = new Map()

/**
 * The whole screen: the stage (the sky and the piano) fills the window, and
 * everything else floats over it. The menu at the top (the top bar, with the
 * player line under it while a song is loaded) hides when the mouse is still.
 * The Settings and Songs panels open from it, one at a time. Until the first
 * click or key press, the start overlay covers it all.
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
   * False while the start overlay is up: until the first click or key press,
   * which is what lets the browser play sound, or until a file is dropped.
   */
  const [started, setStarted] = useState(false)
  const [openPanel, setOpenPanel] = useState<PanelName | null>(null)
  /** The piano on screen, as the stage last reported it. A full piano until it has. */
  const [range, setRange] = useState<PianoRange>(() => pianoRange(88, settings.baseOctave))
  const song = useSongSession(range)
  const songOptionsOpen = useSongOptionsOpen()
  const menu = useAutoHide({
    enabled: settings.autoHideMenu,
    pinned: !started || openPanel !== null || (song.loaded && !song.playing),
  })

  const modeTabId = useId()
  const stageId = useId()
  const songsPanelId = useId()
  const settingsPanelId = useId()
  const songsButton = useRef<HTMLButtonElement>(null)
  const settingsButton = useRef<HTMLButtonElement>(null)
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
    setStarted(true)
    wakeAudio()
  }

  function togglePanel(panel: PanelName): void {
    setOpenPanel(openPanel === panel ? null : panel)
  }

  /**
   * Closes the open panel. A control inside it that has the keyboard focus
   * goes away with it, so the focus is first put on the button that opens the
   * panel: someone working with the keyboard keeps their place. (After a
   * click with the mouse, `handleClick` lets go of that button again. A panel
   * that holds the focus itself was only ever used with the mouse, and leaves
   * the focus nowhere.)
   */
  function closePanel(): void {
    if (openPanel === null) return
    const isSongs = openPanel === 'songs'
    const panel = document.getElementById(isSongs ? songsPanelId : settingsPanelId)
    if (holdsFocus(panel) && document.activeElement !== panel) {
      const opener = isSongs ? songsButton : settingsButton
      opener.current?.focus()
    }
    setOpenPanel(null)
  }

  /** A file was dropped on the page: the Songs panel shows what became of it. */
  function showDroppedSongs(): void {
    // A drop before the first click starts the app too, or the panel would
    // open behind the start overlay. The sound still waits for a click or a
    // key press, as the browser wants.
    setStarted(true)
    setOpenPanel('songs')
  }

  /** Sees every key press before the piano does. Returns true when the press is used up here. */
  function interceptKey(event: KeyboardEvent): boolean {
    // Browser shortcuts (Ctrl+R, Alt+Tab…) and typing in a field are never the piano's business.
    if (event.ctrlKey || event.altKey || event.metaKey) return false
    if (isTextEntryTarget(event.target)) return false

    if (!started) {
      start()
      // The key that starts the sound does nothing else. Function keys are
      // left to the browser (F5 still reloads the page).
      return !isFunctionKey(event.code)
    }
    wakeAudio()
    if (event.code === 'Escape') return pressEscape(event)
    return keyEditor.handleKey(event)
  }

  /**
   * Escape takes back one thing at a time. The first of these that there is:
   *
   *   1. the piano key that is waiting for a computer key;
   *   2. the song options that are open under the player line;
   *   3. the open panel;
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
    if (event.repeat) return songOptionsOpen || openPanel !== null || holdsFocus(menuElement())
    if (closeSongOptions()) return true
    if (openPanel !== null) {
      closePanel()
      return true
    }
    return letGoOfMenu()
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
    // The click that starts the app has asked for the sound already (see `start`).
    if (started) wakeAudio()
    clickedWithKeyboard.current = isKeyboardClick(event)
    giveKeyboardBackToPiano(event)
  }

  useSoundSettings(settings)
  useNoStuckNotes(baseOctave, range)
  useKeyboardPiano(interceptKey)

  // The piano's keys can hold the keyboard focus only while the computer keys
  // are being chosen, where they are reached with Tab. When that ends while
  // one of them has it, the focus goes to the "Settings" button instead of
  // being lost: someone working with the keyboard alone keeps their place.
  useEffect(() => {
    if (!editing && holdsFocus(document.getElementById(stageId))) settingsButton.current?.focus()
  }, [editing, stageId])

  // The same when the player line goes away under the focus: "Close", pressed with Enter.
  useEffect(() => {
    if (!song.loaded && clickedWithKeyboard.current && focusIsNowhere()) {
      songsButton.current?.focus()
    }
  }, [song.loaded])

  return (
    <div
      className={menu.visible ? 'app' : 'app cursor-hidden'}
      style={light}
      onClick={handleClick}
    >
      <div className="app__screen" inert={!started}>
        <TopBar
          settings={settings}
          openPanel={openPanel}
          songsPanelId={songsPanelId}
          settingsPanelId={settingsPanelId}
          onToggleSongs={() => togglePanel('songs')}
          onToggleSettings={() => togglePanel('settings')}
          menu={menu}
          modeTabId={modeTabId}
          modePanelId={stageId}
          songsButtonRef={songsButton}
          settingsButtonRef={settingsButton}
        >
          <PlayerLine />
        </TopBar>

        <div className="app__panels">
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
          labelledBy={modeTabId}
          bus={bus}
          settings={settings}
          keyLabels={keyLabels}
          hints={hints}
          falling={song.falling}
          audioStatus={audioStatus}
          showHint={started && !editing}
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

      {!started && <StartOverlay onStart={start} />}
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
