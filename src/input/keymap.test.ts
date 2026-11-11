import { describe, expect, it } from 'vitest'
import { DEFAULT_BASE_OCTAVE, SLOT_COUNT, isValidSlot, slotToMidi } from '../core/layout'
import { isBlackKey } from '../core/notes'
import {
  DEFAULT_BINDINGS,
  KEY_PRESETS,
  assignBinding,
  clearSlot,
  codeForSlot,
  isBindableCode,
  matchingPreset,
  sanitizeBindings,
} from './keymap'
import type { Bindings, KeyPresetId } from './keymap'

const LETTER_CODES = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].map((letter) => `Key${letter}`)
const DIGIT_CODES = [...'0123456789'].map((digit) => `Digit${digit}`)
const NUMPAD_DIGIT_CODES = [...'0123456789'].map((digit) => `Numpad${digit}`)
const SYMBOL_CODES = [
  'Minus',
  'Equal',
  'BracketLeft',
  'BracketRight',
  'Backslash',
  'Semicolon',
  'Quote',
  'Backquote',
  'Comma',
  'Period',
  'Slash',
  'IntlBackslash',
  'IntlRo',
  'IntlYen',
]
const NUMPAD_SYMBOL_CODES = [
  'NumpadDecimal',
  'NumpadAdd',
  'NumpadSubtract',
  'NumpadMultiply',
  'NumpadDivide',
]
const ALL_BINDABLE_CODES = [
  ...LETTER_CODES,
  ...DIGIT_CODES,
  ...SYMBOL_CODES,
  ...NUMPAD_DIGIT_CODES,
  ...NUMPAD_SYMBOL_CODES,
]

/** One key = one note: every code is bindable, every slot is valid, no slot is used twice. */
function expectOneKeyOneNote(bindings: Bindings): void {
  const slots = Object.values(bindings)
  for (const code of Object.keys(bindings)) expect(isBindableCode(code)).toBe(true)
  for (const slot of slots) expect(isValidSlot(slot)).toBe(true)
  expect(new Set(slots).size).toBe(slots.length)
}

/** Small seeded generator, so the random test is the same on every run. */
function createRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let mixed = Math.imul(state ^ (state >>> 15), state | 1)
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61)
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296
  }
}

function pick<T>(items: readonly T[], random: () => number): T {
  const item = items[Math.floor(random() * items.length)]
  if (item === undefined) throw new Error('pick() needs a non-empty list')
  return item
}

const ALL_SLOTS = Array.from({ length: SLOT_COUNT }, (_, slot) => slot)

/** Slot 0 is a C wherever the piano sits, so the colour of a slot never changes. */
function isBlackSlot(slot: number): boolean {
  return isBlackKey(slotToMidi(slot, DEFAULT_BASE_OCTAVE))
}

function presetBindings(id: KeyPresetId): Bindings {
  const preset = KEY_PRESETS.find((candidate) => candidate.id === id)
  if (preset === undefined) throw new Error(`There is no preset called "${id}".`)
  return preset.bindings
}

/** The keys that carry these letters on a US keyboard, in the order given. */
function letterKeys(letters: string): string[] {
  return [...letters].map((letter) => `Key${letter}`)
}

/** The slots these keys play, in the order the keys are given. */
function slotsOf(bindings: Bindings, codes: readonly string[]): (number | undefined)[] {
  return codes.map((code) => bindings[code])
}

function lowestFirst(slots: readonly number[]): number[] {
  return [...slots].sort((first, second) => first - second)
}

describe('DEFAULT_BINDINGS', () => {
  it('puts the white keys on the home row and the black keys above, from middle C', () => {
    expect(DEFAULT_BINDINGS).toEqual({
      KeyA: 12,
      KeyW: 13,
      KeyS: 14,
      KeyE: 15,
      KeyD: 16,
      KeyF: 17,
      KeyT: 18,
      KeyG: 19,
      KeyY: 20,
      KeyH: 21,
      KeyU: 22,
      KeyJ: 23,
      KeyK: 24,
      KeyO: 25,
      KeyL: 26,
      KeyP: 27,
      Semicolon: 28,
      Quote: 29,
    })
  })

  it('respects one key = one note', () => {
    expectOneKeyOneNote(DEFAULT_BINDINGS)
    expect(Object.keys(DEFAULT_BINDINGS)).toHaveLength(18)
  })

  it('cannot be changed by accident', () => {
    expect(Object.isFrozen(DEFAULT_BINDINGS)).toBe(true)
  })
})

