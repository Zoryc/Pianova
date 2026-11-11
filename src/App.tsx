import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { JSX, MouseEvent as ReactMouseEvent } from 'react'
import { APP_NAME } from './app/appInfo'
import { bus, engine } from './app/pianoApp'
import type { AudioStatus } from './audio/audioEngine'
import type { Midi } from './core/types'
import { keyLabel, useLayoutMap } from './input/keyLabels'
import type { LayoutMap } from './input/keyLabels'
import { isTextEntryTarget } from './input/keyboardInput'
import { settingsStore, useSettings } from './state/settings'
import type { Settings } from './state/settings'
import { AdvancedPanel } from './ui/AdvancedPanel'
import { KeyEditor } from './ui/KeyEditor'
import { ModeTabs } from './ui/ModeTabs'
import { NoteTrails } from './ui/NoteTrails'
import { NowPlaying } from './ui/NowPlaying'
import { Piano } from './ui/Piano'
import { StartOverlay } from './ui/StartOverlay'
import { Toolbar } from './ui/Toolbar'
import {
  useActiveNotes,
  useAudioStatus,
  useKeyboardPiano,
  useNoStuckNotes,
  useSoundSettings,
} from './ui/hooks'
import { isFunctionKey, labelModeWhileEditing, slotNoteName } from './ui/keyEditorModel'
import { useKeyEditor } from './ui/useKeyEditor'

/** What the footer says about the sound. Nothing while all is well. */
const SOUND_STATUS_TEXT: Readonly<Record<AudioStatus, string | null>> = {
  idle: null,
  loading: 'Loading piano sound…',
  ready: null,
  fallback: 'Using basic sound (piano sound could not be loaded).',
  error: 'Sound could not start. Click anywhere to try again.',
}

/** The licence of the piano recordings, which asks for the credit shown in the footer. */
const PIANO_SOUND_LICENCE_URL = 'https://creativecommons.org/licenses/by/3.0/'

/**
 * The whole screen, top to bottom: the name and the mode tabs, the toolbar
 * (with the Advanced panel under it when open), the notes being played, the
 * stage with the light trails and the piano, and a one-line footer.
 *
 * How these share the height of the window, so that the piano stays on
 * screen, is explained at the top of src/styles/app.css.
 */
