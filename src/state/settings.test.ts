import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ACCENT_COLOURS } from '../core/colour'
import {
  DEFAULT_BASE_OCTAVE,
  MAX_BASE_OCTAVE,
  MIN_BASE_OCTAVE,
  isValidSlot,
} from '../core/layout'
import { DEFAULT_BINDINGS, assignBinding, isBindableCode } from '../input/keymap'
import {
  DEFAULT_SETTINGS,
  MAX_TRANSPOSE,
  MIN_VELOCITY,
  STORAGE_KEY,
  createSettingsStore,
  sanitizeSettings,
  settingsStore,
  useSettings,
} from './settings'
import type { Settings, StorageLike } from './settings'

/** A handful of settings, for the tests that put only some of them back. */
const SOUND_KEYS: readonly (keyof Settings)[] = [
  'velocity',
  'transpose',
  'noteNaming',
  'reverb',
  'release',
  'showTrails',
]

const SETTING_KEYS = [
  'bindings',
  'customLabels',
  'baseOctave',
  'volume',
  'sustain',
  'labelMode',
  'velocity',
  'transpose',
  'noteNaming',
  'reverb',
  'release',
  'showTrails',
  'pianoSize',
  'keyStyle',
  'keyEffect',
  'keyboardType',
  'accent',
  'customColour',
  'glow',
  'background',
  'barStyle',
  'sparks',
  'showKeyHints',
  'showNoteNames',
  'autoHideMenu',
]

/** The settings as they were saved before the piano sizes, the key styles and the look existed. */
const SAVED_BEFORE_THE_NEW_SCREEN = {
  bindings: { KeyQ: 3, KeyW: 5 },
  customLabels: { KeyQ: 'A' },
  baseOctave: 4,
  volume: 0.5,
  sustain: true,
  labelMode: 'keys',
  velocity: 0.4,
  transpose: -2,
  noteNaming: 'solfege',
  reverb: 0.3,
  release: 'short',
  showTrails: false,
}

/** What the settings added with the new screen are when nothing says otherwise: the Ember theme. */
const NEW_SCREEN_DEFAULTS = {
  pianoSize: 'auto',
  keyStyle: 'classic',
  keyEffect: 'glow',
  keyboardType: 'auto',
  accent: 'red',
  customColour: '#ff2a2a',
  glow: 0.6,
  background: 'black',
  barStyle: 'solid',
  sparks: 'some',
  showKeyHints: true,
  showNoteNames: true,
  autoHideMenu: true,
}

/** Every value each choice may take. */
const CHOICES = {
  labelMode: ['keys', 'notes', 'both', 'none'],
  noteNaming: ['letters', 'solfege'],
  release: ['short', 'normal', 'long'],
  pianoSize: ['auto', 88, 61, 49, 37],
  keyStyle: ['classic', 'midnight', 'glass'],
  keyEffect: ['glow', 'press', 'fill', 'ripple', 'edge', 'pop'],
  keyboardType: ['auto', 'qwerty', 'azerty', 'qwertz'],
  accent: ['red', 'amber', 'blue', 'green', 'purple', 'white', 'custom', 'rainbow'],
  background: ['black', 'night', 'stars', 'aurora'],
  barStyle: ['solid', 'neon'],
  sparks: ['off', 'some', 'lots'],
} as const
const CHOICE_KEYS = Object.keys(CHOICES) as (keyof typeof CHOICES)[]

const ON_OFF_KEYS = [
  'sustain',
  'showTrails',
  'showKeyHints',
  'showNoteNames',
  'autoHideMenu',
] as const

/** A localStorage stand-in that records how it is used. */
function createFakeStorage(saved?: string) {
  const items = new Map<string, string>()
  if (saved !== undefined) items.set(STORAGE_KEY, saved)
  return {
    items,
    getItem: vi.fn((key: string): string | null => items.get(key) ?? null),
    setItem: vi.fn((key: string, value: string): void => {
      items.set(key, value)
    }),
    removeItem: vi.fn((key: string): void => {
      items.delete(key)
    }),
  }
}

/** What a later visit would read back from the fake storage. */
function savedSettings(storage: ReturnType<typeof createFakeStorage>): unknown {
  const text = storage.items.get(STORAGE_KEY)
  return text === undefined ? undefined : JSON.parse(text)
}