describe('isBindableCode', () => {
  it('accepts every key on the allow-list', () => {
    expect(ALL_BINDABLE_CODES).toHaveLength(65)
    for (const code of ALL_BINDABLE_CODES) expect(isBindableCode(code), code).toBe(true)
  })

  it('rejects keys that do something else in the browser', () => {
    const notBindable = [
      'Space',
      'Enter',
      'NumpadEnter',
      'Tab',
      'Escape',
      'Backspace',
      'Delete',
      'Insert',
      'Home',
      'End',
      'PageUp',
      'PageDown',
      'ArrowUp',
      'ArrowDown',
      'ArrowLeft',
      'ArrowRight',
      'F1',
      'F12',
      'ShiftLeft',
      'ShiftRight',
      'ControlLeft',
      'AltRight',
      'MetaLeft',
      'CapsLock',
      'NumLock',
      'ContextMenu',
      'NumpadEqual',
      'NumpadComma',
    ]
    for (const code of notBindable) expect(isBindableCode(code), code).toBe(false)
  })

  it('rejects look-alikes, empty strings and names found on every object', () => {
    const notBindable = [
      '',
      'keya',
      'KEYA',
      'KeyAA',
      'Key',
      'Key1',
      'Keyé',
      'Digit',
      'Digit10',
      'DigitA',
      'Numpad',
      'Numpad10',
      ' KeyA',
      'KeyA ',
      'a',
      'A',
      ';',
      '__proto__',
      'constructor',
      'prototype',
      'toString',
      'hasOwnProperty',
      'valueOf',
    ]
    for (const code of notBindable) expect(isBindableCode(code), code).toBe(false)
  })

  it('returns false instead of throwing for values that are not strings', () => {
    const notStrings: unknown[] = [undefined, null, 12, {}, [], ['KeyA'], Symbol('KeyA')]
    for (const value of notStrings) expect(isBindableCode(value as string)).toBe(false)
  })
})

describe('codeForSlot', () => {
  it('finds the key bound to a slot', () => {
    expect(codeForSlot(DEFAULT_BINDINGS, 12)).toBe('KeyA')
    expect(codeForSlot(DEFAULT_BINDINGS, 28)).toBe('Semicolon')
    expect(codeForSlot(DEFAULT_BINDINGS, 29)).toBe('Quote')
  })

  it('returns null for a slot with no key, an invalid slot or empty bindings', () => {
    expect(codeForSlot(DEFAULT_BINDINGS, 0)).toBeNull()
    expect(codeForSlot(DEFAULT_BINDINGS, 30)).toBeNull()
    expect(codeForSlot(DEFAULT_BINDINGS, -1)).toBeNull()
    expect(codeForSlot(DEFAULT_BINDINGS, 12.5)).toBeNull()
    expect(codeForSlot(DEFAULT_BINDINGS, Number.NaN)).toBeNull()
    expect(codeForSlot({}, 12)).toBeNull()
  })
})

