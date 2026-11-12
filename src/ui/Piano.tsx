import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type {
  CSSProperties,
  JSX,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  SyntheticEvent,
} from 'react'
import { inkOn, paletteForNote } from '../core/colour'
import type { LightPalette } from '../core/colour'
import { SLOT_COUNT, isValidSlot, midiToSlot, slotToMidi } from '../core/layout'
import type { PianoRange } from '../core/layout'
import { noteName, pitchClass, pitchName } from '../core/notes'
import { BLACK_KEY_WIDTH_RATIO, keyRectOf, keyRects, whiteKeyCount } from '../core/pianoGeometry'
import type { KeyRect } from '../core/pianoGeometry'
import type { AccentChoice, KeyStyle, LabelMode, Midi, NoteNaming } from '../core/types'
import { BLACK_KEY_HEIGHT, createPointerNotes, noteAtPoint, notesAlongLine } from './pianoHitTest'
import './piano.css'

export interface PianoProps {
  /** The notes the piano shows, lowest to highest. */
  range: PianoRange
  /**
   * Where the keyboard zone starts. The zone is the 37 keys that computer
   * keys can play, from the C of this octave up.
   */
  baseOctave: number
  /** Notes to draw as pressed. */
  activeNotes: ReadonlySet<Midi>
  labelMode: LabelMode
  /** How note names are written on the keys and in aria-labels (pass to `noteName` / `pitchName`). */
  noteNaming: NoteNaming
  /** slot -> label of the computer key that plays it. Missing = no key. */
  keyLabels: ReadonlyMap<number, string>
  /** How the keys are drawn. piano.css has one block of variables per style. */
  keyStyle: KeyStyle
  /** The colour of the light, for the keys being played (`paletteForNote`). */
  accent: AccentChoice
  customColour: string
  /** Pointer pressed / released a key. Not called in edit mode. */
  onNoteDown(midi: Midi): void
  onNoteUp(midi: Midi): void
  /** Edit mode: clicking a key of the keyboard zone selects it instead of playing it. */
  editMode?: boolean
  selectedSlot?: number | null
  onSelectSlot?(slot: number): void
}

type PianoPointerEvent = ReactPointerEvent<HTMLDivElement>

/** `button` of the left mouse button, a finger or a pen tip. */
const PRIMARY_BUTTON = 0
/** The same button in the `buttons` bit mask. */
const PRIMARY_BUTTON_MASK = 1

