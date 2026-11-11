/*
 * The pure half of the on-screen piano's pointer handling: which key lies
 * under a point, which keys lie between two points, and which notes the
 * pointers (mouse, fingers, pen) are holding. It works for a piano of any
 * size. No DOM and no React here, so it can be unit-tested.
 */
import type { PianoRange } from '../core/layout'
import { keyRects } from '../core/pianoGeometry'
import type { KeyRect } from '../core/pianoGeometry'
import type { Midi } from '../core/types'

/**
 * How far down the piano the black keys reach, as a fraction of its height.
 * Piano.tsx hands the same number to piano.css, so what is drawn and what is
 * hit always agree.
 */
export const BLACK_KEY_HEIGHT = 0.62

/** The keys of one piano, sorted for hit-testing. */
interface KeyRows {
  /** Edge to edge across the whole piano, lowest first. */
  whites: readonly KeyRect[]
  /** On top of the white keys, in the upper part of the piano only. */
  blacks: readonly KeyRect[]
  /** How closely a line across this piano is looked at (see `notesAlongLine`). */
  lineStep: number
}

/**
 * `keyRects` gives the same array for the same range, so the rows are worked
 * out once per piano.
 */
const rowsOfRects = new WeakMap<readonly KeyRect[], KeyRows>()

function keyRows(range: PianoRange): KeyRows {
  const rects = keyRects(range)
  const known = rowsOfRects.get(rects)
  if (known) return known

  const whites = rects.filter((rect) => !rect.black)
  const rows: KeyRows = {
    whites,
    blacks: rects.filter((rect) => rect.black),
    // Every eighth of a white key. That is finer than the narrowest part of
    // any key (the strip of a white key that shows between two black keys),
    // so only a corner clipped for less than that can go unnoticed.
    lineStep: 1 / (Math.max(1, whites.length) * 8),
  }
  rowsOfRects.set(rects, rows)
  return rows
}

/**
 * The note of the key under a point of the piano box, or null when the point
 * is outside the box. `x` and `y` are fractions of the box's width and height,
 * measured from its top-left corner. `range` is the piano that is drawn.
 */
export function noteAtPoint(x: number, y: number, range: PianoRange): Midi | null {
  // Written so that NaN (a box with no size yet) also counts as outside.
  const inside = x >= 0 && x < 1 && y >= 0 && y < 1
  if (!inside) return null

  const { whites, blacks } = keyRows(range)
  if (y < BLACK_KEY_HEIGHT) {
    const black = blacks.find((rect) => x >= rect.left && x < rect.left + rect.width)
    if (black) return black.midi
  }
  // White keys sit edge to edge, so the last one that starts at or before x is the one under it.
  return whites.findLast((rect) => x >= rect.left)?.midi ?? null
}

/**
 * The notes of the keys on the straight line between two points of the piano
 * box, in the order a pointer moving along it reaches them: from the key
 * under the start point to the key under the end point. This is what keeps a
 * fast drag from skipping keys, because the browser reports only a few points
 * of it.
 *
 * A line that starts or ends off the piano is not filled in: the result is
 * then only what is under its end point (null when that point is off the
 * piano). Coordinates are fractions of the box, as for `noteAtPoint`.
 */
export function notesAlongLine(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  range: PianoRange,
): readonly (Midi | null)[] {
  const first = noteAtPoint(fromX, fromY, range)
  const last = noteAtPoint(toX, toY, range)
  if (first === null || last === null) return [last]

  const notes = [first]
  // Steps are counted across the piano only. Straight up or down, a line
  // crosses nothing but the lower edge of the black keys, and its two end
  // points already give the key on either side of that.
  const steps = Math.ceil(Math.abs(toX - fromX) / keyRows(range).lineStep)
  for (let step = 1; step < steps; step++) {
    const share = step / steps
    const note = noteAtPoint(fromX + (toX - fromX) * share, fromY + (toY - fromY) * share, range)
    if (note !== null && note !== notes.at(-1)) notes.push(note)
  }
  if (last !== notes.at(-1)) notes.push(last)
  return notes
}

/**
 * Remembers which note each pressed pointer is holding. A note held by two
 * pointers at once is started once and stopped only when the last of them
 * lets go, so every `onNoteDown` is matched by exactly one `onNoteUp`.
 */
export interface PointerNotes {
  /** True from `down` until `up` / `releaseAll`, even while the pointer is on no key. */
  isDown(pointerId: number): boolean
  /** The pointer was pressed on `midi`, or on no key (null). */
  down(pointerId: number, midi: Midi | null): void
  /** A pressed pointer is now on `midi`, or on no key (null). Ignored for pointers that are not pressed. */
  move(pointerId: number, midi: Midi | null): void
  /** The pointer was lifted or lost. Safe to call more than once. */
  up(pointerId: number): void
  /** Stops every note and forgets every pointer. */
  releaseAll(): void
}

export function createPointerNotes(
  onNoteDown: (midi: Midi) => void,
  onNoteUp: (midi: Midi) => void,
): PointerNotes {
  /** Every pressed pointer and the note it holds (null while it is on no key). */
  const noteByPointer = new Map<number, Midi | null>()
  /** How many pointers hold each sounding note. */
  const holdersByNote = new Map<Midi, number>()

  function hold(midi: Midi): void {
    const holders = holdersByNote.get(midi) ?? 0
    holdersByNote.set(midi, holders + 1)
    if (holders === 0) onNoteDown(midi)
  }

  function letGo(midi: Midi): void {
    const holders = holdersByNote.get(midi) ?? 0
    if (holders > 1) {
      holdersByNote.set(midi, holders - 1)
      return
    }
    holdersByNote.delete(midi)
    if (holders === 1) onNoteUp(midi)
  }

  function setNote(pointerId: number, midi: Midi | null): void {
    const previous = noteByPointer.get(pointerId) ?? null
    noteByPointer.set(pointerId, midi)
    if (previous === midi) return
    if (previous !== null) letGo(previous)
    if (midi !== null) hold(midi)
  }

  return {
    isDown: (pointerId) => noteByPointer.has(pointerId),
    down: setNote,
    move(pointerId, midi) {
      if (noteByPointer.has(pointerId)) setNote(pointerId, midi)
    },
    up(pointerId) {
      if (!noteByPointer.has(pointerId)) return
      setNote(pointerId, null)
      noteByPointer.delete(pointerId)
    },
    releaseAll() {
      const sounding = [...holdersByNote.keys()]
      noteByPointer.clear()
      holdersByNote.clear()
      for (const midi of sounding) onNoteUp(midi)
    },
  }
}
