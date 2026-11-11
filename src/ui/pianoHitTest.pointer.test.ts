/**
 * The pure half of the piano, pushed harder than the everyday tests do: every
 * pixel of real piano sizes, long random runs checked against a simple
 * reference, and what is hit checked against the geometry that the piano and
 * the light above it are drawn from.
 */
import { describe, expect, it } from 'vitest'
import { MAX_BASE_OCTAVE, MIN_BASE_OCTAVE, PIANO_SIZES, pianoRange } from '../core/layout'
import type { PianoRange } from '../core/layout'
import { isBlackKey } from '../core/notes'
import { keyRectOf, keyRects, whiteKeyCount } from '../core/pianoGeometry'
import { BLACK_KEY_HEIGHT, createPointerNotes, noteAtPoint } from './pianoHitTest'

/** A fixed pseudo-random sequence, so that a failure can be reproduced. */
function randomSource(seed: number): (limit: number) => number {
  let state = seed
  return (limit) => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state % limit
  }
}

/** Every size of piano, with the keyboard zone at each of its positions. */
function everyPiano(): PianoRange[] {
  const pianos = new Set<PianoRange>()
  for (const size of PIANO_SIZES) {
    for (let baseOctave = MIN_BASE_OCTAVE; baseOctave <= MAX_BASE_OCTAVE; baseOctave++) {
      pianos.add(pianoRange(size, baseOctave))
    }
  }
  return [...pianos]
}

