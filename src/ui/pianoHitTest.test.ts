import { describe, expect, it } from 'vitest'
import { PIANO_SIZES, pianoRange } from '../core/layout'
import type { PianoRange } from '../core/layout'
import { isBlackKey } from '../core/notes'
import { keyRectOf, keyRects } from '../core/pianoGeometry'
import type { KeyRect } from '../core/pianoGeometry'
import type { Midi } from '../core/types'
import { BLACK_KEY_HEIGHT, createPointerNotes, noteAtPoint, notesAlongLine } from './pianoHitTest'

const WHITE_ZONE_Y = (BLACK_KEY_HEIGHT + 1) / 2
const BLACK_ZONE_Y = BLACK_KEY_HEIGHT / 2

/** Every size of piano, with the keyboard zone where it starts out (C3 to C6). */
const PIANOS: readonly (readonly [string, PianoRange])[] = PIANO_SIZES.map(
  (size) => [`${size} keys`, pianoRange(size, 3)] as const,
)

// Notes that every piano above has, by name.
const C4 = 60
const C_SHARP_4 = 61
const D4 = 62
const D_SHARP_4 = 63
const E4 = 64
const F4 = 65
const G4 = 67

function centreOf(rect: KeyRect): number {
  return rect.left + rect.width / 2
}

function containsX(rect: KeyRect, x: number): boolean {
  return x >= rect.left && x < rect.left + rect.width
}

function rectOf(midi: Midi, range: PianoRange): KeyRect {
  const rect = keyRectOf(midi, range)
  if (!rect) throw new Error(`the piano has no key for note ${midi}`)
  return rect
}

/** How far across the piano the middle of a key is. */
function centreOfNote(midi: Midi, range: PianoRange): number {
  return centreOf(rectOf(midi, range))
}

function notesOf(range: PianoRange): Midi[] {
  return keyRects(range).map((rect) => rect.midi)
}