describe('assignBinding', () => {
  it('binds an unused key to an empty slot', () => {
    const result = assignBinding(DEFAULT_BINDINGS, 'KeyZ', 0)
    expect(result.bindings).toEqual({ ...DEFAULT_BINDINGS, KeyZ: 0 })
    expect(result.replacedCode).toBeNull()
    expect(result.vacatedSlot).toBeNull()
  })

  it('reports the key that used to play the slot', () => {
    const result = assignBinding(DEFAULT_BINDINGS, 'KeyZ', 12)
    expect(result.bindings.KeyZ).toBe(12)
    expect(result.bindings).not.toHaveProperty('KeyA')
    expect(result.replacedCode).toBe('KeyA')
    expect(result.vacatedSlot).toBeNull()
    expectOneKeyOneNote(result.bindings)
  })

  it('reports the slot the key used to play', () => {
    const result = assignBinding(DEFAULT_BINDINGS, 'KeyA', 0)
    expect(result.bindings.KeyA).toBe(0)
    expect(codeForSlot(result.bindings, 12)).toBeNull()
    expect(result.replacedCode).toBeNull()
    expect(result.vacatedSlot).toBe(12)
    expectOneKeyOneNote(result.bindings)
  })

  it('reports both when a bound key takes a slot that already had a key', () => {
    const result = assignBinding(DEFAULT_BINDINGS, 'KeyA', 14)
    expect(result.bindings.KeyA).toBe(14)
    expect(result.bindings).not.toHaveProperty('KeyS')
    expect(codeForSlot(result.bindings, 12)).toBeNull()
    expect(result.replacedCode).toBe('KeyS')
    expect(result.vacatedSlot).toBe(12)
    expect(Object.keys(result.bindings)).toHaveLength(17)
    expectOneKeyOneNote(result.bindings)
  })

  it('changes nothing when the key already plays that slot', () => {
    const result = assignBinding(DEFAULT_BINDINGS, 'KeyA', 12)
    expect(result.bindings).toBe(DEFAULT_BINDINGS)
    expect(result.replacedCode).toBeNull()
    expect(result.vacatedSlot).toBeNull()
  })

  it('works from empty bindings and on the first and last slot', () => {
    const first = assignBinding({}, 'Digit1', 0)
    expect(first.bindings).toEqual({ Digit1: 0 })
    const last = assignBinding(first.bindings, 'NumpadAdd', SLOT_COUNT - 1)
    expect(last.bindings).toEqual({ Digit1: 0, NumpadAdd: SLOT_COUNT - 1 })
  })

  it('never mutates its input', () => {
    const input: Record<string, number> = { KeyA: 12, KeyS: 14 }
    const result = assignBinding(input, 'KeyA', 14)
    expect(input).toEqual({ KeyA: 12, KeyS: 14 })
    expect(result.bindings).not.toBe(input)
    expect(result.bindings).toEqual({ KeyA: 14 })
  })

  it('throws RangeError for a key that cannot be bound', () => {
    for (const code of ['Space', 'Enter', 'ShiftLeft', 'F5', '', '__proto__', 'constructor']) {
      expect(() => assignBinding(DEFAULT_BINDINGS, code, 12), code).toThrow(RangeError)
    }
  })

  it('throws RangeError for a slot that is not on the piano', () => {
    const badSlots = [
      -1,
      SLOT_COUNT,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      '12' as unknown as number,
    ]
    for (const slot of badSlots) {
      expect(() => assignBinding(DEFAULT_BINDINGS, 'KeyZ', slot), String(slot)).toThrow(RangeError)
    }
  })
})

describe('clearSlot', () => {
  it('removes the key bound to the slot', () => {
    const cleared = clearSlot(DEFAULT_BINDINGS, 12)
    expect(cleared).not.toHaveProperty('KeyA')
    expect(Object.keys(cleared)).toHaveLength(17)
    expect(DEFAULT_BINDINGS.KeyA).toBe(12)
  })

  it('returns the same object when nothing was bound', () => {
    expect(clearSlot(DEFAULT_BINDINGS, 0)).toBe(DEFAULT_BINDINGS)
    expect(clearSlot(DEFAULT_BINDINGS, -1)).toBe(DEFAULT_BINDINGS)
    expect(clearSlot(DEFAULT_BINDINGS, Number.NaN)).toBe(DEFAULT_BINDINGS)
    const empty: Bindings = {}
    expect(clearSlot(empty, 5)).toBe(empty)
  })

  it('can clear every slot', () => {
    let bindings = DEFAULT_BINDINGS
    for (let slot = 0; slot < SLOT_COUNT; slot++) bindings = clearSlot(bindings, slot)
    expect(bindings).toEqual({})
  })
})

