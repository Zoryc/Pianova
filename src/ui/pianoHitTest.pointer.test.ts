/**
 * The pure halves of the piano and the trails, pushed harder than the
 * everyday tests do: every pixel of real piano sizes, long random runs
 * checked against a simple reference, and the two geometries (what is hit,
 * what is drawn above it) checked against each other.
 */
import { describe, expect, it } from 'vitest'
import { KEY_RECTS } from '../core/keyGeometry'
import { MAX_BASE_OCTAVE, MIN_BASE_OCTAVE, SLOT_COUNT, slotToMidi } from '../core/layout'
import { isBlackKey } from '../core/notes'
import {
  MAX_BARS,
  MAX_FRAME_MS,
  advanceBars,
  barRect,
  frameSeconds,
  keepHeld,
  releaseBar,
  startBar,
  staticGlowRect,
  trailSpeed,
} from './noteTrailsModel'
import type { TrailBar } from './noteTrailsModel'
import { BLACK_KEY_HEIGHT, createPointerNotes, slotAtPoint } from './pianoHitTest'

/** A fixed pseudo-random sequence, so that a failure can be reproduced. */
function randomSource(seed: number): (limit: number) => number {
  let state = seed
  return (limit) => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state % limit
  }
}

describe('slotAtPoint on real piano sizes', () => {
  // Piano widths at 1366x768, at 125% and 150% display scaling, and on a narrow window.
  const sizes: readonly (readonly [number, number])[] = [
    [1254, 228],
    [1019.33, 185.33],
    [1206, 219.27],
    [837.5, 152.27],
    [600, 140],
  ]

  it('gives every pixel of the piano to the key that is drawn there', () => {
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
          const slot = slotAtPoint(x, y)
          const rect = slot === null ? undefined : KEY_RECTS[slot]
          const blackHere = KEY_RECTS.some((key) => key.black && x >= key.left && x < key.left + key.width)
          const right =
            rect !== undefined &&
            x >= rect.left &&
            x < rect.left + rect.width &&
            rect.black === (blackHere && y < BLACK_KEY_HEIGHT)
          if (!right) wrong.push(`pixel ${px}, ${py} of a ${width} wide piano gave slot ${slot}`)
        }
      }
    }
    expect(wrong).toEqual([])
  })

  it('never falls between two keys at an exact key boundary', () => {
    for (const rect of KEY_RECTS) {
      for (const x of [rect.left, rect.left + rect.width]) {
        if (x < 0 || x >= 1) continue
        expect(slotAtPoint(x, 0.1)).not.toBeNull()
        expect(slotAtPoint(x, 0.9)).not.toBeNull()
      }
    }
  })

  it('reaches each of the 37 keys somewhere', () => {
    const reached = new Set<number | null>()
    for (let i = 0; i < 4000; i++) {
      reached.add(slotAtPoint((i + 0.5) / 4000, 0.2))
      reached.add(slotAtPoint((i + 0.5) / 4000, 0.9))
    }
    expect(reached.size).toBe(SLOT_COUNT)
    expect(reached.has(null)).toBe(false)
  })
})