describe.each(PIANOS)('noteAtPoint on a piano of %s', (_name, range) => {
  const rects = keyRects(range)

  it('finds every white key below the black keys', () => {
    for (const rect of rects.filter((r) => !r.black)) {
      expect(noteAtPoint(centreOf(rect), WHITE_ZONE_Y, range)).toBe(rect.midi)
    }
  })

  it('finds every black key in the upper part of the piano', () => {
    for (const rect of rects.filter((r) => r.black)) {
      expect(noteAtPoint(centreOf(rect), BLACK_ZONE_Y, range)).toBe(rect.midi)
      expect(noteAtPoint(rect.left, 0, range)).toBe(rect.midi)
    }
  })

  it('gives the white key underneath once the pointer is below a black key', () => {
    // C♯ straddles the line between C and D.
    const cSharp = rectOf(C_SHARP_4, range)
    expect(cSharp.black).toBe(true)
    expect(noteAtPoint(cSharp.left + cSharp.width * 0.25, BLACK_ZONE_Y, range)).toBe(C_SHARP_4)
    expect(noteAtPoint(cSharp.left + cSharp.width * 0.25, BLACK_KEY_HEIGHT, range)).toBe(C4)
    expect(noteAtPoint(cSharp.left + cSharp.width * 0.75, WHITE_ZONE_Y, range)).toBe(D4)
  })

  it('gives the white key between black keys in the upper part', () => {
    // The top of D shows between C♯ and D♯; E and F have no black key between them.
    const f = rectOf(F4, range)
    const nudge = f.width / 100
    expect(noteAtPoint(centreOfNote(D4, range), BLACK_ZONE_Y, range)).toBe(D4)
    expect(noteAtPoint(f.left - nudge, BLACK_ZONE_Y, range)).toBe(E4)
    expect(noteAtPoint(f.left + nudge, BLACK_ZONE_Y, range)).toBe(F4)
  })

  it('covers the whole box, edge to edge, from the lowest note to the highest', () => {
    expect(noteAtPoint(0, 0, range)).toBe(range.first)
    expect(noteAtPoint(0, 0.999, range)).toBe(range.first)
    expect(noteAtPoint(0.9999, 0, range)).toBe(range.last)
    expect(noteAtPoint(0.9999, 0.999, range)).toBe(range.last)
  })

  it('agrees with the drawn geometry everywhere', () => {
    const steps = 2000
    for (let i = 0; i < steps; i++) {
      const x = (i + 0.5) / steps
      for (const y of [0.01, BLACK_ZONE_Y, BLACK_KEY_HEIGHT - 0.001, BLACK_KEY_HEIGHT, 0.99]) {
        const note = noteAtPoint(x, y, range)
        const rect = note === null ? null : keyRectOf(note, range)
        if (!rect) throw new Error(`no key at ${x}, ${y}`)
        expect(containsX(rect, x)).toBe(true)

        const blackAbove = rects.find((r) => r.black && containsX(r, x))
        const expectBlack = y < BLACK_KEY_HEIGHT && blackAbove !== undefined
        expect(rect.black).toBe(expectBlack)
      }
    }
  })

  it('gives the same answers for the same notes handed over as another object', () => {
    const copy = { first: range.first, last: range.last }
    for (let i = 0; i < 200; i++) {
      const x = (i + 0.5) / 200
      expect(noteAtPoint(x, BLACK_ZONE_Y, copy)).toBe(noteAtPoint(x, BLACK_ZONE_Y, range))
      expect(noteAtPoint(x, WHITE_ZONE_Y, copy)).toBe(noteAtPoint(x, WHITE_ZONE_Y, range))
    }
  })

  it('returns null outside the box', () => {
    expect(noteAtPoint(-0.001, 0.5, range)).toBeNull()
    expect(noteAtPoint(1, 0.5, range)).toBeNull()
    expect(noteAtPoint(0.5, -0.001, range)).toBeNull()
    expect(noteAtPoint(0.5, 1, range)).toBeNull()
    expect(noteAtPoint(2, 3, range)).toBeNull()
  })

  it('returns null for a box that has no size (NaN or infinite fractions)', () => {
    expect(noteAtPoint(Number.NaN, 0.5, range)).toBeNull()
    expect(noteAtPoint(0.5, Number.NaN, range)).toBeNull()
    expect(noteAtPoint(Number.POSITIVE_INFINITY, 0.5, range)).toBeNull()
    expect(noteAtPoint(0.5, Number.NEGATIVE_INFINITY, range)).toBeNull()
  })
})

describe('noteAtPoint on pianos of different shapes', () => {
  it('starts the full piano on A, with its first black key between A and B', () => {
    const full = pianoRange(88, 3)
    const [a0, aSharp0, b0] = [21, 22, 23]
    const whiteWidth = rectOf(a0, full).width
    expect(noteAtPoint(whiteWidth * 0.3, BLACK_ZONE_Y, full)).toBe(a0)
    expect(noteAtPoint(whiteWidth, BLACK_ZONE_Y, full)).toBe(aSharp0)
    expect(noteAtPoint(whiteWidth, WHITE_ZONE_Y, full)).toBe(b0)
    expect(noteAtPoint(whiteWidth * 1.6, BLACK_ZONE_Y, full)).toBe(b0)
    // The top key, C8, has no black key over its right half.
    expect(noteAtPoint(0.9999, BLACK_ZONE_Y, full)).toBe(108)
  })

  it('follows the piano when it shows other notes', () => {
    // The same spot is a different note on each piano.
    const spot = [0.5, WHITE_ZONE_Y] as const
    const found = PIANOS.map(([, range]) => noteAtPoint(...spot, range))
    expect(new Set(found).size).toBeGreaterThan(1)
    // A piano of 37 keys is the keyboard zone: moving the zone moves every note by an octave.
    for (let baseOctave = 1; baseOctave < 5; baseOctave++) {
      const here = noteAtPoint(0.3, BLACK_ZONE_Y, pianoRange(37, baseOctave))
      const higher = noteAtPoint(0.3, BLACK_ZONE_Y, pianoRange(37, baseOctave + 1))
      expect(higher).toBe((here ?? 0) + 12)
    }
  })

  it('works for a piano that is not one of the four sizes', () => {
    // One octave from F to E: 7 white keys, 5 black.
    const octave = { first: 53, last: 64 }
    expect(notesAlongLine(0.001, BLACK_ZONE_Y, 0.999, BLACK_ZONE_Y, octave)).toEqual(notesOf(octave))
    expect(noteAtPoint(0.5, WHITE_ZONE_Y, octave)).toBe(59)
  })

  it('finds no key on a piano that has none', () => {
    const empty = { first: 60, last: 59 }
    expect(noteAtPoint(0.5, 0.5, empty)).toBeNull()
    expect(notesAlongLine(0.1, 0.5, 0.9, 0.5, empty)).toEqual([null])
  })
})