describe('sanitizeBindings', () => {
  it('returns null for anything that is not a plain object', () => {
    const notPlainObjects: unknown[] = [
      null,
      undefined,
      0,
      12,
      Number.NaN,
      '',
      'KeyA',
      true,
      [],
      [['KeyA', 12]],
      new Map([['KeyA', 12]]),
      new Set(['KeyA']),
      new Date(0),
      () => 12,
      Symbol('bindings'),
    ]
    for (const raw of notPlainObjects) expect(sanitizeBindings(raw)).toBeNull()
  })

  it('accepts an empty object: the user cleared every key', () => {
    expect(sanitizeBindings({})).toEqual({})
  })

  it('keeps valid bindings as they are', () => {
    expect(sanitizeBindings(DEFAULT_BINDINGS)).toEqual(DEFAULT_BINDINGS)
    expect(sanitizeBindings(JSON.parse(JSON.stringify(DEFAULT_BINDINGS)))).toEqual(DEFAULT_BINDINGS)
    expect(sanitizeBindings({ Numpad0: 0, IntlBackslash: 36 })).toEqual({
      Numpad0: 0,
      IntlBackslash: 36,
    })
  })

  it('accepts an object that has no prototype', () => {
    const bare: Record<string, unknown> = Object.create(null)
    bare.KeyA = 3
    expect(sanitizeBindings(bare)).toEqual({ KeyA: 3 })
  })

  it('drops keys that cannot be bound', () => {
    expect(
      sanitizeBindings({ KeyA: 1, Space: 2, Enter: 3, ShiftLeft: 4, F1: 5, keya: 6, '': 7, a: 8 }),
    ).toEqual({ KeyA: 1 })
  })

  it('drops slots that are not whole numbers on the piano', () => {
    const raw = {
      KeyA: -1,
      KeyB: SLOT_COUNT,
      KeyC: 1.5,
      KeyD: Number.NaN,
      KeyE: Number.POSITIVE_INFINITY,
      KeyF: '12',
      KeyG: null,
      KeyH: true,
      KeyI: [12],
      KeyJ: { slot: 12 },
      KeyK: undefined,
      KeyL: 0,
      KeyM: SLOT_COUNT - 1,
    }
    expect(sanitizeBindings(raw)).toEqual({ KeyL: 0, KeyM: SLOT_COUNT - 1 })
  })

  it('keeps the first key when two keys point at the same slot', () => {
    expect(sanitizeBindings({ KeyA: 5, KeyB: 5, KeyC: 6, KeyD: 5 })).toEqual({ KeyA: 5, KeyC: 6 })
    expect(sanitizeBindings(JSON.parse('{"KeyQ":7,"KeyA":7}'))).toEqual({ KeyQ: 7 })
  })

  it('ignores prototype-style keys and leaves prototypes alone', () => {
    const raw: unknown = JSON.parse(`{
      "__proto__": { "polluted": true, "KeyZ": 3 },
      "constructor": { "prototype": { "polluted": true } },
      "prototype": 4,
      "toString": 5,
      "KeyA": 12
    }`)
    const cleaned = sanitizeBindings(raw)
    expect(cleaned).toEqual({ KeyA: 12 })
    expect(Object.keys(cleaned ?? {})).toEqual(['KeyA'])
    expect(Object.getPrototypeOf(cleaned)).toBe(Object.prototype)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    expect(Object.prototype).not.toHaveProperty('KeyZ')
  })

  it('does not read entries that are only inherited', () => {
    expect(sanitizeBindings(Object.create({ KeyA: 12 }))).toBeNull()
    expect(sanitizeBindings(JSON.parse('{"__proto__":{"KeyA":12}}'))).toEqual({})
  })

  it('returns a new object and never mutates its input', () => {
    const raw = { KeyA: 1, Space: 2 }
    const cleaned = sanitizeBindings(raw)
    expect(cleaned).not.toBe(raw)
    expect(raw).toEqual({ KeyA: 1, Space: 2 })
  })

  it('never throws and never lets bad data through, whatever it is given', () => {
    const garbage: unknown[] = [
      { KeyA: { KeyB: { KeyC: 1 } } },
      { KeyA: [1, 2, 3], KeyB: 'x'.repeat(1000) },
      { 0: 0, 1: 1, length: 2 },
      JSON.parse('[{"KeyA":1}]'),
      JSON.parse('{"KeyA":1e999,"KeyB":-0,"KeyC":1e-7,"KeyD":36.0000001,"KeyE":36}'),
      JSON.parse('"KeyA"'),
      JSON.parse('null'),
      JSON.parse('12'),
      Object.fromEntries(ALL_BINDABLE_CODES.map((code) => [code, 3])),
      Object.fromEntries(ALL_BINDABLE_CODES.map((code, index) => [code, index])),
    ]
    for (const raw of garbage) {
      const cleaned = sanitizeBindings(raw)
      if (cleaned !== null) expectOneKeyOneNote(cleaned)
    }
    expect(Object.keys(sanitizeBindings(garbage[4]) ?? {})).toEqual(['KeyB', 'KeyE'])
    expect(Object.keys(sanitizeBindings(garbage[8]) ?? {})).toEqual(['KeyA'])
    expect(Object.keys(sanitizeBindings(garbage[9]) ?? {})).toHaveLength(SLOT_COUNT)
  })
})