describe('trails and keys share one geometry', () => {
  it('puts the middle of every trail on the key that plays its note', () => {
    const width = 1254
    const height = 160
    for (let baseOctave = MIN_BASE_OCTAVE; baseOctave <= MAX_BASE_OCTAVE; baseOctave++) {
      for (let slot = 0; slot < SLOT_COUNT; slot++) {
        const midi = slotToMidi(slot, baseOctave)
        const [bar] = startBar([], midi, baseOctave)
        if (!bar) throw new Error(`no bar for slot ${slot}`)
        expect(bar.black).toBe(isBlackKey(midi))
        for (const rect of [barRect(bar, width, height), staticGlowRect(bar, width, height)]) {
          const middle = (rect.x + rect.width / 2) / width
          // Just below the trails, at the top of the piano, the key under the middle of the bar is its own key.
          expect(slotAtPoint(middle, 0.01)).toBe(slot)
          // A white key's trail is as wide as the key, a black key's as wide as the black key.
          const key = KEY_RECTS[slot]
          if (!key) throw new Error('slot without geometry')
          expect(rect.x).toBeGreaterThanOrEqual(key.left * width)
          expect(rect.x + rect.width).toBeLessThanOrEqual((key.left + key.width) * width)
          expect(rect.width).toBeGreaterThan(key.width * width - 6)
        }
      }
    }
  })

  it('keeps the trails of the first and last key inside the canvas', () => {
    for (const width of [1254, 1019.33, 600, 300]) {
      const [first] = startBar([], slotToMidi(0, 3), 3)
      const [last] = startBar([], slotToMidi(SLOT_COUNT - 1, 3), 3)
      if (!first || !last) throw new Error('bars expected')
      expect(barRect(first, width, 160).x).toBeGreaterThanOrEqual(0)
      const lastRect = barRect(last, width, 160)
      expect(lastRect.x + lastRect.width).toBeLessThanOrEqual(width + 1e-9)
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

describe('the trail simulation over long random runs', () => {
  const HEIGHT = 160
  const FRAME = 1 / 60

  it('never leaks a bar: once every note is released the list empties, whatever happened before', () => {
    const random = randomSource(99)
    let bars: readonly TrailBar[] = []
    const held = new Set<number>()
    let broken = 0
    for (let step = 0; step < 30000; step++) {
      const midi = 48 + random(37)
      switch (random(6)) {
        case 0:
        case 1:
          bars = startBar(bars, midi, 3)
          held.add(midi)
          break
        case 2:
        case 3:
          bars = releaseBar(bars, midi)
          held.delete(midi)
          break
        default:
          bars = advanceBars(bars, FRAME, HEIGHT)
      }
      // Never too many bars; at most one bar attached to each key, and only to keys that are held.
      const attached = bars.filter((bar) => bar.held).map((bar) => bar.midi)
      const sound =
        bars.length <= MAX_BARS &&
        new Set(attached).size === attached.length &&
        attached.every((note) => held.has(note))
      if (!sound) broken++
    }
    expect(broken).toBe(0)
    for (const midi of held) bars = releaseBar(bars, midi)
    for (let frame = 0; frame < Math.ceil(HEIGHT / trailSpeed(HEIGHT) / FRAME) + 1; frame++) {
      bars = advanceBars(bars, FRAME, HEIGHT)
    }
    expect(bars).toEqual([])
  })

  it('keeps every bar finite and inside sensible bounds', () => {
    const random = randomSource(3)
    let bars: readonly TrailBar[] = []
    const wrong: TrailBar[] = []
    for (let step = 0; step < 5000; step++) {
      const midi = 48 + random(37)
      const choice = random(5)
      if (choice === 0) bars = startBar(bars, midi, 3)
      else if (choice === 1) bars = releaseBar(bars, midi)
      else bars = advanceBars(bars, frameSeconds(random(3) === 0 ? 10_000 : 16), HEIGHT)
      for (const bar of bars) {
        const sensible =
          Number.isFinite(bar.bottom) &&
          Number.isFinite(bar.height) &&
          bar.height >= 0 &&
          bar.height <= HEIGHT &&
          bar.bottom >= 0 &&
          bar.bottom < HEIGHT
        if (!sensible) wrong.push(bar)
      }
    }
    expect(wrong).toEqual([])
  })

  it('moves bars by at most one capped frame after any pause, however long', () => {
    const step = (trailSpeed(HEIGHT) * MAX_FRAME_MS) / 1000
    for (const pause of [51, 1000, 60_000, 3_600_000, Number.MAX_VALUE]) {
      const [bar] = advanceBars(startBar([], 60, 3), frameSeconds(pause), HEIGHT)
      expect(bar?.height).toBeCloseTo(step, 10)
    }
  })

  it('shrinks a held bar to a canvas that became shorter, and drops released bars that are now above it', () => {
    let bars = advanceBars(startBar([], 60, 3), 1, 200)
    bars = releaseBar(startBar(bars, 62, 3), 60)
    bars = advanceBars(bars, 0.5, 200)
    // The canvas is now only 40 pixels high.
    bars = advanceBars(bars, FRAME, 40)
    expect(bars.map((bar) => bar.midi)).toEqual([62])
    expect(bars[0]?.height).toBeLessThanOrEqual(40)
  })

  it('keeps only held bars for reduced motion, without touching them', () => {
    let bars = startBar(startBar(startBar([], 60, 3), 62, 3), 64, 3)
    bars = releaseBar(bars, 62)
    const kept = keepHeld(bars)
    expect(kept.map((bar) => bar.midi)).toEqual([60, 64])
    expect(kept[0]).toBe(bars[0])
  })
})