describe.each(PIANOS)('notesAlongLine on a piano of %s', (_name, range) => {
  const allNotes = notesOf(range)
  const whiteNotes = allNotes.filter((midi) => !isBlackKey(midi))
  const centre = (midi: Midi): number => centreOfNote(midi, range)

  it('gives every white key between two points below the black keys, in order', () => {
    const line = notesAlongLine(centre(C4), WHITE_ZONE_Y, centre(G4), WHITE_ZONE_Y, range)
    expect(line).toEqual([C4, D4, E4, F4, G4])
  })

  it('works from right to left too', () => {
    const line = notesAlongLine(centre(G4), WHITE_ZONE_Y, centre(C4), WHITE_ZONE_Y, range)
    expect(line).toEqual([G4, F4, E4, D4, C4])
  })

  it('includes the black keys when the line runs through them', () => {
    const line = notesAlongLine(centre(C4), BLACK_ZONE_Y, centre(E4), BLACK_ZONE_Y, range)
    expect(line).toEqual([C4, C_SHARP_4, D4, D_SHARP_4, E4])
  })

  it('misses no key from one end of the piano to the other, wherever on the first key it starts', () => {
    const lowestKey = rectOf(range.first, range)
    const firstBlackKey = keyRects(range).find((rect) => rect.black)
    if (!firstBlackKey) throw new Error('the piano has no black key')
    for (let i = 0; i < 40; i++) {
      // Every key shows in the upper part of the piano, even the narrow tops of the white keys.
      const upperStart = (i / 40) * firstBlackKey.left
      expect(notesAlongLine(upperStart, BLACK_ZONE_Y, 0.9999, BLACK_ZONE_Y, range)).toEqual(allNotes)
      expect(notesAlongLine(0.9999, BLACK_ZONE_Y, upperStart, BLACK_ZONE_Y, range)).toEqual(
        allNotes.toReversed(),
      )
      // Below the black keys there are only the white ones.
      const lowerStart = (i / 40) * lowestKey.width
      expect(notesAlongLine(lowerStart, WHITE_ZONE_Y, 0.9999, WHITE_ZONE_Y, range)).toEqual(
        whiteNotes,
      )
    }
  })

  it('gives the one key when the line never leaves it', () => {
    const x = centre(D4)
    const nudge = rectOf(D4, range).width / 50
    expect(notesAlongLine(x, WHITE_ZONE_Y, x, WHITE_ZONE_Y, range)).toEqual([D4])
    expect(notesAlongLine(x, 0.05, x + nudge, 0.95, range)).toEqual([D4])
  })

  it('follows a line straight down from a black key onto the white key below it, and back up', () => {
    const cSharp = rectOf(C_SHARP_4, range)
    // The left half of C♯ lies over C.
    const x = cSharp.left + cSharp.width * 0.25
    expect(notesAlongLine(x, BLACK_ZONE_Y, x, WHITE_ZONE_Y, range)).toEqual([C_SHARP_4, C4])
    expect(notesAlongLine(x, WHITE_ZONE_Y, x, BLACK_ZONE_Y, range)).toEqual([C4, C_SHARP_4])
  })

  it('follows a slanted line through both rows of keys', () => {
    // From the top of D, across D♯, down to the bottom of E.
    expect(notesAlongLine(centre(D4), 0.2, centre(E4), 0.9, range)).toEqual([D4, D_SHARP_4, E4])
    expect(notesAlongLine(centre(E4), 0.9, centre(D4), 0.2, range)).toEqual([E4, D_SHARP_4, D4])
  })

  it('does not fill in a line that starts or ends off the piano', () => {
    const c = centre(C4)
    const g = centre(G4)
    // Ends above the piano: nothing is under the end point.
    expect(notesAlongLine(c, WHITE_ZONE_Y, g, -0.2, range)).toEqual([null])
    // Starts above the piano: only the key it lands on.
    expect(notesAlongLine(c, -0.2, g, WHITE_ZONE_Y, range)).toEqual([G4])
    expect(notesAlongLine(-0.1, 0.5, 1.2, 0.5, range)).toEqual([null])
  })

  it('gives no key for a box that has no size', () => {
    expect(notesAlongLine(Number.NaN, Number.NaN, Number.NaN, Number.NaN, range)).toEqual([null])
    expect(notesAlongLine(0.5, 0.5, Number.POSITIVE_INFINITY, 0.5, range)).toEqual([null])
  })

  it('starts on the first key, ends on the last and never jumps over a key (2000 random lines)', () => {
    // A small fixed random sequence, so a failure can be reproduced.
    let seed = 20261111
    const random = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0
      return seed / 2 ** 32
    }
    // Two black keys never touch, and two keys that touch are at most two notes apart (C and D around C♯).
    const touch = (a: Midi, b: Midi): boolean =>
      a !== b && Math.abs(a - b) <= 2 && !(isBlackKey(a) && isBlackKey(b))

    for (let i = 0; i < 2000; i++) {
      const [fromX, fromY, toX, toY] = [random(), random(), random(), random()]
      const line = notesAlongLine(fromX, fromY, toX, toY, range)
      const where = `line ${fromX}, ${fromY} to ${toX}, ${toY} gave ${line.join(' ')}`
      expect(line[0], where).toBe(noteAtPoint(fromX, fromY, range))
      expect(line.at(-1), where).toBe(noteAtPoint(toX, toY, range))
      for (let n = 1; n < line.length; n++) {
        const [previous, next] = [line[n - 1], line[n]]
        if (previous == null || next == null) throw new Error(where)
        expect(touch(previous, next), where).toBe(true)
      }
    }
  })

  it('lets a fast drag play each key on the way once, releasing the previous one first', () => {
    const log: string[] = []
    const notes = createPointerNotes(
      (midi) => log.push(`down ${midi}`),
      (midi) => log.push(`up ${midi}`),
    )
    // The pointer is pressed on C and its next reported position is already on E.
    notes.down(1, C4)
    for (const note of notesAlongLine(centre(C4), BLACK_ZONE_Y, centre(E4), BLACK_ZONE_Y, range)) {
      notes.move(1, note)
    }
    notes.up(1)
    expect(log).toEqual([
      'down 60',
      'up 60',
      'down 61',
      'up 61',
      'down 62',
      'up 62',
      'down 63',
      'up 63',
      'down 64',
      'up 64',
    ])
  })
})

