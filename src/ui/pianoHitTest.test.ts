import { describe, expect, it } from 'vitest'
import { KEY_RECTS } from '../core/keyGeometry'
import type { KeyRect } from '../core/keyGeometry'
import { SLOT_COUNT } from '../core/layout'
import { BLACK_KEY_HEIGHT, createPointerNotes, slotAtPoint, slotsAlongLine } from './pianoHitTest'

const WHITE_ZONE_Y = (BLACK_KEY_HEIGHT + 1) / 2
const BLACK_ZONE_Y = BLACK_KEY_HEIGHT / 2

function centreOf(rect: KeyRect): number {
  return rect.left + rect.width / 2
}

function containsX(rect: KeyRect, x: number): boolean {
  return x >= rect.left && x < rect.left + rect.width
}

function centreOfSlot(slot: number): number {
  const rect = KEY_RECTS[slot]
  if (!rect) throw new Error(`no key for slot ${slot}`)
  return centreOf(rect)
}

describe('slotAtPoint', () => {
  it('finds every white key below the black keys', () => {
    for (const rect of KEY_RECTS.filter((r) => !r.black)) {
      expect(slotAtPoint(centreOf(rect), WHITE_ZONE_Y)).toBe(rect.slot)
    }
  })

  it('finds every black key in the upper part of the piano', () => {
    for (const rect of KEY_RECTS.filter((r) => r.black)) {
      expect(slotAtPoint(centreOf(rect), BLACK_ZONE_Y)).toBe(rect.slot)
      expect(slotAtPoint(rect.left, 0)).toBe(rect.slot)
    }
  })

  it('gives the white key underneath once the pointer is below a black key', () => {
    const cSharp = KEY_RECTS[1]
    expect(cSharp?.black).toBe(true)
    if (!cSharp) return
    // C♯ straddles the line between C (slot 0) and D (slot 2).
    expect(slotAtPoint(cSharp.left + cSharp.width * 0.25, BLACK_ZONE_Y)).toBe(1)
    expect(slotAtPoint(cSharp.left + cSharp.width * 0.25, BLACK_KEY_HEIGHT)).toBe(0)
    expect(slotAtPoint(cSharp.left + cSharp.width * 0.75, WHITE_ZONE_Y)).toBe(2)
  })

  it('gives the white key between black keys in the upper part', () => {
    // The top of D (slot 2) shows between C♯ and D♯; E and F (slots 4, 5) have no black key between them.
    const d = KEY_RECTS[2]
    const f = KEY_RECTS[5]
    if (!d || !f) throw new Error('geometry is missing keys')
    expect(slotAtPoint(centreOf(d), BLACK_ZONE_Y)).toBe(2)
    expect(slotAtPoint(f.left - 0.001, BLACK_ZONE_Y)).toBe(4)
    expect(slotAtPoint(f.left + 0.001, BLACK_ZONE_Y)).toBe(5)
  })

  it('covers the whole box, edge to edge', () => {
    expect(slotAtPoint(0, 0)).toBe(0)
    expect(slotAtPoint(0, 0.999)).toBe(0)
    expect(slotAtPoint(0.9999, 0)).toBe(SLOT_COUNT - 1)
    expect(slotAtPoint(0.9999, 0.999)).toBe(SLOT_COUNT - 1)
  })

  it('agrees with the drawn geometry everywhere', () => {
    const steps = 400
    for (let i = 0; i < steps; i++) {
      const x = (i + 0.5) / steps
      for (const y of [0.01, BLACK_ZONE_Y, BLACK_KEY_HEIGHT - 0.001, BLACK_KEY_HEIGHT, 0.99]) {
        const slot = slotAtPoint(x, y)
        const rect = slot === null ? undefined : KEY_RECTS[slot]
        if (!rect) throw new Error(`no key at ${x}, ${y}`)
        expect(containsX(rect, x)).toBe(true)

        const blackAbove = KEY_RECTS.find((r) => r.black && containsX(r, x))
        const expectBlack = y < BLACK_KEY_HEIGHT && blackAbove !== undefined
        expect(rect.black).toBe(expectBlack)
      }
    }
  })

  it('returns null outside the box', () => {
    expect(slotAtPoint(-0.001, 0.5)).toBeNull()
    expect(slotAtPoint(1, 0.5)).toBeNull()
    expect(slotAtPoint(0.5, -0.001)).toBeNull()
    expect(slotAtPoint(0.5, 1)).toBeNull()
    expect(slotAtPoint(2, 3)).toBeNull()
  })

  it('returns null for a box that has no size (NaN or infinite fractions)', () => {
    expect(slotAtPoint(Number.NaN, 0.5)).toBeNull()
    expect(slotAtPoint(0.5, Number.NaN)).toBeNull()
    expect(slotAtPoint(Number.POSITIVE_INFINITY, 0.5)).toBeNull()
    expect(slotAtPoint(0.5, Number.NEGATIVE_INFINITY)).toBeNull()
  })
})

