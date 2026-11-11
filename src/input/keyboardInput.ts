import type { NoteBus } from '../core/noteBus'
import type { Midi, NoteEvent } from '../core/types'

export interface KeyEventTarget {
  addEventListener(type: string, listener: (event: never) => void, options?: unknown): void
  removeEventListener(type: string, listener: (event: never) => void, options?: unknown): void
}

export interface KeyboardInputOptions {
  bus: NoteBus
  /** Which note this physical key plays right now, or null if it plays nothing. Called on key down. */
  resolveNote(code: string): Midi | null
  /** Called first for every keydown, including auto-repeat. Return true to consume the event: no note, default prevented. */
  intercept?(event: KeyboardEvent): boolean
  /** Space was tapped (never called for auto-repeat). */
  onToggleSustain?(): void
  /** How hard new notes are played (0..1). Called on key down. Defaults to the bus default. */
  getVelocity?(): number
  /** Defaults to `window`. Also receives the `blur` listener. */
  target?: KeyEventTarget
}

const SUSTAIN_CODE = 'Space'

/** `KeyboardEvent.key` of the Command key on a Mac and of the Windows key. */
const META_KEY = 'Meta'

/** <input> types where pressing a letter types nothing, so the piano keeps playing. */
const NON_TEXT_INPUT_TYPES: ReadonlySet<string> = new Set([
  'range',
  'checkbox',
  'radio',
  'button',
  'submit',
  'reset',
  'image',
  'color',
  'file',
])

/** Starts listening; returns a function that stops listening and releases any notes still held by the keyboard. */
export function attachKeyboardInput(options: KeyboardInputOptions): () => void {
  const { bus } = options
  const target = options.target ?? window
  const pageDocument = typeof document === 'undefined' ? null : document

  /** Physical key (code) -> the note it started, so key up releases that exact note. */
  const heldNotes = new Map<string, Midi>()

  function handleKeyDown(event: KeyboardEvent): void {
    if (options.intercept?.(event)) {
      event.preventDefault()
      return
    }
    if (belongsToBrowser(event)) return
    if (event.code === SUSTAIN_CODE) {
      handleSustainKeyDown(event)
      return
    }
    handleNoteKeyDown(event)
  }

  /*
   * Space is the sustain key. Browsers also "click" a focused <button> with
   * Space, some on key down and some on key up, so the default is prevented
   * on both (here and in handleKeyUp). One tap toggles sustain exactly once
   * and never presses whichever button happens to have focus.
   */
  function handleSustainKeyDown(event: KeyboardEvent): void {
    event.preventDefault()
    if (!event.repeat) options.onToggleSustain?.()
  }

  function handleNoteKeyDown(event: KeyboardEvent): void {
    if (heldNotes.has(event.code)) {
      // Already sounding: auto-repeat must not type, scroll or start a second note.
      event.preventDefault()
      return
    }
    const midi = options.resolveNote(event.code)
    if (midi === null) return
    event.preventDefault()
    if (event.repeat) return
    heldNotes.set(event.code, midi)
    bus.noteOn(midi, 'keyboard', { velocity: options.getVelocity?.(), time: eventTime(event) })
  }

  function handleKeyUp(event: KeyboardEvent): void {
    if (event.key === META_KEY) {
      // While Meta is down, some systems never deliver the key up of other keys: any of them may have been let go.
      releaseAll()
      return
    }
    // Never skipped (modifiers held, focus moved to a text field…): a missed release is a stuck note.
    releaseKey(event.code, eventTime(event))
    if (event.code === SUSTAIN_CODE && !belongsToBrowser(event)) event.preventDefault()
  }

  function releaseKey(code: string, time: number | undefined): void {
    const midi = heldNotes.get(code)
    if (midi === undefined) return
    heldNotes.delete(code)
    if (!isHeldByAnotherKey(midi)) bus.noteOff(midi, 'keyboard', time)
  }

  /** After a rebinding or an octave change, two held keys can end up on the same note. */
  function isHeldByAnotherKey(midi: Midi): boolean {
    return [...heldNotes.values()].includes(midi)
  }

  function releaseAll(): void {
    const notes = new Set(heldNotes.values())
    heldNotes.clear()
    for (const midi of notes) bus.noteOff(midi, 'keyboard')
  }

  function handleVisibilityChange(): void {
    if (pageDocument?.visibilityState === 'hidden') releaseAll()
  }

  /*
   * The bus says "off" once nobody holds a note any more. When someone else
   * caused that (for example `bus.allOff()` when the piano moves), the keys
   * that started the note are still down but no longer hold it.
   */
  function forgetReleasedNote(event: NoteEvent): void {
    if (event.type !== 'off') return
    for (const [code, midi] of heldNotes) {
      if (midi === event.midi) heldNotes.delete(code)
    }
  }

  const stopFollowingBus = bus.subscribe(forgetReleasedNote)
  target.addEventListener('keydown', handleKeyDown)
  target.addEventListener('keyup', handleKeyUp)
  // Key ups that happen while another window has focus never reach the page.
  target.addEventListener('blur', releaseAll)
  pageDocument?.addEventListener('visibilitychange', handleVisibilityChange)

  return () => {
    target.removeEventListener('keydown', handleKeyDown)
    target.removeEventListener('keyup', handleKeyUp)
    target.removeEventListener('blur', releaseAll)
    pageDocument?.removeEventListener('visibilitychange', handleVisibilityChange)
    stopFollowingBus()
    releaseAll()
  }
}

/** True when the event target is somewhere the user types text (text-like <input>, <textarea>, <select>, contenteditable). Range sliders, checkboxes and buttons are NOT text entry. Must work with plain objects in tests (duck-typed on tagName/type/isContentEditable). */
export function isTextEntryTarget(target: unknown): boolean {
  if (typeof target !== 'object' || target === null) return false
  const element = target as { tagName?: unknown; type?: unknown; isContentEditable?: unknown }
  if (element.isContentEditable === true) return true

  const tag = lowerCased(element.tagName)
  if (tag === 'textarea' || tag === 'select') return true
  if (tag !== 'input') return false
  // An <input> with no type, or one the list does not know, is a text field.
  return !NON_TEXT_INPUT_TYPES.has(lowerCased(element.type))
}

function lowerCased(value: unknown): string {
  return typeof value === 'string' ? value.toLowerCase() : ''
}

/** Browser shortcuts (Ctrl / Alt / Meta + key) and typing in a text field are not for the piano. */
function belongsToBrowser(event: KeyboardEvent): boolean {
  return event.ctrlKey || event.altKey || event.metaKey || isTextEntryTarget(event.target)
}

/** The event's own time (same clock as `performance.now()`), or undefined to let the bus use "now". */
function eventTime(event: KeyboardEvent): number | undefined {
  return Number.isFinite(event.timeStamp) ? event.timeStamp : undefined
}
