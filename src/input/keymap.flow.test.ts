/**
 * Long random runs of key changes, checked against a deliberately simple
 * second implementation. Whatever the user does in "Customize keys", one key
 * must play one note and one note must have one key.
 */
import { describe, expect, it } from 'vitest'
import { SLOT_COUNT } from '../core/layout'
import {
  DEFAULT_BINDINGS,
  assignBinding,
  clearSlot,
  codeForSlot,
  isBindableCode,
  sanitizeBindings,
} from './keymap'
import type { Bindings } from './keymap'

/** A small seeded random generator, so a failing run can be repeated exactly. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state)
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296
  }
}

const CODES = [
  'KeyA',
  'KeyS',
  'KeyD',
  'KeyK',
  'KeyZ',
  'Digit1',
  'Semicolon',
  'Quote',
  'IntlBackslash',
  'Numpad5',
  'NumpadAdd',
  'Slash',
] as const

function pick<Item>(random: () => number, items: readonly Item[]): Item {
  const item = items[Math.floor(random() * items.length)]
  if (item === undefined) throw new Error('nothing to pick from')
  return item
}

function expectOneKeyPerNote(bindings: Bindings): void {
  const entries = Object.entries(bindings)
  for (const [code, slot] of entries) {
    expect(isBindableCode(code)).toBe(true)
    expect(Number.isInteger(slot) && slot >= 0 && slot < SLOT_COUNT).toBe(true)
  }
  expect(new Set(entries.map(([, slot]) => slot)).size).toBe(entries.length)
  // Nothing that saving and loading would drop or change.
  expect(sanitizeBindings(JSON.parse(JSON.stringify(bindings)))).toEqual(bindings)
}

describe('random runs of key changes', () => {
  it.each([1, 2, 3, 4, 5])('keep one key per note and match a simple model (seed %i)', (seed) => {
    const random = seededRandom(seed)
    let bindings: Bindings = DEFAULT_BINDINGS
    /** The simple model: code -> slot. */
    const model = new Map<string, number>(Object.entries(DEFAULT_BINDINGS))

    for (let step = 0; step < 400; step += 1) {
      const slot = Math.floor(random() * SLOT_COUNT)
      const before = bindings
      const snapshot = JSON.stringify(before)

      if (random() < 0.75) {
        const code = pick(random, CODES)
        const previousSlot = model.get(code) ?? null
        const previousCode = [...model].find(([, boundSlot]) => boundSlot === slot)?.[0] ?? null

        const result = assignBinding(bindings, code, slot)

        if (previousCode !== null) model.delete(previousCode)
        model.set(code, slot)
        expect(result.replacedCode).toBe(previousCode === code ? null : previousCode)
        expect(result.vacatedSlot).toBe(previousSlot === slot ? null : previousSlot)
        expect(codeForSlot(result.bindings, slot)).toBe(code)
        bindings = result.bindings
      } else {
        const boundCode = [...model].find(([, boundSlot]) => boundSlot === slot)?.[0]
        const next = clearSlot(bindings, slot)
        if (boundCode === undefined) expect(next).toBe(bindings)
        else model.delete(boundCode)
        expect(codeForSlot(next, slot)).toBeNull()
        bindings = next
      }

      // The object that was passed in is never changed.
      expect(JSON.stringify(before)).toBe(snapshot)
      expect({ ...bindings }).toEqual(Object.fromEntries(model))
      expectOneKeyPerNote(bindings)
    }
  })

  it('can empty the piano completely and fill it again', () => {
    let bindings: Bindings = DEFAULT_BINDINGS
    for (let slot = 0; slot < SLOT_COUNT; slot += 1) bindings = clearSlot(bindings, slot)
    expect(bindings).toEqual({})
    expect(sanitizeBindings(bindings)).toEqual({})

    for (const [code, slot] of Object.entries(DEFAULT_BINDINGS)) {
      bindings = assignBinding(bindings, code, slot).bindings
    }
    expect(bindings).toEqual(DEFAULT_BINDINGS)
  })
})

describe('keys that cannot be given a note', () => {
  it.each(['', 'Space', 'Escape', 'Unidentified', 'constructor', '__proto__', 'keya', 'KeyAA'])(
    'refuses "%s" without changing anything',
    (code) => {
      expect(isBindableCode(code)).toBe(false)
      expect(() => assignBinding(DEFAULT_BINDINGS, code, 0)).toThrow(RangeError)
      expect(DEFAULT_BINDINGS).toEqual(sanitizeBindings({ ...DEFAULT_BINDINGS, [code]: 0 }))
    },
  )

})

describe('keys that are only inherited', () => {
  it('are never taken for the keys of the piano', () => {
    // These keys have nothing of their own: "Q plays piano key 5" comes from another object.
    const inherited: Bindings = Object.create({ KeyQ: 5 })

    expect(codeForSlot(inherited, 5)).toBeNull()
    expect(clearSlot(inherited, 5)).toBe(inherited)
    // Q gets its first piano key: no piano key is left without one.
    expect(assignBinding(inherited, 'KeyQ', 0)).toEqual({
      bindings: { KeyQ: 0 },
      replacedCode: null,
      vacatedSlot: null,
    })
    // Piano key 5 gets its first key: no other key loses it.
    expect(assignBinding(inherited, 'KeyZ', 5)).toEqual({
      bindings: { KeyZ: 5 },
      replacedCode: null,
      vacatedSlot: null,
    })
  })
})