describe('createPointerNotes', () => {
  function setup() {
    const log: string[] = []
    const notes = createPointerNotes(
      (midi) => log.push(`down ${midi}`),
      (midi) => log.push(`up ${midi}`),
    )
    return { log, notes }
  }

  it('plays on press and stops on release', () => {
    const { log, notes } = setup()
    notes.down(1, 60)
    expect(notes.isDown(1)).toBe(true)
    notes.up(1)
    expect(notes.isDown(1)).toBe(false)
    expect(log).toEqual(['down 60', 'up 60'])
  })

  it('releases the previous key before pressing the next one when dragging', () => {
    const { log, notes } = setup()
    notes.down(1, 60)
    notes.move(1, 62)
    notes.move(1, 64)
    notes.up(1)
    expect(log).toEqual(['down 60', 'up 60', 'down 62', 'up 62', 'down 64', 'up 64'])
  })

  it('does not repeat a note while the pointer stays on the same key', () => {
    const { log, notes } = setup()
    notes.down(1, 60)
    notes.move(1, 60)
    notes.move(1, 60)
    expect(log).toEqual(['down 60'])
  })

  it('releases when the pointer leaves the piano and plays again when it comes back', () => {
    const { log, notes } = setup()
    notes.down(1, 60)
    notes.move(1, null)
    expect(notes.isDown(1)).toBe(true)
    expect(log).toEqual(['down 60', 'up 60'])
    notes.move(1, 65)
    notes.up(1)
    expect(log).toEqual(['down 60', 'up 60', 'down 65', 'up 65'])
  })

  it('starts playing when a pointer pressed off the keys is dragged onto one', () => {
    const { log, notes } = setup()
    notes.down(1, null)
    expect(log).toEqual([])
    notes.move(1, 60)
    expect(log).toEqual(['down 60'])
  })

  it('ignores pointers that are not pressed', () => {
    const { log, notes } = setup()
    notes.move(1, 60)
    notes.up(1)
    expect(notes.isDown(1)).toBe(false)
    expect(log).toEqual([])
  })

  it('plays several keys at once with several pointers', () => {
    const { log, notes } = setup()
    notes.down(1, 60)
    notes.down(2, 64)
    notes.up(1)
    notes.up(2)
    expect(log).toEqual(['down 60', 'down 64', 'up 60', 'up 64'])
  })

  it('keeps a note down until the last pointer on it lets go', () => {
    const { log, notes } = setup()
    notes.down(1, 60)
    notes.down(2, 60)
    expect(log).toEqual(['down 60'])
    notes.up(1)
    expect(log).toEqual(['down 60'])
    notes.up(2)
    expect(log).toEqual(['down 60', 'up 60'])
  })

  it('keeps a shared note down when one of its pointers slides to another key', () => {
    const { log, notes } = setup()
    notes.down(1, 60)
    notes.down(2, 60)
    notes.move(2, 62)
    expect(log).toEqual(['down 60', 'down 62'])
    notes.move(1, 62)
    expect(log).toEqual(['down 60', 'down 62', 'up 60'])
    notes.up(1)
    notes.up(2)
    expect(log).toEqual(['down 60', 'down 62', 'up 60', 'up 62'])
  })

  it('treats a repeated release as a single release', () => {
    const { log, notes } = setup()
    notes.down(1, 60)
    notes.up(1)
    notes.up(1)
    expect(log).toEqual(['down 60', 'up 60'])
  })

  it('releaseAll stops each sounding note once and forgets the pointers', () => {
    const { log, notes } = setup()
    notes.down(1, 60)
    notes.down(2, 60)
    notes.down(3, 67)
    notes.down(4, null)
    notes.releaseAll()
    expect(log).toEqual(['down 60', 'down 67', 'up 60', 'up 67'])
    expect([1, 2, 3, 4].some((id) => notes.isDown(id))).toBe(false)

    // The pointers are still physically down: their later moves and releases must do nothing.
    notes.move(1, 62)
    notes.up(1)
    notes.up(3)
    notes.releaseAll()
    expect(log).toEqual(['down 60', 'down 67', 'up 60', 'up 67'])
  })

  it('works again after releaseAll', () => {
    const { log, notes } = setup()
    notes.down(1, 60)
    notes.releaseAll()
    notes.down(1, 60)
    notes.up(1)
    expect(log).toEqual(['down 60', 'up 60', 'down 60', 'up 60'])
  })

  it('matches every down with exactly one up through a messy sequence', () => {
    const { log, notes } = setup()
    notes.down(1, 60)
    notes.down(2, 61)
    notes.move(1, 61)
    notes.move(2, null)
    notes.down(3, 60)
    notes.move(2, 60)
    notes.up(3)
    notes.move(1, 72)
    notes.releaseAll()

    const balance = new Map<number, number>()
    for (const entry of log) {
      const [kind, midi] = entry.split(' ')
      const change = kind === 'down' ? 1 : -1
      const next = (balance.get(Number(midi)) ?? 0) + change
      expect(next === 0 || next === 1).toBe(true)
      balance.set(Number(midi), next)
    }
    expect([...balance.values()].every((count) => count === 0)).toBe(true)
  })
})