describe('slotsAlongLine', () => {
  // The lowest keys of the piano, by slot.
  const C = 0
  const C_SHARP = 1
  const D = 2
  const D_SHARP = 3
  const E = 4
  const F = 5
  const G = 7
  const ALL_SLOTS = Array.from({ length: SLOT_COUNT }, (_, slot) => slot)
  const WHITE_SLOTS = KEY_RECTS.filter((rect) => !rect.black).map((rect) => rect.slot)

  it('gives every white key between two points below the black keys, in order', () => {
    const line = slotsAlongLine(centreOfSlot(C), WHITE_ZONE_Y, centreOfSlot(G), WHITE_ZONE_Y)
    expect(line).toEqual([C, D, E, F, G])
  })

  it('works from right to left too', () => {
    const line = slotsAlongLine(centreOfSlot(G), WHITE_ZONE_Y, centreOfSlot(C), WHITE_ZONE_Y)
    expect(line).toEqual([G, F, E, D, C])
  })

  it('includes the black keys when the line runs through them', () => {
    const line = slotsAlongLine(centreOfSlot(C), BLACK_ZONE_Y, centreOfSlot(E), BLACK_ZONE_Y)
    expect(line).toEqual([C, C_SHARP, D, D_SHARP, E])
  })

  it('misses no key from one end of the piano to the other, wherever on the first key it starts', () => {
    const lowestKey = KEY_RECTS[C]
    const firstBlackKey = KEY_RECTS[C_SHARP]
    if (!lowestKey || !firstBlackKey) throw new Error('geometry is missing keys')
    for (let i = 0; i < 40; i++) {
      // Every key shows in the upper part of the piano, even the narrow tops of the white keys.
      const upperStart = (i / 40) * firstBlackKey.left
      expect(slotsAlongLine(upperStart, BLACK_ZONE_Y, 0.9999, BLACK_ZONE_Y)).toEqual(ALL_SLOTS)
      expect(slotsAlongLine(0.9999, BLACK_ZONE_Y, upperStart, BLACK_ZONE_Y)).toEqual(
        ALL_SLOTS.toReversed(),
      )
      // Below the black keys there are only the white ones.
      const lowerStart = (i / 40) * lowestKey.width
      expect(slotsAlongLine(lowerStart, WHITE_ZONE_Y, 0.9999, WHITE_ZONE_Y)).toEqual(WHITE_SLOTS)
    }
  })

  it('gives the one key when the line never leaves it', () => {
    const x = centreOfSlot(D)
    expect(slotsAlongLine(x, WHITE_ZONE_Y, x, WHITE_ZONE_Y)).toEqual([D])
    expect(slotsAlongLine(x, 0.05, x + 0.001, 0.95)).toEqual([D])
  })

  it('follows a line straight down from a black key onto the white key below it, and back up', () => {
    const cSharp = KEY_RECTS[C_SHARP]
    if (!cSharp) throw new Error('geometry is missing keys')
    // The left half of C♯ lies over C.
    const x = cSharp.left + cSharp.width * 0.25
    expect(slotsAlongLine(x, BLACK_ZONE_Y, x, WHITE_ZONE_Y)).toEqual([C_SHARP, C])
    expect(slotsAlongLine(x, WHITE_ZONE_Y, x, BLACK_ZONE_Y)).toEqual([C, C_SHARP])
  })

  it('follows a slanted line through both rows of keys', () => {
    // From the top of D, across D♯, down to the bottom of E.
    expect(slotsAlongLine(centreOfSlot(D), 0.2, centreOfSlot(E), 0.9)).toEqual([D, D_SHARP, E])
    expect(slotsAlongLine(centreOfSlot(E), 0.9, centreOfSlot(D), 0.2)).toEqual([E, D_SHARP, D])
  })

  it('does not fill in a line that starts or ends off the piano', () => {
    const c = centreOfSlot(C)
    const g = centreOfSlot(G)
    // Ends above the piano: nothing is under the end point.
    expect(slotsAlongLine(c, WHITE_ZONE_Y, g, -0.2)).toEqual([null])
    // Starts above the piano: only the key it lands on.
    expect(slotsAlongLine(c, -0.2, g, WHITE_ZONE_Y)).toEqual([G])
    expect(slotsAlongLine(-0.1, 0.5, 1.2, 0.5)).toEqual([null])
  })

  it('gives no key for a box that has no size', () => {
    expect(slotsAlongLine(Number.NaN, Number.NaN, Number.NaN, Number.NaN)).toEqual([null])
    expect(slotsAlongLine(0.5, 0.5, Number.POSITIVE_INFINITY, 0.5)).toEqual([null])
  })

  it('starts on the first key, ends on the last and never jumps over a key (2000 random lines)', () => {
    // A small fixed random sequence, so a failure can be reproduced.
    let seed = 20261111
    const random = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0
      return seed / 2 ** 32
    }
    const isBlack = (slot: number): boolean => KEY_RECTS[slot]?.black === true
    // Two black keys never touch, and two keys that touch are at most two slots apart (C and D around C♯).
    const touch = (a: number, b: number): boolean =>
      a !== b && Math.abs(a - b) <= 2 && !(isBlack(a) && isBlack(b))

    for (let i = 0; i < 2000; i++) {
      const [fromX, fromY, toX, toY] = [random(), random(), random(), random()]
      const line = slotsAlongLine(fromX, fromY, toX, toY)
      const where = `line ${fromX}, ${fromY} to ${toX}, ${toY} gave ${line.join(' ')}`
      expect(line[0], where).toBe(slotAtPoint(fromX, fromY))
      expect(line.at(-1), where).toBe(slotAtPoint(toX, toY))
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
    // (Slot numbers stand in for the notes here.)
    notes.down(1, C)
    for (const slot of slotsAlongLine(centreOfSlot(C), BLACK_ZONE_Y, centreOfSlot(E), BLACK_ZONE_Y)) {
      notes.move(1, slot)
    }
    notes.up(1)
    expect(log).toEqual([
      'down 0',
      'up 0',
      'down 1',
      'up 1',
      'down 2',
      'up 2',
      'down 3',
      'up 3',
      'down 4',
      'up 4',
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