describe('one key = one note, whatever the user does', () => {
  it('holds through a long random sequence of changes', () => {
    const random = createRandom(20261111)
    const allSlots = Array.from({ length: SLOT_COUNT }, (_, slot) => slot)
    let bindings = DEFAULT_BINDINGS
    // A deliberately simple second implementation to compare against.
    const expected = new Map(Object.entries(DEFAULT_BINDINGS))

    for (let step = 0; step < 5000; step++) {
      const before = bindings
      const beforeCopy = { ...bindings }
      const action = random()

      if (action < 0.6) {
        const code = pick(ALL_BINDABLE_CODES, random)
        const slot = pick(allSlots, random)
        const previousSlot = expected.get(code) ?? null
        const previousCode = [...expected].find(([, bound]) => bound === slot)?.[0] ?? null
        const alreadyThere = previousSlot === slot

        const result = assignBinding(bindings, code, slot)

        if (previousCode !== null) expected.delete(previousCode)
        expected.set(code, slot)
        expect(result.replacedCode).toBe(alreadyThere ? null : previousCode)
        expect(result.vacatedSlot).toBe(alreadyThere ? null : previousSlot)
        expect(result.bindings[code]).toBe(slot)
        bindings = result.bindings
      } else if (action < 0.9) {
        const slot = pick(allSlots, random)
        const boundCode = [...expected].find(([, bound]) => bound === slot)?.[0] ?? null
        if (boundCode !== null) expected.delete(boundCode)

        const cleared = clearSlot(bindings, slot)

        if (boundCode === null) expect(cleared).toBe(bindings)
        bindings = cleared
      } else {
        // What happens between two visits: saved as text, read back, cleaned.
        const reloaded = sanitizeBindings(JSON.parse(JSON.stringify(bindings)))
        expect(reloaded).not.toBeNull()
        bindings = reloaded ?? bindings
      }

      expect(before).toEqual(beforeCopy)
      expectOneKeyOneNote(bindings)
      expect(bindings).toEqual(Object.fromEntries(expected))
    }
  })

  it('holds after cleaning random garbage', () => {
    const random = createRandom(37)
    const codes = [...ALL_BINDABLE_CODES, 'Space', 'Enter', '__proto__', 'constructor', 'x', '']
    const slots: unknown[] = [
      ...Array.from({ length: SLOT_COUNT }, (_, slot) => slot),
      -1,
      SLOT_COUNT,
      0.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      '3',
      null,
      {},
      [],
    ]

    for (let round = 0; round < 500; round++) {
      const entryCount = Math.floor(random() * 80)
      const entries = Array.from({ length: entryCount }, (): [string, unknown] => [
        pick(codes, random),
        pick(slots, random),
      ])
      const cleaned = sanitizeBindings(Object.fromEntries(entries))
      expect(cleaned).not.toBeNull()
      expectOneKeyOneNote(cleaned ?? {})
    }
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })
})

