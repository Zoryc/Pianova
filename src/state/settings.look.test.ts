/**
 * The saved settings, attacked: every field handed every kind of wrong value,
 * a storage that fails at each possible moment, what the previous version of
 * the app saved, and what a long drag through the colour picker writes.
 */
import { describe, expect, it } from 'vitest'
import { isHexColour } from '../core/colour'
import { MAX_BASE_OCTAVE, MIN_BASE_OCTAVE, isPianoSizeSetting } from '../core/layout'
import { DEFAULT_BINDINGS } from '../input/keymap'
import {
  DEFAULT_SETTINGS,
  MAX_TRANSPOSE,
  MIN_VELOCITY,
  STORAGE_KEY,
  createSettingsStore,
  sanitizeSettings,
} from './settings'
import type { Settings, StorageLike } from './settings'
import { LOOK_THEMES, matchingTheme } from './themes'

const FIELDS = Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]

/** Values of every kind that saved text can turn into, and a few it cannot. */
const WRONG_VALUES: readonly unknown[] = [
  undefined,
  null,
  true,
  false,
  0,
  -0,
  1,
  -1,
  0.5,
  37,
  88,
  1e300,
  -1e300,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.NEGATIVE_INFINITY,
  '',
  ' ',
  'auto',
  'red',
  'custom',
  'Red',
  '88',
  '#fff',
  '#ff2a2a ',
  '#ff2a2a\n',
  'ff2a2a',
  '#gggggg',
  '__proto__',
  'constructor',
  [],
  [1, 2, 3],
  {},
  { KeyA: 0 },
  { length: 3 },
  { toString: 'not a function' },
]

/** True when `settings` is something every part of the app can work with. */
function isUsable(settings: Settings): boolean {
  const inRange = (value: number, min: number, max: number): boolean =>
    Number.isFinite(value) && value >= min && value <= max
  return (
    FIELDS.every((field) => Object.hasOwn(settings, field)) &&
    Object.keys(settings).length === FIELDS.length &&
    typeof settings.bindings === 'object' &&
    typeof settings.customLabels === 'object' &&
    Number.isInteger(settings.baseOctave) &&
    inRange(settings.baseOctave, MIN_BASE_OCTAVE, MAX_BASE_OCTAVE) &&
    inRange(settings.volume, 0, 1) &&
    inRange(settings.velocity, MIN_VELOCITY, 1) &&
    Number.isInteger(settings.transpose) &&
    inRange(settings.transpose, -MAX_TRANSPOSE, MAX_TRANSPOSE) &&
    inRange(settings.reverb, 0, 1) &&
    inRange(settings.glow, 0, 1) &&
    isHexColour(settings.customColour) &&
    isPianoSizeSetting(settings.pianoSize) &&
    ['keys', 'notes', 'both', 'none'].includes(settings.labelMode) &&
    ['letters', 'solfege'].includes(settings.noteNaming) &&
    ['short', 'normal', 'long'].includes(settings.release) &&
    ['classic', 'midnight', 'glass'].includes(settings.keyStyle) &&
    ['glow', 'press', 'edge', 'pop'].includes(settings.keyEffect) &&
    ['auto', 'qwerty', 'azerty', 'qwertz'].includes(settings.keyboardType) &&
    ['red', 'amber', 'blue', 'green', 'purple', 'white', 'custom', 'rainbow'].includes(
      settings.accent,
    ) &&
    ['black', 'night', 'stars', 'aurora'].includes(settings.background) &&
    ['solid', 'neon'].includes(settings.barStyle) &&
    ['off', 'some', 'lots'].includes(settings.sparks) &&
    [settings.sustain, settings.showTrails, settings.showKeyHints].every(
      (flag) => typeof flag === 'boolean',
    ) &&
    [settings.showNoteNames, settings.autoHideMenu].every((flag) => typeof flag === 'boolean')
  )
}

/** A storage that can be told to fail when it is read, when it is written, or both. */
class FlakyStorage implements StorageLike {
  readonly items = new Map<string, string>()
  failReads = false
  failWrites = false
  reads = 0
  writes = 0

  constructor(saved?: unknown) {
    if (saved !== undefined) this.items.set(STORAGE_KEY, JSON.stringify(saved))
  }

  getItem(key: string): string | null {
    this.reads += 1
    if (this.failReads) throw new DOMException('Access is denied.', 'SecurityError')
    return this.items.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    if (this.failWrites) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
    this.writes += 1
    this.items.set(key, value)
  }

  removeItem(key: string): void {
    this.items.delete(key)
  }

  saved(): unknown {
    const text = this.items.get(STORAGE_KEY)
    return text === undefined ? undefined : JSON.parse(text)
  }
}