export function Piano(props: PianoProps): JSX.Element {
  const {
    range,
    baseOctave,
    activeNotes,
    labelMode,
    noteNaming,
    keyLabels,
    keyStyle,
    accent,
    customColour,
    editMode = false,
    selectedSlot = null,
    onSelectSlot,
  } = props

  // The callbacks may be new functions on every render. Reading them through
  // this ref means a note is always reported to the latest ones.
  const latestProps = useRef(props)
  useLayoutEffect(() => {
    latestProps.current = props
  })

  const [pointerNotes] = useState(() =>
    createPointerNotes(
      (midi) => latestProps.current.onNoteDown(midi),
      (midi) => latestProps.current.onNoteUp(midi),
    ),
  )
  // Where on the piano each pointer was when it last pressed or moved. Only
  // read while that pointer is pressed, to find the keys it has passed since.
  const [lastPoints] = useState(() => new Map<number, PianoPoint>())

  // Nothing may keep sounding when the piano shows other notes, when the
  // keyboard zone moves lower or higher, when edit mode is switched, or when
  // the piano goes away.
  useEffect(
    () => () => pointerNotes.releaseAll(),
    [pointerNotes, range.first, range.last, baseOctave, editMode],
  )

  // A mouse button released while another window has focus, or while the page
  // is hidden or has been left, never reaches the page.
  useEffect(() => {
    const releaseAll = (): void => pointerNotes.releaseAll()
    const releaseIfHidden = (): void => {
      if (document.visibilityState === 'hidden') pointerNotes.releaseAll()
    }
    window.addEventListener('blur', releaseAll)
    window.addEventListener('pagehide', releaseAll)
    document.addEventListener('visibilitychange', releaseIfHidden)
    return () => {
      window.removeEventListener('blur', releaseAll)
      window.removeEventListener('pagehide', releaseAll)
      document.removeEventListener('visibilitychange', releaseIfHidden)
    }
  }, [pointerNotes])

  /** The pointer was lifted or lost: its note stops. */
  function releasePointer(pointerId: number): void {
    lastPoints.delete(pointerId)
    pointerNotes.up(pointerId)
  }

  function handlePointerDown(event: PianoPointerEvent): void {
    if (event.button !== PRIMARY_BUTTON) return
    dropKeyboardFocus()
    if (editMode) return
    capturePointer(event.currentTarget, event.pointerId)
    const point = pointOnPiano(event, event.currentTarget.getBoundingClientRect())
    lastPoints.set(event.pointerId, point)
    pointerNotes.down(event.pointerId, noteAtPoint(point.x, point.y, range))
  }

  function handlePointerMove(event: PianoPointerEvent): void {
    const { pointerId } = event
    if (!pointerNotes.isDown(pointerId)) return
    if (primaryButtonReleased(event)) {
      releasePointer(pointerId)
      return
    }
    // A quick sweep reaches the page as a few positions that are several keys
    // apart, so every key on the way from one position to the next is played.
    const box = event.currentTarget.getBoundingClientRect()
    for (const position of reportedPositions(event.nativeEvent)) {
      const to = pointOnPiano(position, box)
      const from = lastPoints.get(pointerId) ?? to
      lastPoints.set(pointerId, to)
      for (const note of notesAlongLine(from.x, from.y, to.x, to.y, range)) {
        pointerNotes.move(pointerId, note)
      }
    }
  }

  function handlePointerEnd(event: PianoPointerEvent): void {
    releasePointer(event.pointerId)
  }

  function handleLostPointerCapture(event: PianoPointerEvent): void {
    // Only the piano box's own capture matters, not one bubbling up from a key.
    if (event.target === event.currentTarget) releasePointer(event.pointerId)
  }

  function handlePointerLeave(event: PianoPointerEvent): void {
    // While the box holds the pointer, handlePointerMove sees it leave. This
    // is the safety net for a pointer that could not be captured.
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) releasePointer(event.pointerId)
  }

  function handleClick(event: ReactMouseEvent<HTMLDivElement>): void {
    if (!editMode) return
    const slot = slotOfKeyElement(event.target)
    if (slot !== null) onSelectSlot?.(slot)
  }

  /*
   * Edit mode, key reached with Tab: Enter selects it. The event is stopped
   * here, so the rest of the app does not take it for a key press of its own.
   * Space is not handled: it is the sustain key everywhere, also on a focused
   * piano key. Once the key is selected, Enter is no longer handled here
   * either, so the app can tell the user it cannot be used for a note.
   */
  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (!editMode || !isSelectKeyPress(event)) return
    const slot = slotOfKeyElement(event.target)
    if (slot === null || slot === selectedSlot) return
    event.preventDefault()
    event.stopPropagation()
    onSelectSlot?.(slot)
  }

  const zoneMark = zoneMarkStyle(range, baseOctave)

  return (
    <div
      className={editMode ? 'piano piano--editing' : 'piano'}
      data-key-style={keyStyle}
      style={pianoStyle(range)}
      role="group"
      aria-label="Piano"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onLostPointerCapture={handleLostPointerCapture}
      onPointerLeave={handlePointerLeave}
      onMouseDown={preventDefault}
      onContextMenu={preventDefault}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
    >
      {keyRects(range).map((rect) => {
        const slot = midiToSlot(rect.midi, baseOctave)
        return (
          <PianoKey
            key={rect.midi}
            rect={rect}
            slot={slot}
            lit={activeNotes.has(rect.midi)}
            selected={editMode && slot !== null && slot === selectedSlot}
            editMode={editMode}
            keyLabel={slot === null ? undefined : keyLabels.get(slot)}
            labelMode={labelMode}
            noteNaming={noteNaming}
            palette={paletteForNote(rect.midi, accent, customColour)}
          />
        )
      })}
      {zoneMark && <span className="piano__zone" style={zoneMark} aria-hidden="true" />}
    </div>
  )
}