export function App(): JSX.Element {
  const settings = useSettings()
  const layoutMap = useLayoutMap()
  const activeNotes = useActiveNotes()
  const audioStatus = useAudioStatus()
  const keyEditor = useKeyEditor(layoutMap)
  const { editing, selectedSlot } = keyEditor
  /** False until the first click or key press, which is what lets the browser play sound. */
  const [started, setStarted] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const modeTabId = useId()
  const modePanelId = useId()
  const advancedPanelId = useId()
  const stageRef = useRef<HTMLDivElement>(null)
  const customizeButtonRef = useRef<HTMLButtonElement>(null)

  const { bindings, customLabels } = settings
  const keyLabels = useMemo(
    () => labelsBySlot(bindings, customLabels, layoutMap),
    [bindings, customLabels, layoutMap],
  )
  const labelMode = editing ? labelModeWhileEditing(settings.labelMode) : settings.labelMode

  function start(): void {
    setStarted(true)
    wakeAudio()
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
    return keyEditor.handleKey(event)
  }

  function handleClick(event: ReactMouseEvent): void {
    wakeAudio()
    giveKeyboardBackToPiano(event)
  }

  useSoundSettings(settings)
  useNoStuckNotes(settings.baseOctave)
  useKeyboardPiano(interceptKey)

  // The piano's keys can hold the keyboard focus only while customizing, where
  // they are reached with Tab. When customizing ends (Escape) while one of
  // them has it, the focus goes to the "Customize keys" button instead of
  // being lost: someone working with the keyboard alone keeps their place.
  useEffect(() => {
    if (!editing && holdsFocus(stageRef.current)) customizeButtonRef.current?.focus()
  }, [editing])

  return (
    <>
      <div className="app" inert={!started} onClick={handleClick}>
        <header className="app-header">
          <h1 className="app-title">{APP_NAME}</h1>
          <ModeTabs tabId={modeTabId} panelId={modePanelId} />
        </header>

        <main className="app-main">
          <div className="mode-panel" id={modePanelId} role="tabpanel" aria-labelledby={modeTabId}>
            <Toolbar
              settings={settings}
              editing={editing}
              advancedOpen={advancedOpen}
              advancedPanelId={advancedPanelId}
              customizeButtonRef={customizeButtonRef}
              onToggleEditing={editing ? keyEditor.close : keyEditor.open}
              onToggleAdvanced={() => setAdvancedOpen(!advancedOpen)}
            />
            {advancedOpen && <AdvancedPanel id={advancedPanelId} settings={settings} />}

            <NowPlaying
              notes={activeNotes}
              noteNaming={settings.noteNaming}
              transpose={settings.transpose}
              showHint={!editing}
            />

            {editing && (
              <KeyEditor
                selectedNote={selectedSlot === null ? null : slotNoteName(settings, selectedSlot)}
                message={keyEditor.message}
                onReset={keyEditor.resetKeys}
                onDone={keyEditor.close}
                returnFocusTo={customizeButtonRef}
              />
            )}

            <div ref={stageRef} className={editing ? 'stage stage--editing' : 'stage'}>
              {settings.showTrails && (
                <div className="stage__trails">
                  <NoteTrails bus={bus} baseOctave={settings.baseOctave} />
                </div>
              )}
              <Piano
                baseOctave={settings.baseOctave}
                activeNotes={activeNotes}
                labelMode={labelMode}
                noteNaming={settings.noteNaming}
                keyLabels={keyLabels}
                onNoteDown={playPointerNote}
                onNoteUp={releasePointerNote}
                editMode={editing}
                selectedSlot={selectedSlot}
                onSelectSlot={keyEditor.select}
              />
            </div>
          </div>
        </main>

        <footer className="app-footer">
          <span>Space turns sustain on and off.</span>
          {/* Always present, so that screen readers announce the status when it changes. */}
          <span className="app-footer__status" role="status" data-status={audioStatus}>
            {SOUND_STATUS_TEXT[audioStatus]}
          </span>
          <span className="app-footer__credit">
            Piano sound: Salamander Grand Piano by Alexander Holm (
            <a href={PIANO_SOUND_LICENCE_URL} target="_blank" rel="noreferrer">
              CC BY 3.0
            </a>
            )
          </span>
        </footer>
      </div>

      {!started && <StartOverlay onStart={start} />}
    </>
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

/**
 * A button, slider or link that was clicked would keep the keyboard: a focus
 * ring appears on it at the next key press, and Enter presses it again. So
 * after a click with the mouse or a finger it lets go, and the player can go
 * straight back to playing.
 */
function giveKeyboardBackToPiano(event: ReactMouseEvent): void {
  // `detail` is 0 when the "click" was Enter on a focused control: someone
  // working with the keyboard alone keeps their place on the page.
  if (event.detail === 0) return
  const focused = document.activeElement
  if (focused instanceof HTMLElement && focused.matches('button, input[type="range"], a')) {
    focused.blur()
  }
}

/** True when the keyboard focus is on something inside `container`. */
function holdsFocus(container: HTMLElement | null): boolean {
  return container !== null && container.contains(document.activeElement)
}

/** Piano key -> the label of the computer key that plays it (the keycaps drawn on the piano). */
function labelsBySlot(
  bindings: Settings['bindings'],
  customLabels: Settings['customLabels'],
  layoutMap: LayoutMap | null,
): ReadonlyMap<number, string> {
  const labels = new Map<number, string>()
  for (const [code, slot] of Object.entries(bindings)) {
    labels.set(slot, keyLabel(code, layoutMap, customLabels))
  }
  return labels
}

// Notes played with the mouse or a finger. Like the keyboard's, they go to
// the bus, played as hard as the "Touch" setting says at that moment.

function playPointerNote(midi: Midi): void {
  bus.noteOn(midi, 'pointer', { velocity: settingsStore.get().velocity })
}

function releasePointerNote(midi: Midi): void {
  bus.noteOff(midi, 'pointer')
}