describe('KEY_PRESETS', () => {
  it('lists the three layouts in the order shown to the player, with their exact wording', () => {
    const wording = KEY_PRESETS.map(({ id, name, description }) => ({ id, name, description }))
    expect(wording).toEqual([
      {
        id: 'home-row',
        name: 'Home row',
        description: 'The middle row plays the white keys, the row above plays the black keys.',
      },
      {
        id: 'two-octaves',
        name: 'Two octaves',
        description: 'Two rows for a low octave, two rows for a high octave.',
      },
      {
        id: 'white-keys',
        name: 'White keys only',
        description: 'Three rows, three octaves, no black keys. Good for simple tunes.',
      },
    ])
  })

  it('starts with the default keys: the very same object', () => {
    expect(KEY_PRESETS[0]?.id).toBe('home-row')
    expect(KEY_PRESETS[0]?.bindings).toBe(DEFAULT_BINDINGS)
  })

  it.each(KEY_PRESETS)('$name: respects one key = one note', ({ bindings }) => {
    expectOneKeyOneNote(bindings)
    expect(Object.keys(bindings).length).toBeGreaterThan(0)
  })

  it.each(KEY_PRESETS)('$name: is unchanged by saving and loading', ({ bindings }) => {
    const cleaned = sanitizeBindings(bindings)
    expect(cleaned).toEqual(bindings)
    expect(Object.keys(cleaned ?? {})).toEqual(Object.keys(bindings))
    expect(sanitizeBindings(JSON.parse(JSON.stringify(bindings)))).toEqual(bindings)
  })

  it.each(KEY_PRESETS)('$name: cannot be changed by accident', (preset) => {
    expect(Object.isFrozen(KEY_PRESETS)).toBe(true)
    expect(Object.isFrozen(preset)).toBe(true)
    expect(Object.isFrozen(preset.bindings)).toBe(true)
  })

  describe('Two octaves', () => {
    const bindings = presetBindings('two-octaves')
    const lowRow = letterKeys('ZXCVBNM')
    const highRow = [...letterKeys('QWERTYUIOP'), 'BracketLeft', 'BracketRight']

    it('has exactly these keys', () => {
      expect(bindings).toEqual({
        KeyZ: 0,
        KeyS: 1,
        KeyX: 2,
        KeyD: 3,
        KeyC: 4,
        KeyV: 5,
        KeyG: 6,
        KeyB: 7,
        KeyH: 8,
        KeyN: 9,
        KeyJ: 10,
        KeyM: 11,
        KeyQ: 12,
        Digit2: 13,
        KeyW: 14,
        Digit3: 15,
        KeyE: 16,
        KeyR: 17,
        Digit5: 18,
        KeyT: 19,
        Digit6: 20,
        KeyY: 21,
        Digit7: 22,
        KeyU: 23,
        KeyI: 24,
        Digit9: 25,
        KeyO: 26,
        Digit0: 27,
        KeyP: 28,
        BracketLeft: 29,
        Equal: 30,
        BracketRight: 31,
      })
    })

    it('plays every note from the first key of the piano upward, skipping none', () => {
      expect(lowestFirst(Object.values(bindings))).toEqual(ALL_SLOTS.slice(0, 32))
    })

    it('plays the white keys on the two rows of letters, left to right', () => {
      expect(slotsOf(bindings, lowRow)).toEqual([0, 2, 4, 5, 7, 9, 11])
      expect(slotsOf(bindings, highRow)).toEqual([12, 14, 16, 17, 19, 21, 23, 24, 26, 28, 29, 31])
      for (const slot of slotsOf(bindings, [...lowRow, ...highRow])) {
        expect(isBlackSlot(slot ?? Number.NaN)).toBe(false)
      }
    })

    it('plays each black key on the key that sits above the gap between its neighbours', () => {
      // [white key on the left, key above the gap, white key on the right]
      const gaps = [
        ['KeyZ', 'KeyS', 'KeyX'],
        ['KeyX', 'KeyD', 'KeyC'],
        ['KeyV', 'KeyG', 'KeyB'],
        ['KeyB', 'KeyH', 'KeyN'],
        ['KeyN', 'KeyJ', 'KeyM'],
        ['KeyQ', 'Digit2', 'KeyW'],
        ['KeyW', 'Digit3', 'KeyE'],
        ['KeyR', 'Digit5', 'KeyT'],
        ['KeyT', 'Digit6', 'KeyY'],
        ['KeyY', 'Digit7', 'KeyU'],
        ['KeyI', 'Digit9', 'KeyO'],
        ['KeyO', 'Digit0', 'KeyP'],
        ['BracketLeft', 'Equal', 'BracketRight'],
      ]
      for (const gap of gaps) {
        const [left, black, right] = slotsOf(bindings, gap)
        expect(isBlackSlot(black ?? Number.NaN), gap[1]).toBe(true)
        expect(black, gap[1]).toBe((left ?? Number.NaN) + 1)
        expect(black, gap[1]).toBe((right ?? Number.NaN) - 1)
      }
      expect(gaps).toHaveLength(Object.values(bindings).filter(isBlackSlot).length)
    })

    it('leaves the keys above E–F and B–C alone: a piano has no black key there', () => {
      for (const code of ['KeyF', 'Digit4', 'Digit8', 'Minus']) {
        expect(bindings, code).not.toHaveProperty(code)
      }
    })

    it('starts its high octave on middle C', () => {
      expect(bindings.KeyQ).toBe(DEFAULT_BINDINGS.KeyA)
    })
  })

  describe('White keys only', () => {
    const bindings = presetBindings('white-keys')
    const oneOctaveOfWhiteKeys = [0, 2, 4, 5, 7, 9, 11]

    it('has exactly these keys', () => {
      expect(bindings).toEqual({
        KeyZ: 0,
        KeyX: 2,
        KeyC: 4,
        KeyV: 5,
        KeyB: 7,
        KeyN: 9,
        KeyM: 11,
        KeyA: 12,
        KeyS: 14,
        KeyD: 16,
        KeyF: 17,
        KeyG: 19,
        KeyH: 21,
        KeyJ: 23,
        KeyQ: 24,
        KeyW: 26,
        KeyE: 28,
        KeyR: 29,
        KeyT: 31,
        KeyY: 33,
        KeyU: 35,
        KeyI: 36,
      })
    })

    it('gives a key to every white key of the piano and to no black key', () => {
      const whiteSlots = ALL_SLOTS.filter((slot) => !isBlackSlot(slot))
      expect(whiteSlots).toHaveLength(22)
      expect(lowestFirst(Object.values(bindings))).toEqual(whiteSlots)
    })

    it('plays one octave per row of letters, the bottom row lowest', () => {
      const rows = [letterKeys('ZXCVBNM'), letterKeys('ASDFGHJ'), letterKeys('QWERTYU')]
      rows.forEach((row, octave) => {
        const whiteKeysOfThatOctave = oneOctaveOfWhiteKeys.map((slot) => slot + 12 * octave)
        expect(slotsOf(bindings, row)).toEqual(whiteKeysOfThatOctave)
      })
    })

    it('keeps middle C on the same key as the default keys', () => {
      expect(bindings.KeyA).toBe(DEFAULT_BINDINGS.KeyA)
    })

    it('plays the top C of the piano on the next key of the top row', () => {
      expect(bindings.KeyI).toBe(SLOT_COUNT - 1)
    })
  })
})

