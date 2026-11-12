/**
 * Checks carried over from the old key geometry (one fixed row of 37 slots),
 * which pianoGeometry.ts replaced with a piano of any size. Most of what the
 * old tests asked for is asked in pianoRange.test.ts; these are the rest,
 * and one check of how the keys of a piano are remembered from one call to
 * the next.
 */
import { describe, expect, it } from 'vitest'
import {
  MAX_BASE_OCTAVE,
  MIN_BASE_OCTAVE,
  PIANO_SIZES,
  SLOT_COUNT,
  midiToSlot,
  pianoRange,
  slotToMidi,
} from './layout'
import type { PianoSize } from './layout'
import { isBlackKey } from './notes'
import { BLACK_KEY_WIDTH_RATIO, keyRectOf, keyRects, whiteKeyCount } from './pianoGeometry'

function everyOctave(): number[] {
  const octaves: number[] = []
  for (let octave = MIN_BASE_OCTAVE; octave <= MAX_BASE_OCTAVE; octave++) octaves.push(octave)
  return octaves
}

describe('pianoGeometry: one key per note', () => {
  it('has one key for every note of the piano, lowest first, black where the note is', () => {
    for (const size of PIANO_SIZES) {
      for (const octave of everyOctave()) {
        const range = pianoRange(size, octave)
        const rects = keyRects(range)
        expect(rects).toHaveLength(size)
        rects.forEach((rect, index) => {
          expect(rect.midi).toBe(range.first + index)
          expect(rect.black).toBe(isBlackKey(rect.midi))
          expect(keyRectOf(rect.midi, range)).toBe(rect)
        })
      }
    }
  })

  it.each<[PianoSize, number, number]>([
    [37, 22, 15],
    [49, 29, 20],
    [61, 36, 25],
    [88, 52, 36],
  ])('a piano of %i keys has %i white and %i black', (size, white, black) => {
    const rects = keyRects(pianoRange(size, 3))
    expect(rects.filter((rect) => !rect.black)).toHaveLength(white)
    expect(rects.filter((rect) => rect.black)).toHaveLength(black)
    expect(whiteKeyCount(pianoRange(size, 3))).toBe(white)
  })

  // The keys of the piano asked for last are remembered, and found again by
  // its first and its last note. Two pianos that share one of the two must
  // not be taken for each other.
  it.each<[string, PianoSize, number, PianoSize, number]>([
    ['their first note', 61, 3, 49, 3],
    ['their last note', 88, 3, 37, 5],
  ])(
    'gives each piano its own keys when two pianos that share %s are asked for in turn',
    (_shared, size, octave, otherSize, otherOctave) => {
      const pianos = [pianoRange(size, octave), pianoRange(otherSize, otherOctave)] as const
      const [one, other] = pianos
      expect(one.first === other.first || one.last === other.last).toBe(true)
      expect(one).not.toEqual(other)

      const firstAnswers = pianos.map((range) => keyRects(range))
      for (let turn = 0; turn < 3; turn++) {
        pianos.forEach((range, index) => {
          const rects = keyRects(range)
          expect(rects).toHaveLength(range.last - range.first + 1)
          expect(rects[0]?.midi).toBe(range.first)
          expect(rects.at(-1)?.midi).toBe(range.last)
          // One white key of the piano is as wide as the next: the width of this piano, not of the other.
          expect(rects[0]?.width).toBeCloseTo(1 / whiteKeyCount(range), 10)
          // The same answer as the first time, and a note is found on it.
          expect(rects).toBe(firstAnswers[index])
          expect(keyRectOf(range.last, range)).toBe(rects.at(-1))
        })
      }
    },
  )
})

describe('pianoGeometry: the keyboard zone', () => {
  // The 37 keys the computer keyboard plays always start on a C. So where
  // they are drawn does not depend on which C that is: only their notes do.
  it('is drawn the same wherever it is moved: slot by slot, only the notes change', () => {
    const shape = (octave: number) =>
      keyRects(pianoRange(37, octave)).map(({ black, left, width }) => ({ black, left, width }))
    const usual = shape(3)
    expect(usual).toHaveLength(SLOT_COUNT)
    for (const octave of everyOctave()) {
      const range = pianoRange(37, octave)
      expect(shape(octave), `octave ${octave}`).toEqual(usual)
      keyRects(range).forEach((rect, slot) => {
        expect(rect.midi).toBe(slotToMidi(slot, octave))
        expect(midiToSlot(rect.midi, octave)).toBe(slot)
      })
      // And nothing is drawn for the notes just outside it.
      expect(keyRectOf(slotToMidi(0, octave) - 1, range)).toBeNull()
      expect(keyRectOf(slotToMidi(SLOT_COUNT - 1, octave) + 1, range)).toBeNull()
    }
  })

  it('keeps the first black key where it was: centred on the line between C and D, 62% of a white key wide', () => {
    const range = pianoRange(37, 3)
    const cSharp = keyRectOf(slotToMidi(1, 3), range)
    const d = keyRectOf(slotToMidi(2, 3), range)
    if (!cSharp || !d) throw new Error('the zone has a C sharp and a D')
    expect(cSharp.black).toBe(true)
    expect(cSharp.left + cSharp.width / 2).toBeCloseTo(d.left, 10)
    expect(cSharp.width).toBeCloseTo((1 / 22) * BLACK_KEY_WIDTH_RATIO, 10)
    expect(BLACK_KEY_WIDTH_RATIO).toBe(0.62)
  })

  it('ends its last white key exactly on the right edge of the piano, at every size', () => {
    for (const size of PIANO_SIZES) {
      const last = keyRects(pianoRange(size, 3)).at(-1)
      expect(last?.black).toBe(false)
      expect((last?.left ?? 0) + (last?.width ?? 0)).toBeCloseTo(1, 10)
    }
  })
})