interface PianoKeyProps {
  rect: KeyRect
  /** The key's place in the keyboard zone, or null when it lies outside the zone. */
  slot: number | null
  lit: boolean
  selected: boolean
  editMode: boolean
  /** Label of the computer key that plays this key, if any. */
  keyLabel: string | undefined
  labelMode: LabelMode
  noteNaming: NoteNaming
  /** The light this key gives off when it is played. */
  palette: LightPalette
}

/** One key. Memoized: when a note starts or stops, only the keys that change are drawn again. */
const PianoKey = memo(function PianoKey(props: PianoKeyProps): JSX.Element {
  const { rect, slot, lit, selected, editMode, keyLabel, labelMode, noteNaming, palette } = props
  const { midi } = rect
  const cap = showsKeyLabels(labelMode) ? keyLabel : undefined
  const note = showsNoteNames(labelMode) ? shortNoteName(midi, noteNaming) : undefined
  // While customizing, only the keys of the keyboard zone can be chosen.
  const selectable = editMode && slot !== null
  const outOfReach = editMode && slot === null

  return (
    <button
      type="button"
      className={keyClassName(rect.black, lit, selected)}
      style={styleOfKey(rect, palette)}
      data-midi={midi}
      data-slot={slot ?? undefined}
      // Keys are tab stops only while customizing: dozens of stops would get in the way of playing.
      tabIndex={selectable ? 0 : -1}
      aria-label={describeKey(midi, keyLabel, noteNaming)}
      aria-pressed={editMode ? selected : lit}
      aria-disabled={outOfReach || undefined}
    >
      {(cap || note) && (
        <span className="piano-key__labels">
          {cap && (
            <span className={capClassName(cap)} style={fitStyle(cap)}>
              {cap}
            </span>
          )}
          {note && (
            <span className={noteClassName(midi)} style={fitStyle(note)}>
              {note}
            </span>
          )}
        </span>
      )}
    </button>
  )
})

function percent(fraction: number): string {
  return `${fraction * 100}%`
}

/**
 * What piano.css needs to know about the piano being drawn: how many white
 * keys share its width (the size of everything follows from the width of a
 * key), and how big the black keys are, from the same numbers the hit test
 * and the shared geometry use.
 */
function pianoStyle(range: PianoRange): CSSProperties {
  return {
    '--piano-white-keys': whiteKeyCount(range),
    '--piano-black-key-height': percent(BLACK_KEY_HEIGHT),
    '--piano-black-key-width': BLACK_KEY_WIDTH_RATIO,
  } as CSSProperties
}

/**
 * Where a key sits across the piano, and the colours of its light. Every key
 * carries its colours, not only the ones being played: a key that was just
 * released is still fading out, and with the rainbow each key has its own.
 */
function styleOfKey(rect: KeyRect, palette: LightPalette): CSSProperties {
  return {
    left: percent(rect.left),
    width: percent(rect.width),
    '--key-light': palette.light,
    '--key-light-bright': palette.bright,
    '--key-light-ink': inkOn(palette.light),
  } as CSSProperties
}

/**
 * Where the keyboard zone lies across the piano, for the line that marks it.
 * Null when the zone is the whole piano: then there is nothing to point out.
 */
function zoneMarkStyle(range: PianoRange, baseOctave: number): CSSProperties | null {
  const first = keyRectOf(slotToMidi(0, baseOctave), range)
  const last = keyRectOf(slotToMidi(SLOT_COUNT - 1, baseOctave), range)
  if (!first || !last) return null
  if (first.midi === range.first && last.midi === range.last) return null
  return { left: percent(first.left), width: percent(last.left + last.width - first.left) }
}

function showsKeyLabels(mode: LabelMode): boolean {
  return mode === 'keys' || mode === 'both'
}

function showsNoteNames(mode: LabelMode): boolean {
  return mode === 'notes' || mode === 'both'
}

function isC(midi: Midi): boolean {
  return pitchClass(midi) === 0
}

/** C keys carry their octave ("C4") as landmarks; every other key shows just its pitch ("D", "F♯"). */
function shortNoteName(midi: Midi, naming: NoteNaming): string {
  return isC(midi) ? noteName(midi, naming) : pitchName(midi, naming)
}

