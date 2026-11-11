/**
 * What survives between visits: saved data that is huge or hostile, a storage
 * that is full for a while, how much is written, and whether the saved text
 * can grow without limit as keys are customized again and again.
 */
import { describe, expect, it } from 'vitest'
import { isHexColour } from '../core/colour'
import { SLOT_COUNT, isPianoSizeSetting } from '../core/layout'
import { isBindableCode } from '../input/keymap'
import { EDITOR_OPEN, pressKey, selectSlot } from '../ui/keyEditorModel'
import {
  DEFAULT_SETTINGS,
  STORAGE_KEY,
  createSettingsStore,
  sanitizeSettings,
} from './settings'
import type { Settings, StorageLike } from './settings'

/** Every key the app lets the user bind. */
const BINDABLE_CODES = [
  ...[...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].map((letter) => `Key${letter}`),
  ...[...'0123456789'].map((digit) => `Digit${digit}`),
  ...[...'0123456789'].map((digit) => `Numpad${digit}`),
  ...['Minus', 'Equal', 'BracketLeft', 'BracketRight', 'Backslash', 'Semicolon', 'Quote'],
  ...['Backquote', 'Comma', 'Period', 'Slash', 'IntlBackslash', 'IntlRo', 'IntlYen'],
  ...['NumpadDecimal', 'NumpadAdd', 'NumpadSubtract', 'NumpadMultiply', 'NumpadDivide'],
].filter(isBindableCode)

/** A storage that counts its writes and can be told to refuse them, like a full disk. */
class FakeStorage implements StorageLike {
  readonly items = new Map<string, string>()
  full = false
  writes = 0
  refused = 0

  constructor(saved?: string) {
    if (saved !== undefined) this.items.set(STORAGE_KEY, saved)
  }