describe('noteAtPoint on real piano sizes', () => {
  // The piano is as wide as the window: a laptop, the same at 125% and 150%
  // display scaling, a large screen and a small window. Heights are what the
  // piano gives itself there, give or take.
  const sizes: readonly (readonly [number, number])[] = [
    [1366, 144.47],
    [1092.8, 115.59],
    [910.67, 110],
    [1920, 203.08],
    [800, 215.22],
  ]

  it.each(PIANO_SIZES)('gives every pixel of a piano of %i keys to the key that is drawn there', (size) => {
    const range = pianoRange(size, 3)
    const rects = keyRects(range)
    const wrong: string[] = []
    for (const [width, height] of sizes) {
      const rows = [
        0,
        1,
        Math.floor(height * BLACK_KEY_HEIGHT) - 1,
        Math.ceil(height * BLACK_KEY_HEIGHT),
        Math.floor(height) - 1,
      ]
      for (let px = 0; px < Math.floor(width); px++) {
        const x = (px + 0.5) / width
        for (const py of rows) {
          const y = (py + 0.5) / height
          const note = noteAtPoint(x, y, range)
          const rect = note === null ? null : keyRectOf(note, range)
          const blackHere = rects.some((key) => key.black && x >= key.left && x < key.left + key.width)
          const right =
            rect !== null &&
            x >= rect.left &&
            x < rect.left + rect.width &&
            rect.black === (blackHere && y < BLACK_KEY_HEIGHT)
          if (!right) wrong.push(`pixel ${px}, ${py} of a ${width} wide piano gave note ${note}`)
        }
      }
    }
    expect(wrong).toEqual([])
  })

  it('never falls between two keys at an exact key boundary', () => {
    for (const range of everyPiano()) {
      for (const rect of keyRects(range)) {
        for (const x of [rect.left, rect.left + rect.width]) {
          if (x < 0 || x >= 1) continue
          expect(noteAtPoint(x, 0.1, range)).not.toBeNull()
          expect(noteAtPoint(x, 0.9, range)).not.toBeNull()
        }
      }
    }
  })

  it('reaches each key of the piano somewhere, and nothing else', () => {
    for (const range of everyPiano()) {
      const upper = new Set<number | null>()
      const lower = new Set<number | null>()
      for (let i = 0; i < 8000; i++) {
        upper.add(noteAtPoint((i + 0.5) / 8000, 0.2, range))
        lower.add(noteAtPoint((i + 0.5) / 8000, 0.9, range))
      }
      const all = keyRects(range).map((rect) => rect.midi)
      expect([...upper].sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual(all)
      expect([...lower].sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual(
        all.filter((midi) => !isBlackKey(midi)),
      )
    }
  })
})

describe('what is hit and what is drawn share one geometry', () => {
  // The light above the piano (rising bars, falling notes, sparks) is placed
  // with the same `keyRects`. If the hit test agrees with them, a click under
  // a bar of light plays the note of that bar.
  it('finds, in the middle of every drawn key, that key', () => {
    for (const range of everyPiano()) {
      for (const rect of keyRects(range)) {
        const middle = rect.left + rect.width / 2
        // At the very top of the piano, where the light lands.
        expect(noteAtPoint(middle, 0.01, range)).toBe(rect.midi)
        // And at its lower edge, for the keys that reach it.
        if (!rect.black) expect(noteAtPoint(middle, 0.99, range)).toBe(rect.midi)
      }
    }
  })

  it('gives a white key the whole width that is drawn for it, below the black keys', () => {
    for (const range of everyPiano()) {
      const whiteWidth = 1 / whiteKeyCount(range)
      for (const rect of keyRects(range).filter((key) => !key.black)) {
        expect(rect.width).toBeCloseTo(whiteWidth, 12)
        for (const share of [0.02, 0.5, 0.98]) {
          expect(noteAtPoint(rect.left + rect.width * share, 0.9, range)).toBe(rect.midi)
        }
      }
    }
  })

  it('gives a black key the whole width that is drawn for it, down to where it ends', () => {
    for (const range of everyPiano()) {
      for (const rect of keyRects(range).filter((key) => key.black)) {
        for (const share of [0.02, 0.5, 0.98]) {
          const x = rect.left + rect.width * share
          expect(noteAtPoint(x, 0, range)).toBe(rect.midi)
          expect(noteAtPoint(x, BLACK_KEY_HEIGHT - 0.001, range)).toBe(rect.midi)
          expect(noteAtPoint(x, BLACK_KEY_HEIGHT, range)).not.toBe(rect.midi)
        }
      }
    }
  })

  it('keeps the first and the last key inside the piano', () => {
    for (const range of everyPiano()) {
      const rects = keyRects(range)
      const [first, last] = [rects[0], rects.at(-1)]
      if (!first || !last) throw new Error('a piano without keys')
      expect(first.left).toBe(0)
      expect(last.left + last.width).toBeCloseTo(1, 12)
      expect(first.black || last.black).toBe(false)
    }
  })
})

describe('createPointerNotes against a simple reference', () => {
  it('always sounds exactly the notes that some pressed pointer is on (20000 random steps)', () => {
    const random = randomSource(7)
    const sounding = new Set<number>()
    let mismatched = 0
    const notes = createPointerNotes(
      (midi) => {
        if (sounding.has(midi)) mismatched++
        sounding.add(midi)
      },
      (midi) => {
        if (!sounding.delete(midi)) mismatched++
      },
    )
    /** The reference: where each pressed pointer is. */
    const reference = new Map<number, number | null>()

    // `mismatched` also counts every step after which the two disagree.
    for (let step = 0; step < 20000; step++) {
      const pointer = random(5)
      const midi = random(4) === 0 ? null : 60 + random(4)
      switch (random(10)) {
        case 0:
        case 1:
        case 2:
          notes.down(pointer, midi)
          reference.set(pointer, midi)
          break
        case 3:
        case 4:
        case 5:
        case 6:
          notes.move(pointer, midi)
          if (reference.has(pointer)) reference.set(pointer, midi)
          break
        case 7:
        case 8:
          notes.up(pointer)
          reference.delete(pointer)
          break
        default:
          if (random(8) === 0) {
            notes.releaseAll()
            reference.clear()
          }
      }
      const expected = new Set([...reference.values()].filter((value) => value !== null))
      if (expected.size !== sounding.size || [...expected].some((note) => !sounding.has(note))) mismatched++
      for (let id = 0; id < 5; id++) if (notes.isDown(id) !== reference.has(id)) mismatched++
    }
    expect(mismatched).toBe(0)

    notes.releaseAll()
    expect(sounding.size).toBe(0)
  })

  it('lets a pointer id be reused straight away after releaseAll (the mouse is always pointer 1)', () => {
    const log: string[] = []
    const notes = createPointerNotes(
      (midi) => log.push(`down ${midi}`),
      (midi) => log.push(`up ${midi}`),
    )
    notes.down(1, 60)
    notes.releaseAll()
    // The same note with the same pointer must sound again: nothing may remember the old press.
    notes.down(1, 60)
    notes.move(1, 60)
    notes.up(1)
    expect(log).toEqual(['down 60', 'up 60', 'down 60', 'up 60'])
  })
})