/** What a screen reader says for a key: "C4, key A", or just "C4" when no computer key plays it. */
function describeKey(midi: Midi, keyLabel: string | undefined, naming: NoteNaming): string {
  const name = noteName(midi, naming)
  return keyLabel ? `${name}, key ${keyLabel}` : name
}

function keyClassName(black: boolean, lit: boolean, selected: boolean): string {
  const names = ['piano-key', black ? 'piano-key--black' : 'piano-key--white']
  if (lit) names.push('is-lit')
  if (selected) names.push('is-selected')
  return names.join(' ')
}

/** Labels longer than one character ("Num 1") are written smaller, like the small print of a keycap. */
function capClassName(label: string): string {
  return label.length > 1 ? 'piano-key__cap piano-key__cap--long' : 'piano-key__cap'
}

function noteClassName(midi: Midi): string {
  return isC(midi) ? 'piano-key__note piano-key__note--c' : 'piano-key__note'
}

/**
 * Tells piano.css how many characters a label has to fit across its key, so
 * that it can shrink the text on a narrow key. A label of several words
 * ("Num 1") is written on several lines, so its longest word is what counts.
 * A single character needs nothing: that is what the stylesheet assumes.
 */
function fitStyle(label: string): CSSProperties | undefined {
  const widest = Math.max(...label.split(' ').map((word) => [...word].length))
  return widest > 1 ? ({ '--label-chars': widest } as CSSProperties) : undefined
}

/** A place on the piano box, as fractions of its width and height from its top-left corner. */
interface PianoPoint {
  x: number
  y: number
}

/** Where a pointer is on the piano box, given where the box is on screen. */
function pointOnPiano(pointer: { clientX: number; clientY: number }, box: DOMRect): PianoPoint {
  return {
    x: (pointer.clientX - box.left) / box.width,
    y: (pointer.clientY - box.top) / box.height,
  }
}

/**
 * Every position the pointer has been at since its previous move. A browser
 * sends at most one move per screen refresh and keeps the positions it left
 * out as "coalesced" events. Where it does not offer them, the move itself
 * is all there is.
 */
function reportedPositions(move: PointerEvent): readonly PointerEvent[] {
  const positions = typeof move.getCoalescedEvents === 'function' ? move.getCoalescedEvents() : []
  return positions.length > 0 ? positions : [move]
}

/**
 * The slot of the key element an event happened on (or inside), if any. Keys
 * outside the keyboard zone have no slot.
 */
function slotOfKeyElement(target: EventTarget): number | null {
  if (!(target instanceof Element)) return null
  const slot = Number(target.closest<HTMLElement>('.piano-key')?.dataset.slot)
  return isValidSlot(slot) ? slot : null
}

/**
 * Makes the piano box keep receiving this pointer's moves and its release
 * after the pointer has left the box, so a note can never be left sounding.
 */
function capturePointer(box: HTMLElement, pointerId: number): void {
  try {
    box.setPointerCapture(pointerId)
  } catch {
    // The browser no longer knows this pointer. handlePointerLeave covers it.
  }
}

/**
 * With several mouse buttons held, letting go of the left one is reported as
 * a move rather than a release.
 */
function primaryButtonReleased(event: PianoPointerEvent): boolean {
  return event.pointerType === 'mouse' && (event.buttons & PRIMARY_BUTTON_MASK) === 0
}

/** Enter pressed on its own, and not one of the repeats a held key sends. */
function isSelectKeyPress(event: ReactKeyboardEvent): boolean {
  if (event.repeat || event.ctrlKey || event.altKey || event.metaKey) return false
  return event.key === 'Enter'
}

/**
 * Pressing a piano key does not move keyboard focus onto it (see the
 * `onMouseDown` handler), but, like a click anywhere else on the page, it
 * still takes focus away from whatever had it. Otherwise a drop-down left
 * focused would keep swallowing the computer keys instead of letting them play.
 */
function dropKeyboardFocus(): void {
  const focused = document.activeElement
  if (focused instanceof HTMLElement) focused.blur()
}

/** On mouse down: no focus on the key, no text selection, no drag. On the context menu: no menu. */
function preventDefault(event: SyntheticEvent): void {
  event.preventDefault()
}