describe('matchingPreset', () => {
  it.each(KEY_PRESETS)('finds $name', ({ id, bindings }) => {
    expect(matchingPreset(bindings)).toBe(id)
  })

  it.each(KEY_PRESETS)('finds $name in a copy, after a reload and in another order', (preset) => {
    const { id, bindings } = preset
    const reloaded = sanitizeBindings(JSON.parse(JSON.stringify(bindings)))
    const reversed = Object.fromEntries(Object.entries(bindings).reverse())

    expect(matchingPreset({ ...bindings })).toBe(id)
    expect(matchingPreset(reloaded ?? {})).toBe(id)
    expect(Object.keys(reversed)).not.toEqual(Object.keys(bindings))
    expect(matchingPreset(reversed)).toBe(id)
  })

  it('finds the default keys', () => {
    expect(matchingPreset(DEFAULT_BINDINGS)).toBe('home-row')
  })

  it('returns null for keys that are no preset', () => {
    expect(matchingPreset({})).toBeNull()
    expect(matchingPreset({ KeyA: 12 })).toBeNull()
    expect(matchingPreset({ ...DEFAULT_BINDINGS, ...presetBindings('white-keys') })).toBeNull()
  })

  it.each(KEY_PRESETS)('returns null after any single change to $name', ({ bindings }) => {
    const keyCount = Object.keys(bindings).length
    let keysMoved = 0
    let keysRemoved = 0

    for (const code of ALL_BINDABLE_CODES) {
      for (const slot of ALL_SLOTS) {
        const changed = assignBinding(bindings, code, slot).bindings
        if (changed === bindings) continue
        keysMoved += 1
        expect(matchingPreset(changed), `${code} on ${slot}`).toBeNull()
      }
    }
    for (const slot of ALL_SLOTS) {
      const changed = clearSlot(bindings, slot)
      if (changed === bindings) continue
      keysRemoved += 1
      expect(matchingPreset(changed), `nothing on ${slot}`).toBeNull()
    }

    // Everything was tried: only giving a key the note it already plays changes nothing.
    expect(keysMoved).toBe(ALL_BINDABLE_CODES.length * SLOT_COUNT - keyCount)
    expect(keysRemoved).toBe(keyCount)
  })

  it('finds the preset again once a change is undone', () => {
    const changed = assignBinding(DEFAULT_BINDINGS, 'KeyZ', 0).bindings
    expect(matchingPreset(changed)).toBeNull()
    expect(matchingPreset(clearSlot(changed, 0))).toBe('home-row')
  })

  it('does not take keys that are only inherited for the keys of the player', () => {
    expect(matchingPreset(Object.create(DEFAULT_BINDINGS))).toBeNull()
  })
})
