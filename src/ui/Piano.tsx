import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type {
  CSSProperties,
  JSX,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  SyntheticEvent,
} from 'react'
import { KEY_RECTS } from '../core/keyGeometry'
import type { KeyRect } from '../core/keyGeometry'
import { isValidSlot, slotToMidi } from '../core/layout'
import { noteName, pitchClass, pitchName } from '../core/notes'
import type { LabelMode, Midi, NoteNaming } from '../core/types'
import { BLACK_KEY_HEIGHT, createPointerNotes, slotAtPoint, slotsAlongLine } from './pianoHitTest'
import './piano.css'

export interface PianoProps {
  baseOctave: number
  /** Notes to draw as pressed. */
  activeNotes: ReadonlySet<Midi>
  labelMode: LabelMode
  /** How note names are written on the keys and in aria-labels (pass to `noteName` / `pitchName`). */
  noteNaming: NoteNaming
  /** slot -> label of the computer key that plays it. Missing = no key. */
  keyLabels: ReadonlyMap<number, string>
  /** Pointer pressed / released a key. Not called in edit mode. */
  onNoteDown(midi: Midi): void
  onNoteUp(midi: Midi): void
  /** Edit mode: clicking a key selects it instead of playing it. */
  editMode?: boolean
  selectedSlot?: number | null
  onSelectSlot?(slot: number): void
}

type PianoPointerEvent = ReactPointerEvent<HTMLDivElement>

/** `button` of the left mouse button, a finger or a pen tip. */
const PRIMARY_BUTTON = 0
/** The same button in the `buttons` bit mask. */
const PRIMARY_BUTTON_MASK = 1

function percent(fraction: number): string {
  return `${fraction * 100}%`
}

/** Where each key sits across the piano; index = slot. Never changes, so it is built once. */
const KEY_STYLES: readonly CSSProperties[] = KEY_RECTS.map((rect) => ({
  left: percent(rect.left),
  width: percent(rect.width),
}))

/** Tells piano.css how tall the black keys are, from the same number the hit test uses. */
const PIANO_STYLE = { '--piano-black-key-height': percent(BLACK_KEY_HEIGHT) } as CSSProperties

export function Piano(props: PianoProps): JSX.Element {
  const {
    baseOctave,
    activeNotes,
    labelMode,
    noteNaming,
    keyLabels,
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

  // Nothing may keep sounding when the piano moves lower or higher, when edit
  // mode is switched, or when the piano goes away.
  useEffect(() => () => pointerNotes.releaseAll(), [pointerNotes, baseOctave, editMode])

  // A mouse button released while another window has focus never reaches the page.
  useEffect(() => {
    const releaseAll = (): void => pointerNotes.releaseAll()
    window.addEventListener('blur', releaseAll)
    return () => window.removeEventListener('blur', releaseAll)
  }, [pointerNotes])

  function midiOfSlot(slot: number | null): Midi | null {
    return slot === null ? null : slotToMidi(slot, baseOctave)
  }

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
    pointerNotes.down(event.pointerId, midiOfSlot(slotAtPoint(point.x, point.y)))
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
      for (const slot of slotsAlongLine(from.x, from.y, to.x, to.y)) {
        pointerNotes.move(pointerId, midiOfSlot(slot))
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

  return (
    <div
      className={editMode ? 'piano piano--editing' : 'piano'}
      style={PIANO_STYLE}
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
      {KEY_RECTS.map((rect) => {
        const midi = slotToMidi(rect.slot, baseOctave)
        return (
          <PianoKey
            key={rect.slot}
            rect={rect}
            midi={midi}
            lit={activeNotes.has(midi)}
            selected={editMode && selectedSlot === rect.slot}
            editMode={editMode}
            keyLabel={keyLabels.get(rect.slot)}
            labelMode={labelMode}
            noteNaming={noteNaming}
          />
        )
      })}
    </div>
  )
}

interface PianoKeyProps {
  rect: KeyRect
  midi: Midi
  lit: boolean
  selected: boolean
  editMode: boolean
  /** Label of the computer key that plays this key, if any. */
  keyLabel: string | undefined
  labelMode: LabelMode
  noteNaming: NoteNaming
}

/** One key. Memoized: when a note starts or stops, only the keys that change are drawn again. */
const PianoKey = memo(function PianoKey(props: PianoKeyProps): JSX.Element {
  const { rect, midi, lit, selected, editMode, keyLabel, labelMode, noteNaming } = props
  const cap = showsKeyLabels(labelMode) ? keyLabel : undefined
  const note = showsNoteNames(labelMode) ? shortNoteName(midi, noteNaming) : undefined

  return (
    <button
      type="button"
      className={keyClassName(rect.black, lit, selected)}
      style={KEY_STYLES[rect.slot]}
      data-slot={rect.slot}
      // Keys are tab stops only while customizing: 37 stops would get in the way of playing.
      tabIndex={editMode ? 0 : -1}
      aria-label={describeKey(midi, keyLabel, noteNaming)}
      aria-pressed={editMode ? selected : lit}
    >
      {(cap || note) && (
        <span className="piano-key__labels">
          {cap && <span className={capClassName(cap)}>{cap}</span>}
          {note && <span className={noteClassName(midi)}>{note}</span>}
        </span>
      )}
    </button>
  )
})

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

/** Labels longer than one character ("Num 1") are written smaller so they fit on the keycap. */
function capClassName(label: string): string {
  return label.length > 1 ? 'piano-key__cap piano-key__cap--long' : 'piano-key__cap'
}

function noteClassName(midi: Midi): string {
  return isC(midi) ? 'piano-key__note piano-key__note--c' : 'piano-key__note'
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

/** The slot of the key element an event happened on (or inside), if any. */
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