/** What the version of the app before the new screen saved: twelve fields, none of the new ones. */
const SAVED_BY_THE_PREVIOUS_VERSION = {
  bindings: { KeyQ: 0, KeyW: 2, Digit1: 36 },
  customLabels: { KeyQ: 'q' },
  baseOctave: 2,
  volume: 0.35,
  sustain: true,
  labelMode: 'notes',
  velocity: 0.5,
  transpose: -3,
  noteNaming: 'solfege',
  reverb: 0.4,
  release: 'long',
  showTrails: false,
}

describe('any one field holding any wrong value', () => {
  it.each(FIELDS)('%s: the settings stay usable, and the other fields stay as they were', (field) => {
    const good: Settings = { ...DEFAULT_SETTINGS, volume: 0.42, accent: 'green', glow: 0.9 }

    for (const wrong of WRONG_VALUES) {
      const cleaned = sanitizeSettings({ ...good, [field]: wrong })

      expect(isUsable(cleaned), `${field} = ${String(JSON.stringify(wrong))}`).toBe(true)
      for (const other of FIELDS) {
        if (other !== field) expect(cleaned[other]).toEqual(good[other])
      }
      // Cleaning what is already clean changes nothing, also after a trip through storage.
      expect(sanitizeSettings(cleaned)).toEqual(cleaned)
      expect(sanitizeSettings(JSON.parse(JSON.stringify(cleaned)))).toEqual(cleaned)
    }
  })

  it('every field wrong at once gives the default settings, whatever the wrong value', () => {
    for (const wrong of ['nonsense', Number.NaN, null, [], true, () => 1, Symbol('x')]) {
      const everythingWrong = Object.fromEntries(FIELDS.map((field) => [field, wrong]))
      const cleaned = sanitizeSettings(everythingWrong)

      expect(isUsable(cleaned)).toBe(true)
      // `true` is a real value for the on/off settings; everything else is the default.
      const expected =
        wrong === true
          ? { ...DEFAULT_SETTINGS, sustain: true }
          : Array.isArray(wrong)
            ? { ...DEFAULT_SETTINGS, customLabels: {} }
            : DEFAULT_SETTINGS
      expect(cleaned).toEqual(expected)
    }
  })

  it('a patch with a wrong value never leaves the store unusable', () => {
    const storage = new FlakyStorage()
    const store = createSettingsStore(storage)

    for (const field of FIELDS) {
      for (const wrong of WRONG_VALUES) {
        store.set({ [field]: wrong } as Partial<Settings>)
        expect(isUsable(store.get()), `${field} = ${String(JSON.stringify(wrong))}`).toBe(true)
        expect(isUsable(sanitizeSettings(storage.saved()))).toBe(true)
      }
    }
  })

  it('takes a colour only when it is exactly "#" and six hex digits', () => {
    const taken = (value: unknown): string => sanitizeSettings({ customColour: value }).customColour

    expect(taken('#00c2a8')).toBe('#00c2a8')
    expect(taken('#00C2A8')).toBe('#00C2A8')
    for (const refused of [
      '#00c2a8\n',
      '\n#00c2a8',
      ' #00c2a8',
      '#00c2a8;',
      '#00c2a8ff',
      '#0c2',
      '00c2a8',
      'rgb(0, 194, 168)',
      'teal',
      '#00c2a8"><script>',
      ['#00c2a8'],
      { toString: () => '#00c2a8' },
    ]) {
      expect(taken(refused), String(JSON.stringify(refused))).toBe(DEFAULT_SETTINGS.customColour)
    }
  })
})

describe('what the previous version of the app saved', () => {
  it('is all kept, with the new options at their defaults: the look is Ember', () => {
    const store = createSettingsStore(new FlakyStorage(SAVED_BY_THE_PREVIOUS_VERSION))

    expect(store.get()).toEqual({ ...DEFAULT_SETTINGS, ...SAVED_BY_THE_PREVIOUS_VERSION })
    expect(matchingTheme(store.get())).toBe('ember')
  })

  it('is not rewritten just by being read', () => {
    const storage = new FlakyStorage(SAVED_BY_THE_PREVIOUS_VERSION)
    createSettingsStore(storage).get()

    expect(storage.writes).toBe(0)
    expect(storage.saved()).toEqual(SAVED_BY_THE_PREVIOUS_VERSION)
  })

  it('keeps the old choices when the first new option is changed', () => {
    const storage = new FlakyStorage(SAVED_BY_THE_PREVIOUS_VERSION)
    const store = createSettingsStore(storage)

    store.set({ accent: 'blue' })

    expect(storage.saved()).toEqual({
      ...DEFAULT_SETTINGS,
      ...SAVED_BY_THE_PREVIOUS_VERSION,
      accent: 'blue',
    })
  })

  it('keeps the old keys when a theme is applied, and loses them only on "Reset all settings"', () => {
    const storage = new FlakyStorage(SAVED_BY_THE_PREVIOUS_VERSION)
    const store = createSettingsStore(storage)

    for (const theme of LOOK_THEMES) store.set(theme.values)
    expect(store.get().bindings).toEqual(SAVED_BY_THE_PREVIOUS_VERSION.bindings)
    expect(store.get().showTrails).toBe(false)

    store.reset()
    expect(store.get().bindings).toEqual(DEFAULT_BINDINGS)
    expect(storage.saved()).toEqual(DEFAULT_SETTINGS)
  })
})