function expectValidSettings(settings: Settings): void {
  expect(Object.keys(settings).sort()).toEqual([...SETTING_KEYS].sort())

  const slots = Object.values(settings.bindings)
  for (const code of Object.keys(settings.bindings)) expect(isBindableCode(code)).toBe(true)
  for (const slot of slots) expect(isValidSlot(slot)).toBe(true)
  expect(new Set(slots).size).toBe(slots.length)

  for (const [code, label] of Object.entries(settings.customLabels)) {
    expect(isBindableCode(code)).toBe(true)
    expect(typeof label).toBe('string')
    expect(label.length).toBeGreaterThanOrEqual(1)
    expect(label.length).toBeLessThanOrEqual(6)
  }

  expect(Number.isInteger(settings.baseOctave)).toBe(true)
  expect(settings.baseOctave).toBeGreaterThanOrEqual(MIN_BASE_OCTAVE)
  expect(settings.baseOctave).toBeLessThanOrEqual(MAX_BASE_OCTAVE)
  for (const amount of [settings.volume, settings.reverb, settings.glow]) {
    expect(amount).toBeGreaterThanOrEqual(0)
    expect(amount).toBeLessThanOrEqual(1)
  }
  expect(settings.velocity).toBeGreaterThanOrEqual(MIN_VELOCITY)
  expect(settings.velocity).toBeLessThanOrEqual(1)
  expect(Number.isInteger(settings.transpose)).toBe(true)
  expect(Math.abs(settings.transpose)).toBeLessThanOrEqual(MAX_TRANSPOSE)
  expect(Object.is(settings.transpose, -0)).toBe(false)

  for (const key of ON_OFF_KEYS) expect(typeof settings[key]).toBe('boolean')
  for (const key of CHOICE_KEYS) expect(CHOICES[key]).toContain(settings[key])
  expect(settings.customColour).toMatch(/^#[0-9a-fA-F]{6}$/)
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

describe('defaults', () => {
  it('match the spec', () => {
    expect(DEFAULT_SETTINGS).toEqual({
      bindings: DEFAULT_BINDINGS,
      customLabels: {},
      baseOctave: DEFAULT_BASE_OCTAVE,
      volume: 0.8,
      sustain: false,
      labelMode: 'both',
      velocity: 0.8,
      transpose: 0,
      noteNaming: 'letters',
      reverb: 0.15,
      release: 'normal',
      showTrails: true,
      pianoSize: 'auto',
      keyStyle: 'classic',
      keyEffect: 'glow',
      keyboardType: 'auto',
      accent: 'red',
      customColour: '#ff2a2a',
      glow: 0.6,
      background: 'black',
      barStyle: 'solid',
      sparks: 'some',
      showKeyHints: true,
      showNoteNames: true,
      autoHideMenu: true,
    })
    expect(Object.keys(DEFAULT_SETTINGS)).toEqual(SETTING_KEYS)
    expectValidSettings(DEFAULT_SETTINGS)
  })

  it("start the player's own colour on the red of the default look", () => {
    expect(DEFAULT_SETTINGS.customColour).toBe(ACCENT_COLOURS.red)
  })

  it('cannot be changed by accident', () => {
    expect(Object.isFrozen(DEFAULT_SETTINGS)).toBe(true)
    expect(Object.isFrozen(DEFAULT_SETTINGS.bindings)).toBe(true)
    expect(Object.isFrozen(DEFAULT_SETTINGS.customLabels)).toBe(true)
  })

  it('keeps its limits and the name it is saved under', () => {
    expect(MIN_VELOCITY).toBe(0.1)
    expect(MAX_TRANSPOSE).toBe(12)
    expect(STORAGE_KEY).toBe('pianoapp.settings.v1')
  })
})

describe('sanitizeSettings', () => {
  it('returns the defaults for anything that is not an object', () => {
    const numbers = [0, 1, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY]
    const notObjects: unknown[] = [null, undefined, ...numbers, '', 'settings', true, () => 1]
    for (const raw of notObjects) expect(sanitizeSettings(raw)).toEqual(DEFAULT_SETTINGS)
  })

  it('returns the defaults for objects that hold no settings', () => {
    const saved = new Map([['volume', 0.2]])
    const empty: unknown[] = [{}, [], [1, 2, 3], saved, new Date(0), Object.create(null)]
    for (const raw of empty) expect(sanitizeSettings(raw)).toEqual(DEFAULT_SETTINGS)
  })

  it('keeps valid settings, including after a trip through JSON', () => {
    const valid: Settings = {
      bindings: { KeyZ: 0, Digit1: 36, Numpad5: 7 },
      customLabels: { KeyZ: 'W', Digit1: '&' },
      baseOctave: 2,
      volume: 0.35,
      sustain: true,
      labelMode: 'notes',
      velocity: 0.5,
      transpose: -3,
      noteNaming: 'solfege',
      reverb: 0.6,
      release: 'long',
      showTrails: false,
      pianoSize: 61,
      keyStyle: 'glass',
      keyEffect: 'ripple',
      keyboardType: 'azerty',
      accent: 'custom',
      customColour: '#12ab9f',
      glow: 0.25,
      background: 'aurora',
      barStyle: 'neon',
      sparks: 'lots',
      showKeyHints: false,
      showNoteNames: false,
      autoHideMenu: false,
    }
    expect(sanitizeSettings(valid)).toEqual(valid)
    expect(sanitizeSettings(JSON.parse(JSON.stringify(valid)))).toEqual(valid)
    expect(sanitizeSettings(JSON.parse(JSON.stringify(DEFAULT_SETTINGS)))).toEqual(DEFAULT_SETTINGS)
  })

  it('accepts every value of each choice', () => {
    for (const key of CHOICE_KEYS) {
      for (const choice of CHOICES[key]) {
        expect(sanitizeSettings({ [key]: choice })[key]).toBe(choice)
      }
    }
  })

  it('falls back to the default for unknown choices', () => {
    const objectNames = ['constructor', 'toString', '__proto__', 'hasOwnProperty']
    const notText = [3, null, true, ['keys'], { keys: true }]
    const nearMisses = ['KEYS', 'Red', 'AUTO', 'auto ', 'all', 'pink', '88', 'qwerty-us']
    for (const choice of ['', ...nearMisses, ...objectNames, ...notText]) {
      const raw = Object.fromEntries(CHOICE_KEYS.map((key) => [key, choice]))
      const cleaned = sanitizeSettings(raw)
      for (const key of CHOICE_KEYS) expect(cleaned[key]).toBe(DEFAULT_SETTINGS[key])
    }
  })

  it('accepts only the piano sizes that exist', () => {
    for (const pianoSize of ['auto', 88, 61, 49, 37]) {
      expect(sanitizeSettings({ pianoSize }).pianoSize).toBe(pianoSize)
    }
    const notSizes = [0, 36, 38, 76, 87, 88.5, -88, 1e9, Number.NaN, '61', 'big', [88], { size: 88 }]
    for (const pianoSize of [...notSizes, null, undefined, true]) {
      expect(sanitizeSettings({ pianoSize }).pianoSize).toBe('auto')
    }
  })

  it("keeps the player's own colour when it is a #rrggbb colour, exactly as it was given", () => {
    for (const customColour of ['#000000', '#ffffff', '#12ab9f', '#12AB9F', '#Ff2a2A']) {
      expect(sanitizeSettings({ customColour }).customColour).toBe(customColour)
    }
  })

  it("falls back to the default colour when the player's own colour is anything else", () => {
    const notColours = ['', '#fff', '#12ab9', '#12ab9f0', '12ab9f', '#12ab9g', ' #12ab9f', '#12ab9f\n']
    const otherNotations = ['red', 'rgb(1, 2, 3)', 'url(https://example.com/x.png)', 'var(--light)']
    const notText = [0x12ab9f, null, undefined, true, ['#12ab9f'], { colour: '#12ab9f' }]
    for (const customColour of [...notColours, ...otherNotations, ...notText]) {
      expect(sanitizeSettings({ customColour }).customColour).toBe('#ff2a2a')
    }
  })

  it('falls back to the default for numbers that are missing, not numbers or not finite', () => {
    const notNumbers = [undefined, null, '0.5', '', true, [], {}]
    const notFinite = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]
    for (const value of [...notNumbers, ...notFinite]) {
      const cleaned = sanitizeSettings({
        baseOctave: value,
        volume: value,
        velocity: value,
        transpose: value,
        reverb: value,
        glow: value,
      })
      expect(cleaned.baseOctave).toBe(DEFAULT_BASE_OCTAVE)
      expect(cleaned.volume).toBe(0.8)
      expect(cleaned.velocity).toBe(0.8)
      expect(cleaned.transpose).toBe(0)
      expect(cleaned.reverb).toBe(0.15)
      expect(cleaned.glow).toBe(0.6)
    }
  })

  it('clamps volume and room echo to 0..1', () => {
    expect(sanitizeSettings({ volume: -0.5, reverb: -3 })).toMatchObject({ volume: 0, reverb: 0 })
    expect(sanitizeSettings({ volume: 1.5, reverb: 1e9 })).toMatchObject({ volume: 1, reverb: 1 })
    expect(sanitizeSettings({ volume: 0, reverb: 0 })).toMatchObject({ volume: 0, reverb: 0 })
    expect(sanitizeSettings({ volume: 1, reverb: 1 })).toMatchObject({ volume: 1, reverb: 1 })
    expect(sanitizeSettings({ volume: 0.4, reverb: 0.1 })).toMatchObject({ volume: 0.4, reverb: 0.1 })
  })

  it('clamps the glow to 0..1', () => {
    expect(sanitizeSettings({ glow: -0.5 }).glow).toBe(0)
    expect(sanitizeSettings({ glow: 0 }).glow).toBe(0)
    expect(sanitizeSettings({ glow: 0.37 }).glow).toBe(0.37)
    expect(sanitizeSettings({ glow: 1 }).glow).toBe(1)
    expect(sanitizeSettings({ glow: 60 }).glow).toBe(1)
  })

  it('clamps touch to MIN_VELOCITY..1', () => {
    expect(sanitizeSettings({ velocity: 0 }).velocity).toBe(MIN_VELOCITY)
    expect(sanitizeSettings({ velocity: -4 }).velocity).toBe(MIN_VELOCITY)
    expect(sanitizeSettings({ velocity: 0.1 }).velocity).toBe(0.1)
    expect(sanitizeSettings({ velocity: 0.55 }).velocity).toBe(0.55)
    expect(sanitizeSettings({ velocity: 3 }).velocity).toBe(1)
  })

  it('rounds transpose to a whole number, then clamps it', () => {
    expect(sanitizeSettings({ transpose: 2.4 }).transpose).toBe(2)
    expect(sanitizeSettings({ transpose: 2.5 }).transpose).toBe(3)
    expect(sanitizeSettings({ transpose: -2.6 }).transpose).toBe(-3)
    expect(sanitizeSettings({ transpose: 12 }).transpose).toBe(12)
    expect(sanitizeSettings({ transpose: 12.4 }).transpose).toBe(12)
    expect(sanitizeSettings({ transpose: 99 }).transpose).toBe(12)
    expect(sanitizeSettings({ transpose: -12 }).transpose).toBe(-12)
    expect(sanitizeSettings({ transpose: -99 }).transpose).toBe(-12)
  })

  it('never produces a negative zero for transpose', () => {
    expect(Object.is(sanitizeSettings({ transpose: -0.4 }).transpose, 0)).toBe(true)
    expect(Object.is(sanitizeSettings({ transpose: -0 }).transpose, 0)).toBe(true)
  })

  it('rounds and clamps the piano position', () => {
    expect(sanitizeSettings({ baseOctave: 0 }).baseOctave).toBe(MIN_BASE_OCTAVE)
    expect(sanitizeSettings({ baseOctave: -7 }).baseOctave).toBe(MIN_BASE_OCTAVE)
    expect(sanitizeSettings({ baseOctave: 99 }).baseOctave).toBe(MAX_BASE_OCTAVE)
    expect(sanitizeSettings({ baseOctave: 2.6 }).baseOctave).toBe(3)
    expect(sanitizeSettings({ baseOctave: 4 }).baseOctave).toBe(4)
  })

  it('accepts only real booleans for the on/off settings', () => {
    const switched = sanitizeSettings({ sustain: true, showTrails: false })
    expect(switched.sustain).toBe(true)
    expect(switched.showTrails).toBe(false)

    for (const value of ['true', 'false', 1, 0, null, undefined, [], {}]) {
      const cleaned = sanitizeSettings({ sustain: value, showTrails: value })
      expect(cleaned.sustain).toBe(false)
      expect(cleaned.showTrails).toBe(true)
    }
  })

  it('reads every on/off setting the same way', () => {
    for (const key of ON_OFF_KEYS) {
      for (const on of [true, false]) expect(sanitizeSettings({ [key]: on })[key]).toBe(on)
      for (const value of ['true', 'false', 'on', 1, 0, null, undefined, [], {}]) {
        expect(sanitizeSettings({ [key]: value })[key]).toBe(DEFAULT_SETTINGS[key])
      }
    }
  })

  it('uses the default keys when the saved keys are not an object', () => {
    for (const bindings of [undefined, null, 'KeyA', 12, true, [], [['KeyA', 12]]]) {
      expect(sanitizeSettings({ bindings }).bindings).toEqual(DEFAULT_BINDINGS)
    }
  })

  it('keeps an empty set of keys: the user removed them all', () => {
    expect(sanitizeSettings({ bindings: {} }).bindings).toEqual({})
  })

  it('cleans the saved keys', () => {
    const bindings = { KeyA: 5, KeyB: 5, Space: 6, KeyC: 99, KeyD: 1.5, KeyE: '7', KeyF: 8 }
    expect(sanitizeSettings({ bindings }).bindings).toEqual({ KeyA: 5, KeyF: 8 })
  })

  it('keeps only short labels of keys that can be bound', () => {
    const customLabels = {
      KeyA: 'Q',
      KeyS: 'ß',
      Digit1: '&',
      Numpad1: 'Num 1',
      KeyB: '123456',
      KeyC: '1234567',
      KeyD: '',
      KeyE: 5,
      KeyF: null,
      KeyG: ['G'],
      KeyH: { label: 'H' },
      Space: 'X',
      Enter: 'Y',
      constructor: 'Z',
      toString: 'T',
    }
    expect(sanitizeSettings({ customLabels }).customLabels).toEqual({
      KeyA: 'Q',
      KeyS: 'ß',
      Digit1: '&',
      Numpad1: 'Num 1',
      KeyB: '123456',
    })
  })

  it('uses no labels when the saved labels are not an object', () => {
    const notObjects = [undefined, null, 'KeyA', 12, true, [], ['Q', 'W'], [['KeyA', 'Q']]]
    for (const customLabels of notObjects) {
      expect(sanitizeSettings({ customLabels }).customLabels).toEqual({})
    }
  })

  it('drops unknown extra keys', () => {
    const raw = { volume: 0.3, theme: 'light', version: 2, toString: 'x', nested: { a: 1 } }
    const cleaned = sanitizeSettings(raw)
    expect(Object.keys(cleaned)).toEqual(SETTING_KEYS)
    expect(cleaned.volume).toBe(0.3)
    expect(cleaned).not.toHaveProperty('theme')
    expect(cleaned).not.toHaveProperty('nested')
    expect(Object.hasOwn(cleaned, 'toString')).toBe(false)
  })

  it('fills in the newer settings when an older version saved fewer', () => {
    const fromOlderVersion = {
      bindings: { KeyQ: 3 },
      customLabels: { KeyQ: 'A' },
      baseOctave: 4,
      volume: 0.5,
      sustain: true,
      labelMode: 'keys',
    }
    expect(sanitizeSettings(fromOlderVersion)).toEqual({
      ...fromOlderVersion,
      velocity: 0.8,
      transpose: 0,
      noteNaming: 'letters',
      reverb: 0.15,
      release: 'normal',
      showTrails: true,
      ...NEW_SCREEN_DEFAULTS,
    })
  })

  it('keeps everything saved before the new screen and gives the new settings their defaults', () => {
    const expected = { ...SAVED_BEFORE_THE_NEW_SCREEN, ...NEW_SCREEN_DEFAULTS }
    expect(sanitizeSettings(SAVED_BEFORE_THE_NEW_SCREEN)).toEqual(expected)
    expect(sanitizeSettings(JSON.parse(JSON.stringify(SAVED_BEFORE_THE_NEW_SCREEN)))).toEqual(expected)
    expect(Object.keys(NEW_SCREEN_DEFAULTS)).toEqual(SETTING_KEYS.slice(-13))
  })

  it('fixes each field on its own: one bad value does not throw away the good ones', () => {
    const raw = { volume: 'loud', baseOctave: 4, labelMode: 'nope', sustain: true }
    expect(sanitizeSettings(raw)).toEqual({ ...DEFAULT_SETTINGS, baseOctave: 4, sustain: true })
  })

  it('ignores prototype-style keys and leaves prototypes alone', () => {
    const raw: unknown = JSON.parse(`{
      "__proto__": { "volume": 0.1, "polluted": true },
      "constructor": { "prototype": { "polluted": true } },
      "bindings": { "__proto__": { "KeyA": 1, "polluted": true }, "constructor": 2, "KeyS": 3 },
      "customLabels": { "__proto__": { "polluted": true }, "constructor": "C", "KeyS": "S" }
    }`)
    const cleaned = sanitizeSettings(raw)

    expect(cleaned).toEqual({
      ...DEFAULT_SETTINGS,
      bindings: { KeyS: 3 },
      customLabels: { KeyS: 'S' },
    })
    expect(Object.keys(cleaned.bindings)).toEqual(['KeyS'])
    expect(Object.keys(cleaned.customLabels)).toEqual(['KeyS'])
    for (const part of [cleaned, cleaned.bindings, cleaned.customLabels]) {
      expect(Object.getPrototypeOf(part)).toBe(Object.prototype)
    }
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    expect(Object.prototype).not.toHaveProperty('volume')
  })

  it('ignores settings that are only inherited', () => {
    const inherited: unknown = Object.create({ volume: 0.2, sustain: true, labelMode: 'none' })
    expect(sanitizeSettings(inherited)).toEqual(DEFAULT_SETTINGS)
  })

  it('never mutates its input and never hands the input objects back', () => {
    const raw = {
      bindings: { KeyA: 1, Space: 2 },
      customLabels: { KeyA: 'Q', Space: 'X' },
      volume: 9,
    }
    const copy = JSON.parse(JSON.stringify(raw))
    const cleaned = sanitizeSettings(raw)
    expect(raw).toEqual(copy)
    expect(cleaned.bindings).not.toBe(raw.bindings)
    expect(cleaned.customLabels).not.toBe(raw.customLabels)
  })

  it('survives nested garbage', () => {
    const garbage: unknown[] = [
      { bindings: { KeyA: { KeyB: { KeyC: 1 } } }, customLabels: { KeyA: { KeyB: 'x' } } },
      { bindings: [[['KeyA', 1]]], customLabels: [{ KeyA: 'x' }] },
      { bindings: { bindings: { bindings: {} } }, volume: { volume: 1 }, sustain: { on: true } },
      { volume: [0.5], reverb: ['0.5'], velocity: { valueOf: () => 0.5 }, transpose: '3' },
      JSON.parse(
        '{"volume":1e999,"reverb":-1e999,"velocity":1e-320,"transpose":1e21,"baseOctave":-1e21}',
      ),
      JSON.parse('[{"volume":0.1}]'),
      JSON.parse('{"0":{"volume":0.1},"length":1}'),
      { labelMode: { toString: () => 'keys' }, release: ['long'], noteNaming: { 0: 'solfege' } },
      { accent: { toString: () => 'blue' }, pianoSize: [88], keyStyle: ['glass'], sparks: { 0: 'off' } },
      { customColour: { toString: () => '#12ab9f' }, glow: [0.2], background: [['stars']] },
      JSON.parse('{"glow":1e999,"pianoSize":8.8e1,"customColour":["#12ab9f"],"autoHideMenu":"no"}'),
    ]
    for (const raw of garbage) expectValidSettings(sanitizeSettings(raw))
    expect(sanitizeSettings(garbage[4])).toMatchObject({
      volume: 0.8,
      reverb: 0.15,
      velocity: MIN_VELOCITY,
      transpose: 12,
      baseOctave: MIN_BASE_OCTAVE,
    })
    expect(sanitizeSettings(garbage[7])).toEqual(DEFAULT_SETTINGS)
    expect(sanitizeSettings(garbage[8])).toEqual(DEFAULT_SETTINGS)
    expect(sanitizeSettings(garbage[9])).toEqual(DEFAULT_SETTINGS)
    expect(sanitizeSettings(garbage[10])).toEqual({ ...DEFAULT_SETTINGS, pianoSize: 88 })
  })

  it('always returns valid settings for random garbage', () => {
    const random = createRandom(5173)
    const oddValues: unknown[] = [
      null,
      undefined,
      true,
      false,
      0,
      -0,
      1,
      -1,
      0.5,
      3.7,
      -12.5,
      40,
      1e21,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      '',
      'both',
      'keys',
      'solfege',
      'long',
      'auto',
      'rainbow',
      'custom',
      'glass',
      'azerty',
      'stars',
      'neon',
      'lots',
      88,
      61,
      '#12ab9f',
      '#12AB9F',
      '#12ab9',
      'constructor',
      '__proto__',
      [],
      [1, 2],
      {},
      { KeyA: 1, KeyB: 1, Space: 2 },
      { KeyA: 'Q', KeyB: '', Space: 'X', KeyC: 'far too long' },
      { KeyA: 1.5, KeyB: -1, KeyC: 37, KeyD: 36 },
      Object.create(null),
      JSON.parse('{"__proto__":{"polluted":true},"KeyA":2,"KeyZ":"Z"}'),
    ]
    const keys = [...SETTING_KEYS, '__proto__', 'constructor', 'extra', 'toString']

    for (let round = 0; round < 2000; round++) {
      const entries = keys
        .filter(() => random() < 0.8)
        .map((key): [string, unknown] => [key, oddValues[Math.floor(random() * oddValues.length)]])
      const raw: unknown = JSON.parse(JSON.stringify(Object.fromEntries(entries)))

      expectValidSettings(sanitizeSettings(Object.fromEntries(entries)))
      expectValidSettings(sanitizeSettings(raw))
    }
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })
})

describe('createSettingsStore', () => {
  it('starts with the defaults when nothing was saved', () => {
    const storage = createFakeStorage()
    expect(createSettingsStore(storage).get()).toEqual(DEFAULT_SETTINGS)
    expect(storage.getItem).toHaveBeenCalledWith(STORAGE_KEY)
    expect(storage.setItem).not.toHaveBeenCalled()
  })

  it('works in memory without any storage', () => {
    for (const storage of [undefined, null]) {
      const store = createSettingsStore(storage)
      expect(store.get()).toEqual(DEFAULT_SETTINGS)
      store.set({ volume: 0.2 })
      expect(store.get().volume).toBe(0.2)
    }
    expect(createSettingsStore().get()).toEqual(DEFAULT_SETTINGS)
  })

  it('loads what an earlier visit saved, cleaned', () => {
    const saved = {
      volume: 0.25,
      sustain: true,
      transpose: 40,
      labelMode: 'weird',
      bindings: { KeyQ: 0, Space: 1 },
    }
    const store = createSettingsStore(createFakeStorage(JSON.stringify(saved)))
    expect(store.get()).toEqual({
      ...DEFAULT_SETTINGS,
      volume: 0.25,
      sustain: true,
      transpose: 12,
      bindings: { KeyQ: 0 },
    })
  })

  it('loads settings saved before the new screen, with the defaults for what is new', () => {
    const storage = createFakeStorage(JSON.stringify(SAVED_BEFORE_THE_NEW_SCREEN))
    const store = createSettingsStore(storage)

    expect(store.get()).toEqual({ ...SAVED_BEFORE_THE_NEW_SCREEN, ...NEW_SCREEN_DEFAULTS })
    expectValidSettings(store.get())
    expect(storage.setItem).not.toHaveBeenCalled()

    store.set({ accent: 'blue' })
    expect(savedSettings(storage)).toEqual({
      ...SAVED_BEFORE_THE_NEW_SCREEN,
      ...NEW_SCREEN_DEFAULTS,
      accent: 'blue',
    })
  })

  it('falls back to the defaults when the saved text is damaged', () => {
    const damaged = ['', '{', '{"volume":', 'undefined', 'not json', '{"volume":0.5}}', '\u0000']
    for (const text of damaged) {
      const store = createSettingsStore(createFakeStorage(text))
      expect(store.get()).toEqual(DEFAULT_SETTINGS)
    }
  })

  it('falls back to the defaults when the saved text is valid JSON of the wrong kind', () => {
    for (const text of ['null', '[]', '12', '"volume"', 'true', '[{"volume":0.1}]']) {
      expect(createSettingsStore(createFakeStorage(text)).get()).toEqual(DEFAULT_SETTINGS)
    }
  })

  it('replaces damaged saved text on the next change', () => {
    const storage = createFakeStorage('{"volume":')
    const store = createSettingsStore(storage)
    store.set({ volume: 0.4 })
    expect(savedSettings(storage)).toEqual({ ...DEFAULT_SETTINGS, volume: 0.4 })
  })

  it('returns the same object until something changes', () => {
    const store = createSettingsStore(createFakeStorage(JSON.stringify({ volume: 0.3 })))
    const first = store.get()
    expect(store.get()).toBe(first)
    expect(store.get()).toBe(first)

    store.set({ sustain: true })
    const second = store.get()
    expect(second).not.toBe(first)
    expect(store.get()).toBe(second)
  })

  it('merges a change into the current settings, saves it and tells listeners once', () => {
    const storage = createFakeStorage()
    const store = createSettingsStore(storage)
    const listener = vi.fn()
    store.subscribe(listener)
    const before = store.get()

    store.set({ volume: 0.5, labelMode: 'keys' })

    expect(store.get()).toEqual({ ...DEFAULT_SETTINGS, volume: 0.5, labelMode: 'keys' })
    expect(listener).toHaveBeenCalledTimes(1)
    expect(storage.setItem).toHaveBeenCalledTimes(1)
    expect(storage.setItem).toHaveBeenCalledWith(STORAGE_KEY, JSON.stringify(store.get()))
    expect(before).toEqual(DEFAULT_SETTINGS)
  })

  it('has already changed and saved the settings when listeners are told', () => {
    const storage = createFakeStorage()
    const store = createSettingsStore(storage)
    const seen: unknown[] = []
    store.subscribe(() => {
      seen.push(store.get().volume, (savedSettings(storage) as Settings).volume)
    })
    store.set({ volume: 0.6 })
    expect(seen).toEqual([0.6, 0.6])
  })

  it('does nothing when the values are the same as the current ones', () => {
    const storage = createFakeStorage()
    const store = createSettingsStore(storage)
    store.set({ volume: 0.5, customLabels: { KeyA: 'Q' } })
    const listener = vi.fn()
    store.subscribe(listener)
    const before = store.get()
    storage.setItem.mockClear()

    store.set({})
    store.set({ volume: 0.5 })
    store.set({ volume: 0.5, sustain: false, labelMode: 'both', transpose: 0, release: 'normal' })
    store.set({ ...before })
    store.set(JSON.parse(JSON.stringify(before)))

    expect(store.get()).toBe(before)
    expect(listener).not.toHaveBeenCalled()
    expect(storage.setItem).not.toHaveBeenCalled()
  })

  it('compares keys and labels by what they contain, not by object identity', () => {
    const store = createSettingsStore(createFakeStorage())
    store.set({ customLabels: { KeyA: 'Q', KeyS: 'S' } })
    const listener = vi.fn()
    store.subscribe(listener)
    const before = store.get()

    store.set({ bindings: { ...DEFAULT_BINDINGS } })
    store.set({ bindings: Object.fromEntries(Object.entries(DEFAULT_BINDINGS).reverse()) })
    store.set({ customLabels: { KeyS: 'S', KeyA: 'Q' } })
    store.set({ bindings: assignBinding(before.bindings, 'KeyA', 12).bindings })

    expect(store.get()).toBe(before)
    expect(listener).not.toHaveBeenCalled()
  })

  it('notices every real change to keys and labels', () => {
    const store = createSettingsStore(createFakeStorage())
    const listener = vi.fn()
    store.subscribe(listener)

    store.set({ bindings: assignBinding(store.get().bindings, 'KeyZ', 0).bindings })
    expect(store.get().bindings.KeyZ).toBe(0)
    store.set({ bindings: assignBinding(store.get().bindings, 'KeyZ', 1).bindings })
    expect(store.get().bindings.KeyZ).toBe(1)
    store.set({ bindings: {} })
    expect(store.get().bindings).toEqual({})
    store.set({ customLabels: { KeyZ: 'W' } })
    store.set({ customLabels: { KeyZ: 'Y' } })
    expect(store.get().customLabels).toEqual({ KeyZ: 'Y' })
    store.set({ customLabels: { KeyX: 'Y' } })
    expect(store.get().customLabels).toEqual({ KeyX: 'Y' })

    expect(listener).toHaveBeenCalledTimes(6)
  })

  it('keeps the same keys and labels objects when another setting changes', () => {
    const store = createSettingsStore(createFakeStorage())
    store.set({ bindings: { KeyZ: 0 }, customLabels: { KeyZ: 'W' } })
    const before = store.get()

    store.set({ volume: 0.1 })

    expect(store.get()).not.toBe(before)
    expect(store.get().bindings).toBe(before.bindings)
    expect(store.get().customLabels).toBe(before.customLabels)
  })

  it('cleans what it is given', () => {
    const store = createSettingsStore(createFakeStorage())
    store.set({
      volume: 7,
      velocity: 0,
      transpose: 2.6,
      baseOctave: 99,
      glow: -2,
      bindings: { KeyA: 3, KeyB: 3, Enter: 4 },
      customLabels: { KeyA: 'Q', Enter: 'X', KeyB: 'much too long' },
    })
    expect(store.get()).toEqual({
      ...DEFAULT_SETTINGS,
      volume: 1,
      velocity: MIN_VELOCITY,
      transpose: 3,
      baseOctave: MAX_BASE_OCTAVE,
      glow: 0,
      bindings: { KeyA: 3 },
      customLabels: { KeyA: 'Q' },
    })
    expectValidSettings(store.get())
  })

  it('remembers the piano, the look and the menu choices like every other setting', () => {
    const storage = createFakeStorage()
    const store = createSettingsStore(storage)
    const listener = vi.fn()
    store.subscribe(listener)
    const look: Partial<Settings> = {
      pianoSize: 49,
      keyStyle: 'midnight',
      keyboardType: 'qwertz',
      accent: 'custom',
      customColour: '#12ab9f',
      glow: 0.9,
      background: 'stars',
      barStyle: 'neon',
      sparks: 'off',
      showKeyHints: false,
      showNoteNames: false,
      autoHideMenu: false,
    }

    store.set(look)

    expect(store.get()).toEqual({ ...DEFAULT_SETTINGS, ...look })
    expect(Object.isFrozen(store.get())).toBe(true)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(savedSettings(storage)).toEqual(store.get())
    expect(createSettingsStore(storage).get()).toEqual(store.get())

    store.set({ ...look })
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('puts a new setting back to its default when given an unusable value', () => {
    const store = createSettingsStore(createFakeStorage())
    store.set({ pianoSize: 61, accent: 'green', customColour: '#12ab9f', sparks: 'lots', glow: 1 })

    const unusable = { pianoSize: 62, accent: 'pink', customColour: 'green', sparks: 3, glow: '1' }
    store.set(unusable as unknown as Partial<Settings>)

    expect(store.get()).toEqual(DEFAULT_SETTINGS)
  })

  it('puts a setting back to its default when given an unusable value', () => {
    const store = createSettingsStore(createFakeStorage())
    store.set({ volume: 0.3, labelMode: 'none', bindings: { KeyZ: 0 } })

    const unusable = { volume: Number.NaN, labelMode: 'nope', bindings: null }
    store.set(unusable as unknown as Partial<Settings>)

    expect(store.get()).toEqual(DEFAULT_SETTINGS)
  })

  it('ignores undefined values and unknown keys in a change', () => {
    const storage = createFakeStorage()
    const store = createSettingsStore(storage)
    store.set({ volume: 0.3 })
    const listener = vi.fn()
    store.subscribe(listener)
    const before = store.get()

    store.set({ volume: undefined, bindings: undefined })
    store.set({ theme: 'light', __proto__: { volume: 0 } } as unknown as Partial<Settings>)
    store.set(JSON.parse('{"__proto__":{"volume":0},"constructor":1}'))

    expect(store.get()).toBe(before)
    expect(listener).not.toHaveBeenCalled()
    expect(Object.keys(savedSettings(storage) as object)).toEqual(SETTING_KEYS)
  })

  it('saves every change, so a later visit starts where this one stopped', () => {
    const storage = createFakeStorage()
    const store = createSettingsStore(storage)
    const changes: (() => void)[] = [
      () => store.set({ volume: 0.1 }),
      () => store.set({ bindings: assignBinding(store.get().bindings, 'Digit1', 5).bindings }),
      () => store.set({ customLabels: { Digit1: '&' } }),
      () => store.set({ sustain: true, noteNaming: 'solfege', release: 'short' }),
      () => store.resetKeys(SOUND_KEYS),
      () => store.set({ baseOctave: 5, transpose: -7 }),
      () => store.reset(),
      () => store.set({ reverb: 1 }),
    ]

    changes.forEach((change, index) => {
      change()
      expect(storage.setItem).toHaveBeenCalledTimes(index + 1)
      expect(savedSettings(storage)).toEqual(store.get())
      expect(createSettingsStore(storage).get()).toEqual(store.get())
    })
  })

  it('never hands out an object that changes later', () => {
    const store = createSettingsStore(createFakeStorage())
    const first = store.get()
    store.set({ volume: 0.1, bindings: { KeyZ: 0 } })
    const second = store.get()
    store.reset()

    expect(first).toEqual(DEFAULT_SETTINGS)
    expect(second).toEqual({ ...DEFAULT_SETTINGS, volume: 0.1, bindings: { KeyZ: 0 } })
    expect(Object.isFrozen(second)).toBe(true)
    expect(Object.isFrozen(second.bindings)).toBe(true)
    expect(Object.isFrozen(second.customLabels)).toBe(true)
  })

  describe('reset', () => {
    it('goes back to the defaults, saves and tells listeners', () => {
      const storage = createFakeStorage()
      const store = createSettingsStore(storage)
      store.set({ volume: 0.1, sustain: true, bindings: {}, customLabels: { KeyA: 'Q' } })
      store.set({ transpose: 5, showTrails: false })
      store.set({ pianoSize: 37, accent: 'rainbow', keyStyle: 'glass', autoHideMenu: false })
      const listener = vi.fn()
      store.subscribe(listener)

      store.reset()

      expect(store.get()).toEqual(DEFAULT_SETTINGS)
      expect(listener).toHaveBeenCalledTimes(1)
      expect(savedSettings(storage)).toEqual(DEFAULT_SETTINGS)
      expect(createSettingsStore(storage).get()).toEqual(DEFAULT_SETTINGS)
    })

    it('does nothing when the settings are already the defaults', () => {
      const storage = createFakeStorage()
      const store = createSettingsStore(storage)
      const listener = vi.fn()
      store.subscribe(listener)
      const before = store.get()

      store.reset()

      expect(store.get()).toBe(before)
      expect(listener).not.toHaveBeenCalled()
      expect(storage.setItem).not.toHaveBeenCalled()
    })
  })

  describe('resetKeys', () => {
    it('puts only the given settings back to their defaults', () => {
      const storage = createFakeStorage()
      const store = createSettingsStore(storage)
      const custom: Partial<Settings> = {
        bindings: { KeyZ: 0 },
        customLabels: { KeyZ: 'W' },
        baseOctave: 2,
        volume: 0.3,
        sustain: true,
        labelMode: 'keys',
        velocity: 0.4,
        transpose: 5,
        noteNaming: 'solfege',
        reverb: 0.9,
        release: 'long',
        showTrails: false,
        pianoSize: 61,
        accent: 'purple',
        glow: 0.2,
      }
      store.set(custom)
      const listener = vi.fn()
      store.subscribe(listener)
      const before = store.get()

      store.resetKeys(SOUND_KEYS)

      expect(store.get()).toEqual({
        ...DEFAULT_SETTINGS,
        bindings: { KeyZ: 0 },
        customLabels: { KeyZ: 'W' },
        baseOctave: 2,
        volume: 0.3,
        sustain: true,
        labelMode: 'keys',
        pianoSize: 61,
        accent: 'purple',
        glow: 0.2,
      })
      expect(store.get().bindings).toBe(before.bindings)
      expect(listener).toHaveBeenCalledTimes(1)
      expect(savedSettings(storage)).toEqual(store.get())
    })

    it('can put the keys back without touching anything else', () => {
      const store = createSettingsStore(createFakeStorage())
      store.set({ bindings: { KeyZ: 0 }, customLabels: { KeyZ: 'W' }, volume: 0.3, transpose: 4 })

      store.resetKeys(['bindings', 'customLabels'])

      expect(store.get()).toEqual({ ...DEFAULT_SETTINGS, volume: 0.3, transpose: 4 })
    })

    it('can put the look back without touching the piano or the sound', () => {
      const store = createSettingsStore(createFakeStorage())
      store.set({ accent: 'custom', customColour: '#12ab9f', glow: 1, background: 'night' })
      store.set({ barStyle: 'neon', sparks: 'lots', keyStyle: 'glass', pianoSize: 49, volume: 0.3 })

      store.resetKeys(['accent', 'customColour', 'glow', 'background', 'barStyle', 'sparks'])

      expect(store.get()).toEqual({
        ...DEFAULT_SETTINGS,
        keyStyle: 'glass',
        pianoSize: 49,
        volume: 0.3,
      })
    })

    it('does nothing when there is nothing to put back', () => {
      const storage = createFakeStorage()
      const store = createSettingsStore(storage)
      store.set({ volume: 0.3 })
      const listener = vi.fn()
      store.subscribe(listener)
      const before = store.get()
      storage.setItem.mockClear()

      store.resetKeys(SOUND_KEYS)
      store.resetKeys([])
      store.resetKeys(['nope', 'constructor', '__proto__'] as unknown as (keyof Settings)[])

      expect(store.get()).toBe(before)
      expect(listener).not.toHaveBeenCalled()
      expect(storage.setItem).not.toHaveBeenCalled()
    })
  })

  describe('subscribe', () => {
    it('stops telling a listener after it unsubscribes', () => {
      const store = createSettingsStore()
      const stays = vi.fn()
      const leaves = vi.fn()
      store.subscribe(stays)
      const unsubscribe = store.subscribe(leaves)

      store.set({ volume: 0.1 })
      unsubscribe()
      unsubscribe()
      store.set({ volume: 0.2 })

      expect(stays).toHaveBeenCalledTimes(2)
      expect(leaves).toHaveBeenCalledTimes(1)
    })

    it('lets a listener unsubscribe or change a setting while it is being told', () => {
      const store = createSettingsStore()
      const order: string[] = []
      const unsubscribeFirst = store.subscribe(() => {
        order.push('first')
        unsubscribeFirst()
      })
      store.subscribe(() => {
        order.push(`second:${store.get().volume}`)
        store.set({ sustain: true })
      })

      store.set({ volume: 0.1 })

      expect(order).toEqual(['first', 'second:0.1', 'second:0.1'])
      expect(store.get()).toEqual({ ...DEFAULT_SETTINGS, volume: 0.1, sustain: true })
    })

    it('still tells the other listeners when one of them fails', () => {
      const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      const store = createSettingsStore()
      const healthy = vi.fn()
      store.subscribe(() => {
        throw new Error('broken listener')
      })
      store.subscribe(healthy)

      expect(() => store.set({ volume: 0.1 })).not.toThrow()

      expect(healthy).toHaveBeenCalledTimes(1)
      expect(store.get().volume).toBe(0.1)
      expect(logged).toHaveBeenCalledTimes(1)
      logged.mockRestore()
    })

    it('keeps separate stores apart', () => {
      const one = createSettingsStore()
      const two = createSettingsStore()
      const listener = vi.fn()
      two.subscribe(listener)

      one.set({ volume: 0.1 })

      expect(two.get()).toEqual(DEFAULT_SETTINGS)
      expect(listener).not.toHaveBeenCalled()
    })
  })

  describe('with a storage that fails', () => {
    const refuse = (): never => {
      throw new Error('storage is not available')
    }

    function expectStoreStillWorks(storage: StorageLike): void {
      const store = createSettingsStore(storage)
      const listener = vi.fn()
      store.subscribe(listener)

      store.set({ volume: 0.2 })
      expect(store.get().volume).toBe(0.2)
      store.resetKeys(['volume'])
      expect(store.get().volume).toBe(0.8)
      store.set({ sustain: true })
      store.reset()

      expect(store.get()).toEqual(DEFAULT_SETTINGS)
      expect(listener).toHaveBeenCalledTimes(4)
    }

    it('uses the defaults when reading fails', () => {
      const storage = { ...createFakeStorage(JSON.stringify({ volume: 0.2 })), getItem: refuse }
      expect(createSettingsStore(storage).get()).toEqual(DEFAULT_SETTINGS)
      expectStoreStillWorks(storage)
    })

    it('keeps working in memory when saving fails', () => {
      const storage = { ...createFakeStorage(JSON.stringify({ transpose: 2 })), setItem: refuse }
      expect(createSettingsStore(storage).get().transpose).toBe(2)
      expectStoreStillWorks({ ...createFakeStorage(), setItem: refuse })
    })

    it('keeps working when removing fails', () => {
      expectStoreStillWorks({ ...createFakeStorage(), removeItem: refuse })
    })

    it('keeps working when everything fails', () => {
      expectStoreStillWorks({ getItem: refuse, setItem: refuse, removeItem: refuse })
    })

    it('uses the defaults when the storage answers with something that is not text', () => {
      const answers: unknown[] = [undefined, 12, {}, { volume: 0.2 }]
      for (const answer of answers) {
        const storage = { ...createFakeStorage(), getItem: () => answer as string | null }
        expect(createSettingsStore(storage).get()).toEqual(DEFAULT_SETTINGS)
      }
    })
  })
})

describe('settingsStore (the app-wide store)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('can be imported and used where there is no browser', () => {
    expect(typeof window).toBe('undefined')
    expect(settingsStore.get()).toEqual(DEFAULT_SETTINGS)

    settingsStore.set({ volume: 0.3 })
    expect(settingsStore.get().volume).toBe(0.3)
    settingsStore.reset()
    expect(settingsStore.get()).toEqual(DEFAULT_SETTINGS)
  })

  it('reads from and saves to window.localStorage when the browser has it', async () => {
    const localStorage = createFakeStorage(JSON.stringify({ volume: 0.25 }))
    vi.stubGlobal('window', { localStorage })
    vi.resetModules()
    const fresh = await import('./settings')

    expect(fresh.settingsStore.get().volume).toBe(0.25)
    fresh.settingsStore.set({ sustain: true })
    expect(savedSettings(localStorage)).toEqual({
      ...DEFAULT_SETTINGS,
      volume: 0.25,
      sustain: true,
    })
  })

  it('works in memory when touching window.localStorage throws', async () => {
    const privateWindow = {
      get localStorage(): never {
        throw new Error('SecurityError: access is denied')
      },
    }
    vi.stubGlobal('window', privateWindow)
    vi.resetModules()
    const fresh = await import('./settings')

    expect(fresh.settingsStore.get()).toEqual(DEFAULT_SETTINGS)
    fresh.settingsStore.set({ volume: 0.4 })
    expect(fresh.settingsStore.get().volume).toBe(0.4)
  })

  it('works in memory when the browser has no localStorage', async () => {
    for (const localStorage of [undefined, null]) {
      vi.stubGlobal('window', { localStorage })
      vi.resetModules()
      const fresh = await import('./settings')

      expect(fresh.settingsStore.get()).toEqual(DEFAULT_SETTINGS)
      fresh.settingsStore.set({ volume: 0.4 })
      expect(fresh.settingsStore.get().volume).toBe(0.4)
    }
  })

  describe('with the app open in another tab as well', () => {
    type FakeStorage = ReturnType<typeof createFakeStorage>

    /**
     * This tab: a fresh copy of the settings module over a window that has a
     * storage (or none) and can be sent events, as a browser window can.
     */
    async function openTab(localStorage: FakeStorage | null) {
      const tabWindow = Object.assign(new EventTarget(), { localStorage })
      vi.stubGlobal('window', tabWindow)
      vi.resetModules()
      const { settingsStore: store } = await import('./settings')
      const listener = vi.fn()
      store.subscribe(listener)

      return {
        store,
        listener,
        /**
         * The browser tells this tab that another tab changed what is saved
         * under `key` (null: everything was cleared).
         */
        hearAbout(key: string | null): void {
          tabWindow.dispatchEvent(Object.assign(new Event('storage'), { key }))
        },
      }
    }

    /** The other tab saves: the storage changes without this tab's store having a hand in it. */
    function saveFromOtherTab(localStorage: FakeStorage, text: string): void {
      localStorage.items.set(STORAGE_KEY, text)
    }

    const OWN_KEYS = { bindings: { KeyZ: 0, KeyX: 2 }, customLabels: { KeyZ: 'Z', KeyX: 'X' } }

    it('takes over what the other tab saved, tells its listeners once, saves nothing', async () => {
      const localStorage = createFakeStorage(JSON.stringify({ volume: 0.25 }))
      const tab = await openTab(localStorage)

      saveFromOtherTab(localStorage, JSON.stringify({ volume: 0.25, ...OWN_KEYS }))
      tab.hearAbout(STORAGE_KEY)

      expect(tab.store.get()).toEqual({ ...DEFAULT_SETTINGS, volume: 0.25, ...OWN_KEYS })
      expectValidSettings(tab.store.get())
      expect(tab.listener).toHaveBeenCalledTimes(1)
      expect(localStorage.setItem).not.toHaveBeenCalled()
    })

    it('keeps what the other tab saved when it saves a change of its own afterwards', async () => {
      const localStorage = createFakeStorage()
      const tab = await openTab(localStorage)

      saveFromOtherTab(localStorage, JSON.stringify(OWN_KEYS))
      tab.hearAbout(STORAGE_KEY)
      tab.store.set({ sustain: true })

      expect(savedSettings(localStorage)).toEqual({
        ...DEFAULT_SETTINGS,
        ...OWN_KEYS,
        sustain: true,
      })
    })

    it('tells no one when the other tab saved what this tab already has', async () => {
      const localStorage = createFakeStorage()
      const tab = await openTab(localStorage)
      tab.store.set({ volume: 0.5, ...OWN_KEYS })
      const before = tab.store.get()

      tab.hearAbout(STORAGE_KEY)

      expect(tab.store.get()).toBe(before)
      expect(tab.listener).toHaveBeenCalledTimes(1)
    })

    it('keeps the same keys objects when the other tab changed something else', async () => {
      const localStorage = createFakeStorage(JSON.stringify(OWN_KEYS))
      const tab = await openTab(localStorage)
      const before = tab.store.get()

      saveFromOtherTab(localStorage, JSON.stringify({ ...OWN_KEYS, volume: 0.1 }))
      tab.hearAbout(STORAGE_KEY)

      expect(tab.store.get().volume).toBe(0.1)
      expect(tab.store.get().bindings).toBe(before.bindings)
      expect(tab.store.get().customLabels).toBe(before.customLabels)
    })

    it('cleans what the other tab saved like anything else read from storage', async () => {
      const localStorage = createFakeStorage()
      const tab = await openTab(localStorage)

      saveFromOtherTab(localStorage, JSON.stringify({ volume: 7, labelMode: 'loud', transpose: 2 }))
      tab.hearAbout(STORAGE_KEY)
      expect(tab.store.get()).toEqual({ ...DEFAULT_SETTINGS, volume: 1, transpose: 2 })

      saveFromOtherTab(localStorage, '{"volume": 0.3')
      tab.hearAbout(STORAGE_KEY)
      expect(tab.store.get()).toEqual(DEFAULT_SETTINGS)
    })

    it('goes back to the defaults when everything the site saved is cleared', async () => {
      const localStorage = createFakeStorage(JSON.stringify({ volume: 0.25, ...OWN_KEYS }))
      const tab = await openTab(localStorage)

      localStorage.items.clear()
      tab.hearAbout(null)

      expect(tab.store.get()).toEqual(DEFAULT_SETTINGS)
      expect(tab.listener).toHaveBeenCalledTimes(1)
    })

    it('does not read the storage again when the site saved something else', async () => {
      const localStorage = createFakeStorage(JSON.stringify({ volume: 0.25 }))
      const tab = await openTab(localStorage)
      const before = tab.store.get()
      localStorage.getItem.mockClear()

      tab.hearAbout('another.thing.the.site.saves')

      expect(localStorage.getItem).not.toHaveBeenCalled()
      expect(tab.store.get()).toBe(before)
      expect(tab.listener).not.toHaveBeenCalled()
    })

    it('keeps its settings when it has no storage to read them from', async () => {
      const tab = await openTab(null)
      tab.store.set({ volume: 0.4 })

      tab.hearAbout(STORAGE_KEY)
      tab.hearAbout(null)

      expect(tab.store.get()).toEqual({ ...DEFAULT_SETTINGS, volume: 0.4 })
      expect(tab.listener).toHaveBeenCalledTimes(1)
    })
  })
})

describe('useSettings', () => {
  it('gives the current settings, also when rendered without a browser', () => {
    const seen: Settings[] = []
    function Probe(): null {
      seen.push(useSettings())
      return null
    }

    renderToString(createElement(Probe))

    expect(seen).toEqual([settingsStore.get()])
    expect(seen[0]).toBe(settingsStore.get())
  })
})