  getItem(key: string): string | null {
    return this.items.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    if (this.full) {
      this.refused += 1
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
    }
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

function randomSource(seed: number): () => number {
  let state = seed
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296
    return state / 4294967296
  }
}

/** Throws when `settings` breaks any promise of the Settings type (spec section 5.3). */
function expectValid(settings: Settings): void {
  expect(Object.keys(settings).sort()).toEqual(Object.keys(DEFAULT_SETTINGS).sort())

  const slots = Object.values(settings.bindings)
  expect(new Set(slots).size).toBe(slots.length)
  for (const [code, slot] of Object.entries(settings.bindings)) {
    expect(isBindableCode(code)).toBe(true)
    expect(Number.isInteger(slot) && slot >= 0 && slot < SLOT_COUNT).toBe(true)
  }
  for (const [code, label] of Object.entries(settings.customLabels)) {
    expect(isBindableCode(code)).toBe(true)
    expect(label.length).toBeGreaterThanOrEqual(1)
    expect(label.length).toBeLessThanOrEqual(6)
  }
  expect(settings.volume).toBeGreaterThanOrEqual(0)
  expect(settings.volume).toBeLessThanOrEqual(1)
  expect(settings.reverb).toBeGreaterThanOrEqual(0)
  expect(settings.reverb).toBeLessThanOrEqual(1)
  expect(settings.velocity).toBeGreaterThanOrEqual(0.1)
  expect(settings.velocity).toBeLessThanOrEqual(1)
  expect(Number.isInteger(settings.transpose) && Math.abs(settings.transpose) <= 12).toBe(true)
  expect(Number.isInteger(settings.baseOctave)).toBe(true)
  expect(settings.baseOctave).toBeGreaterThanOrEqual(1)
  expect(settings.baseOctave).toBeLessThanOrEqual(5)
  expect(settings.glow).toBeGreaterThanOrEqual(0)
  expect(settings.glow).toBeLessThanOrEqual(1)
  expect(isHexColour(settings.customColour)).toBe(true)
  expect(isPianoSizeSetting(settings.pianoSize)).toBe(true)
}

describe('saved data that is huge', () => {
  // Building and reading several megabytes of text takes a moment. How long is
  // not what is checked here, so a slow or busy machine gets all the time it needs.
  it('is cleaned to a bounded size', { timeout: 60_000 }, () => {
    const bindings: Record<string, unknown> = {}
    const customLabels: Record<string, unknown> = {}
    for (let index = 0; index < 200_000; index++) {
      bindings[`Junk${index}`] = index % 50
      customLabels[`Junk${index}`] = 'x'.repeat(index % 9)
    }
    // Real keys hidden at the very end of the junk.
    bindings.KeyQ = 3
    customLabels.KeyQ = 'Q'
    const saved = JSON.stringify({ bindings, customLabels, volume: 0.4, junk: 'y'.repeat(1_000_000) })

    const store = createSettingsStore(new FakeStorage(saved))

    const settings = store.get()
    expectValid(settings)
    expect(settings.bindings).toEqual({ KeyQ: 3 })
    expect(settings.customLabels).toEqual({ KeyQ: 'Q' })
    expect(settings.volume).toBe(0.4)
  })

  it('does not come back: the next save writes only the cleaned settings', () => {
    const junk = Object.fromEntries(
      Array.from({ length: 50_000 }, (_, index) => [`Junk${index}`, index]),
    )
    const storage = new FakeStorage(JSON.stringify({ bindings: junk, customLabels: junk, ...junk }))
    const store = createSettingsStore(storage)

    store.set({ sustain: true })

    const text = storage.getItem(STORAGE_KEY) ?? ''
    expect(text.length).toBeLessThan(1024)
    expect(storage.saved()).toEqual(store.get())
  })

  it('survives text nested far deeper than any real settings', () => {
    for (const saved of [
      '['.repeat(200_000),
      `${'['.repeat(200_000)}${']'.repeat(200_000)}`,
      `${'{"bindings":'.repeat(5_000)}{}${'}'.repeat(5_000)}`,
      `{"bindings":${'{"KeyA":'.repeat(5_000)}1${'}'.repeat(5_000)}}`,
    ]) {
      const store = createSettingsStore(new FakeStorage(saved))
      expectValid(store.get())
      store.set({ volume: 0.5 })
      expect(store.get().volume).toBe(0.5)
    }
  })

  it('reads numbers that JSON turns into infinity as "not a number": the default', () => {
    const saved = '{"volume":1e999,"reverb":-1e999,"velocity":1e999,"transpose":1e999,"baseOctave":-1e999}'
    const settings = createSettingsStore(new FakeStorage(saved)).get()
    expectValid(settings)
    expect(settings.volume).toBe(DEFAULT_SETTINGS.volume)
    expect(settings.reverb).toBe(DEFAULT_SETTINGS.reverb)
    expect(settings.velocity).toBe(DEFAULT_SETTINGS.velocity)
    expect(settings.transpose).toBe(DEFAULT_SETTINGS.transpose)
    expect(settings.baseOctave).toBe(DEFAULT_SETTINGS.baseOctave)
  })
})

describe('a storage that is full for a while', () => {
  it('loses nothing once it has room again: the next save holds every change made meanwhile', () => {
    const storage = new FakeStorage()
    const store = createSettingsStore(storage)
    store.set({ volume: 0.5 })
    expect(storage.writes).toBe(1)

    storage.full = true
    expect(() => store.set({ bindings: { KeyZ: 0 }, customLabels: { KeyZ: 'Z' } })).not.toThrow()
    expect(() => store.set({ transpose: 3 })).not.toThrow()
    expect(() => store.resetKeys(['volume'])).not.toThrow()
    expect(storage.refused).toBe(3)
    // Still the current settings in this visit…
    expect(store.get().bindings).toEqual({ KeyZ: 0 })
    expect(store.get().transpose).toBe(3)
    // …and what was saved before the storage filled up is untouched.
    expect(storage.saved()).toMatchObject({ volume: 0.5, transpose: 0 })

    storage.full = false
    store.set({ sustain: true })
    expect(storage.saved()).toEqual(store.get())
    expect(createSettingsStore(storage).get()).toEqual(store.get())
  })

  it('still tells listeners about every change', () => {
    const storage = new FakeStorage()
    storage.full = true
    const store = createSettingsStore(storage)
    let told = 0
    store.subscribe(() => (told += 1))

    store.set({ volume: 0.1 })
    store.set({ volume: 0.2 })
    store.reset()

    expect(told).toBe(3)
    expect(storage.writes).toBe(0)
  })
})

describe('how much is written', () => {
  it('writes once per real change and never for a change that changes nothing', () => {
    const storage = new FakeStorage()
    const store = createSettingsStore(storage)

    // A slider dragged from 80% down to 0%, with the pointer resting now and then.
    let changes = 0
    for (let percent = 80; percent >= 0; percent--) {
      for (let rest = 0; rest < 3; rest++) {
        const before = store.get()
        store.set({ volume: percent / 100 })
        if (store.get() !== before) changes += 1
      }
    }

    expect(changes).toBe(80)
    expect(storage.writes).toBe(changes)
  })

  it('writes nothing just for being opened, read or subscribed to', () => {
    const storage = new FakeStorage(JSON.stringify({ volume: 2, bindings: 'garbage', extra: 1 }))
    const store = createSettingsStore(storage)
    store.get()
    store.subscribe(() => {})()
    store.set({})
    store.set({ volume: 1 })
    store.resetKeys([])
    expect(storage.writes).toBe(0)
  })
})

describe('customizing keys again and again', () => {
  it('never lets the saved labels or the saved text grow without limit', () => {
    const random = randomSource(4711)
    const storage = new FakeStorage()
    const store = createSettingsStore(storage)
    const pick = <Item>(items: readonly Item[]): Item => {
      const item = items[Math.floor(random() * items.length)]
      if (item === undefined) throw new Error('nothing to pick from')
      return item
    }
    // What each key "types", changing as if the player kept switching keyboard layouts.
    const characters = [...'abcdefghijklmnopqrstuvwxyz0123456789éàçñøß;,./[]^$ù*<>']

    let longestText = 0
    for (let round = 0; round < 3000; round++) {
      const slot = Math.floor(random() * SLOT_COUNT)
      const action = random()
      const press =
        action < 0.85
          ? { code: pick(BINDABLE_CODES), key: pick(characters), repeat: false }
          : { code: 'Backspace', key: 'Backspace', repeat: false }
      const result = pressKey(selectSlot(slot), press, store.get(), null)
      expect(result.consumed).toBe(true)
      expect(result.state).toMatchObject({ ...EDITOR_OPEN, message: expect.any(String) as string })
      if (result.changes) store.set(result.changes)

      longestText = Math.max(longestText, (storage.getItem(STORAGE_KEY) ?? '').length)
    }

    const settings = store.get()
    expectValid(settings)
    expect(Object.keys(settings.customLabels).length).toBeLessThanOrEqual(BINDABLE_CODES.length)
    expect(Object.keys(settings.bindings).length).toBeLessThanOrEqual(SLOT_COUNT)
    // 65 bindable keys with a label each, 37 bound keys, and the other settings.
    expect(longestText).toBeLessThan(4096)
    // What is saved is exactly what is in use: a later visit starts from the same settings.
    expect(createSettingsStore(storage).get()).toEqual(settings)
  })

  it('forgets every saved label when the default keys are put back', () => {
    const store = createSettingsStore(new FakeStorage())
    for (const [index, code] of BINDABLE_CODES.entries()) {
      const result = pressKey(
        selectSlot(index % SLOT_COUNT),
        { code, key: 'x', repeat: false },
        store.get(),
        null,
      )
      if (result.changes) store.set(result.changes)
    }
    expect(Object.keys(store.get().customLabels).length).toBeGreaterThan(SLOT_COUNT)

    store.resetKeys(['bindings', 'customLabels'])
    expect(store.get().customLabels).toEqual({})
    expect(store.get().bindings).toEqual(DEFAULT_SETTINGS.bindings)
  })
})

describe('objects handed out by the store', () => {
  it('keep what they held after every kind of change, and the defaults stay what they were', () => {
    const defaultsBefore = JSON.stringify(DEFAULT_SETTINGS)
    const store = createSettingsStore(new FakeStorage())
    /** Every settings object the store handed out, with what it held at that moment. */
    const seen: { settings: Settings; held: string }[] = []
    const remember = (): void => {
      const settings = store.get()
      seen.push({ settings, held: JSON.stringify(settings) })
    }
    remember()
    store.subscribe(remember)

    store.set({ bindings: { KeyZ: 0 }, customLabels: { KeyZ: 'Z' } })
    store.set({ volume: 0.3, labelMode: 'none' })
    store.resetKeys(['bindings'])
    store.reset()
    store.set({ customLabels: { KeyQ: 'A' } })

    expect(seen.length).toBe(6)
    for (const [index, { settings, held }] of seen.entries()) {
      expectValid(settings)
      // A change is a new object (spec 5.3), never the previous one altered…
      expect(settings).not.toBe(seen[index - 1]?.settings)
      // …so an object handed out earlier still holds what it held then.
      expect(JSON.stringify(settings)).toBe(held)
    }
    expect(JSON.stringify(DEFAULT_SETTINGS)).toBe(defaultsBefore)
  })

  it('never share an object with the caller: changing what was passed in changes nothing', () => {
    const store = createSettingsStore(new FakeStorage())
    const bindings: Record<string, number> = { KeyZ: 0 }
    const customLabels: Record<string, string> = { KeyZ: 'Z' }
    store.set({ bindings, customLabels })

    bindings.KeyX = 1
    customLabels.KeyX = 'X'
    delete bindings.KeyZ

    expect(store.get().bindings).toEqual({ KeyZ: 0 })
    expect(store.get().customLabels).toEqual({ KeyZ: 'Z' })
  })
})

describe('settings saved by a different version of the app', () => {
  it('an older save without the newer fields keeps what it has', () => {
    const older = { bindings: { KeyZ: 0 }, baseOctave: 2, volume: 0.6, sustain: true }
    const settings = createSettingsStore(new FakeStorage(JSON.stringify(older))).get()
    expectValid(settings)
    expect(settings).toMatchObject(older)
    expect(settings.reverb).toBe(DEFAULT_SETTINGS.reverb)
    expect(settings.accent).toBe(DEFAULT_SETTINGS.accent)
    expect(settings.pianoSize).toBe(DEFAULT_SETTINGS.pianoSize)
  })

  it('a newer save with fields and choices this version does not know is read as far as it is understood', () => {
    const newer = {
      ...DEFAULT_SETTINGS,
      version: 2,
      volume: 0.35,
      labelMode: 'solfege-only',
      release: 'pedal',
      metronome: { bpm: 96 },
      bindings: { KeyZ: 0, MediaPlayPause: 5, KeyX: { slot: 2, octave: 1 } },
    }
    const settings = sanitizeSettings(JSON.parse(JSON.stringify(newer)))
    expectValid(settings)
    expect(settings.volume).toBe(0.35)
    expect(settings.labelMode).toBe(DEFAULT_SETTINGS.labelMode)
    expect(settings.release).toBe(DEFAULT_SETTINGS.release)
    expect(settings.bindings).toEqual({ KeyZ: 0 })
  })
})