describe('a storage that fails', () => {
  it('when it is read at the start: the app starts with the defaults', () => {
    const storage = new FlakyStorage({ volume: 0.2 })
    storage.failReads = true

    const store = createSettingsStore(storage)

    expect(store.get()).toEqual(DEFAULT_SETTINGS)
  })

  it('when it is written: every change still happens, and listeners still hear of it', () => {
    const storage = new FlakyStorage()
    storage.failWrites = true
    const store = createSettingsStore(storage)
    let heard = 0
    store.subscribe(() => {
      heard += 1
    })

    expect(() => {
      store.set({ accent: 'custom', customColour: '#123456' })
      store.set({ glow: 0 })
      store.resetKeys(['glow'])
      store.reset()
    }).not.toThrow()

    expect(heard).toBe(4)
    expect(store.get()).toEqual(DEFAULT_SETTINGS)
    expect(storage.saved()).toBeUndefined()
  })

  it('at both ends: nothing is ever thrown at the app', () => {
    const storage = new FlakyStorage()
    storage.failReads = true
    storage.failWrites = true

    expect(() => {
      const store = createSettingsStore(storage)
      store.set({ volume: 0.1 })
      store.reset()
    }).not.toThrow()
  })

  it('does not write over what is saved with defaults it only fell back on', () => {
    const storage = new FlakyStorage({ ...DEFAULT_SETTINGS, bindings: { KeyQ: 0 }, accent: 'blue' })
    storage.failReads = true
    const store = createSettingsStore(storage)
    storage.failReads = false

    // Opening the app while the storage could not be read saves nothing by itself.
    store.get()
    expect(storage.writes).toBe(0)
    expect(storage.saved()).toMatchObject({ bindings: { KeyQ: 0 }, accent: 'blue' })
  })
})

describe('a drag through the colour picker', () => {
  /** A hundred and twenty colours in a row: two seconds of dragging. */
  function drag(store: ReturnType<typeof createSettingsStore>, steps: number): string[] {
    const colours: string[] = []
    for (let step = 0; step < steps; step += 1) {
      const colour = `#${(step * 2).toString(16).padStart(2, '0')}40c0`
      colours.push(colour)
      store.set({ accent: 'custom', customColour: colour })
    }
    return colours
  }

  it('writes each colour once, and the last one is what is saved', () => {
    const storage = new FlakyStorage()
    const store = createSettingsStore(storage)

    const colours = drag(store, 120)

    expect(storage.writes).toBe(120)
    expect(storage.saved()).toMatchObject({ accent: 'custom', customColour: colours.at(-1) })
  })

  it('writes nothing more while the mouse stays on one colour', () => {
    const storage = new FlakyStorage()
    const store = createSettingsStore(storage)
    drag(store, 1)
    const before = store.get()

    for (let repeat = 0; repeat < 50; repeat += 1) {
      store.set({ accent: 'custom', customColour: '#0040c0' })
    }

    expect(storage.writes).toBe(1)
    expect(store.get()).toBe(before)
  })

  it('keeps what is saved small: the same size at the end as at the start', () => {
    const storage = new FlakyStorage()
    const store = createSettingsStore(storage)
    store.set({ accent: 'custom', customColour: '#000000' })
    const sizeAtStart = storage.getItem(STORAGE_KEY)?.length

    drag(store, 120)

    expect(storage.getItem(STORAGE_KEY)?.length).toBe(sizeAtStart)
  })

  it('never touches the keys or the labels: they are the very same objects afterwards', () => {
    const store = createSettingsStore(new FlakyStorage(SAVED_BY_THE_PREVIOUS_VERSION))
    const { bindings, customLabels } = store.get()

    drag(store, 30)

    expect(store.get().bindings).toBe(bindings)
    expect(store.get().customLabels).toBe(customLabels)
  })
})
