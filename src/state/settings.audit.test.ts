/**
 * What survives from one version of the app to the next, and what does not.
 *
 * The version before the immersive screen saved twelve settings under the
 * same storage entry. A player who comes back after the update must find
 * their own keys and choices as they left them, with the new options at
 * their defaults. The saved songs are new with this version; their entries
 * are checked for the version marker in their names.
 */
import { describe, expect, it } from 'vitest'
import { DEFAULT_BINDINGS, KEY_PRESETS, matchingPreset } from '../input/keymap'
import { createSongLibrary } from '../songs/songLibrary'
import { tuneToSong } from '../songs/starterSongs'
import { DEFAULT_SETTINGS, STORAGE_KEY, createSettingsStore, sanitizeSettings } from './settings'
import type { Settings, StorageLike } from './settings'
import { matchingTheme } from './themes'

/** A stand-in for the browser's storage that remembers every write. */
function fakeStorage(initial: Record<string, string> = {}): StorageLike & {
  entries: Map<string, string>
  writes: string[]
} {
  const entries = new Map(Object.entries(initial))
  const writes: string[] = []
  return {
    entries,
    writes,
    getItem: (name) => entries.get(name) ?? null,
    setItem(name, value) {
      writes.push(name)
      entries.set(name, value)
    },
    removeItem(name) {
      entries.delete(name)
    },
  }
}

/** Exactly the fields the previous version wrote, with its defaults. */
const PREVIOUS_VERSION_DEFAULTS = {
  bindings: { ...DEFAULT_BINDINGS },
  customLabels: {},
  baseOctave: 3,
  volume: 0.8,
  sustain: false,
  labelMode: 'both',
  velocity: 0.8,
  transpose: 0,
  noteNaming: 'letters',
  reverb: 0.15,
  release: 'normal',
  showTrails: true,
}

/** The same fields after a player made the app their own. */
const PREVIOUS_VERSION_CUSTOMIZED = {
  bindings: { KeyQ: 0, KeyZ: 12, Numpad1: 36, Semicolon: 20, IntlBackslash: 5 },
  customLabels: { KeyQ: 'A', KeyZ: 'W', Semicolon: 'M' },
  baseOctave: 2,
  volume: 0.35,
  sustain: true,
  labelMode: 'notes',
  velocity: 0.55,
  transpose: -3,
  noteNaming: 'solfege',
  reverb: 0.6,
  release: 'long',
  showTrails: false,
}

/** The settings that did not exist before, with the values they must start at. */
const NEW_SETTINGS_AT_THEIR_DEFAULTS: Partial<Settings> = {
  pianoSize: 'auto',
  keyStyle: 'classic',
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

function storeOver(saved: unknown): {
  store: ReturnType<typeof createSettingsStore>
  storage: ReturnType<typeof fakeStorage>
} {
  const storage = fakeStorage({ [STORAGE_KEY]: JSON.stringify(saved) })
  return { store: createSettingsStore(storage), storage }
}

describe('settings saved by the previous version', () => {
  it('are read from the same storage entry', () => {
    expect(STORAGE_KEY).toBe('pianoapp.settings.v1')
  })

  it('load as the defaults of this version when nothing had been changed', () => {
    const { store } = storeOver(PREVIOUS_VERSION_DEFAULTS)
    expect(store.get()).toEqual(DEFAULT_SETTINGS)
    expect(matchingPreset(store.get().bindings)).toBe('home-row')
    expect(matchingTheme(store.get())).toBe('ember')
  })

  it("keep every one of the player's own keys and choices", () => {
    const { store } = storeOver(PREVIOUS_VERSION_CUSTOMIZED)
    expect(store.get()).toEqual({ ...PREVIOUS_VERSION_CUSTOMIZED, ...NEW_SETTINGS_AT_THEIR_DEFAULTS })
    // Their keys are their own: no ready-made layout is marked as chosen.
    expect(matchingPreset(store.get().bindings)).toBeNull()
    // The look is the one the app starts with.
    expect(matchingTheme(store.get())).toBe('ember')
  })

  it('are not rewritten by being read', () => {
    const { storage } = storeOver(PREVIOUS_VERSION_CUSTOMIZED)
    expect(storage.writes).toEqual([])
    expect(JSON.parse(storage.entries.get(STORAGE_KEY) ?? '')).toEqual(PREVIOUS_VERSION_CUSTOMIZED)
  })

  it('are saved again with the new settings beside them at the first change', () => {
    const { store, storage } = storeOver(PREVIOUS_VERSION_CUSTOMIZED)
    store.set({ accent: 'blue' })
    expect(storage.writes).toEqual([STORAGE_KEY])
    expect(JSON.parse(storage.entries.get(STORAGE_KEY) ?? '')).toEqual({
      ...PREVIOUS_VERSION_CUSTOMIZED,
      ...NEW_SETTINGS_AT_THEIR_DEFAULTS,
      accent: 'blue',
    })
  })

  it('survive a ready-made layout being tried and their own keys being put back', () => {
    const { store, storage } = storeOver(PREVIOUS_VERSION_CUSTOMIZED)
    const twoOctaves = KEY_PRESETS.find((preset) => preset.id === 'two-octaves')
    store.set({ bindings: twoOctaves?.bindings })
    expect(matchingPreset(store.get().bindings)).toBe('two-octaves')
    // The letters captured for the player's keyboard are not thrown away with the keys.
    expect(store.get().customLabels).toEqual(PREVIOUS_VERSION_CUSTOMIZED.customLabels)

    store.set({ bindings: PREVIOUS_VERSION_CUSTOMIZED.bindings })
    const visitAfter = createSettingsStore(storage)
    expect(visitAfter.get().bindings).toEqual(PREVIOUS_VERSION_CUSTOMIZED.bindings)
  })

  // The switch "Light trails" is now called "Light bars" and is still saved as
  // `showTrails`. What it hides while a song plays (the falling notes too) is
  // checked with the real sky, in src/App.audit.test.tsx.
  it('that turned the light trails off have the light bars off, and that stays so when saved again', () => {
    const { store, storage } = storeOver(PREVIOUS_VERSION_CUSTOMIZED)
    expect(store.get().showTrails).toBe(false)

    store.set({ volume: 0.5 })
    const saved = JSON.parse(storage.entries.get(STORAGE_KEY) ?? '') as Record<string, unknown>
    expect(saved.showTrails).toBe(false)
    expect(createSettingsStore(storage).get().showTrails).toBe(false)
  })

  it('that had the light trails on have the light bars on', () => {
    const { store } = storeOver({ ...PREVIOUS_VERSION_CUSTOMIZED, showTrails: true })
    expect(store.get().showTrails).toBe(true)
  })
})

describe('saved settings this version does not know', () => {
  it('ignores fields from a later version and keeps the rest', () => {
    const { store } = storeOver({
      ...PREVIOUS_VERSION_CUSTOMIZED,
      accent: 'green',
      practiceHints: true,
      metronome: { on: true, beats: 4 },
      schemaVersion: 7,
    })
    expect(store.get()).toEqual({
      ...PREVIOUS_VERSION_CUSTOMIZED,
      ...NEW_SETTINGS_AT_THEIR_DEFAULTS,
      accent: 'green',
    })
    expect(Object.keys(store.get()).sort()).toEqual(Object.keys(DEFAULT_SETTINGS).sort())
  })

  it('drops those fields from storage at the next save, and nothing else', () => {
    const { store, storage } = storeOver({ ...PREVIOUS_VERSION_CUSTOMIZED, practiceHints: true })
    store.set({ volume: 0.5 })
    const saved = JSON.parse(storage.entries.get(STORAGE_KEY) ?? '') as Record<string, unknown>
    expect(Object.hasOwn(saved, 'practiceHints')).toBe(false)
    expect(saved.bindings).toEqual(PREVIOUS_VERSION_CUSTOMIZED.bindings)
    expect(saved.volume).toBe(0.5)
  })

  it('gives a known setting its default when its value is one a later version added', () => {
    const settings = sanitizeSettings({
      ...PREVIOUS_VERSION_CUSTOMIZED,
      accent: 'pink',
      keyStyle: 'wood',
      pianoSize: 76,
      background: 'sunset',
      sparks: 'fireworks',
      keyboardType: 'dvorak',
      barStyle: 'dots',
    })
    expect(settings).toEqual({ ...PREVIOUS_VERSION_CUSTOMIZED, ...NEW_SETTINGS_AT_THEIR_DEFAULTS })
  })

  it('reads a saved entry that is not an object at all as the defaults', () => {
    for (const saved of [null, 7, 'settings', [], [1, 2, 3], true]) {
      expect(storeOver(saved).store.get()).toEqual(DEFAULT_SETTINGS)
    }
  })
})

describe('the two storage areas', () => {
  it('both carry a version marker in the names of their entries', () => {
    const storage = fakeStorage()
    const settings = createSettingsStore(storage)
    const library = createSongLibrary(storage)
    settings.set({ volume: 0.3 })
    library.add(tuneToSong('my-tune', 'My tune', 100, 'C4/1 D4/1 E4/2'))
    library.setOptions('my-tune', { speed: 0.75 })

    expect([...storage.entries.keys()].sort()).toEqual([
      'pianoapp.settings.v1',
      'pianoapp.song.v1.my-tune',
      'pianoapp.songs.v1',
    ])
  })

  it('do not get in the way of each other', () => {
    const storage = fakeStorage()
    const settings = createSettingsStore(storage)
    const library = createSongLibrary(storage)
    library.add(tuneToSong('my-tune', 'My tune', 100, 'C4/1 D4/1 E4/2'))
    settings.set({ accent: 'amber' })
    settings.reset()

    // "Reset all settings" is about the settings: the songs stay.
    expect(createSongLibrary(storage).list().map((song) => song.title)).toEqual(['My tune'])
    expect(createSettingsStore(storage).get()).toEqual(DEFAULT_SETTINGS)
  })

  it('are both gone after the browser data is cleared: defaults and an empty list, no error', () => {
    const storage = fakeStorage()
    const settings = createSettingsStore(storage)
    const library = createSongLibrary(storage)
    settings.set({ bindings: { KeyQ: 0 }, accent: 'blue', volume: 0.2 })
    library.add(tuneToSong('my-tune', 'My tune', 100, 'C4/1 D4/1 E4/2'))

    storage.entries.clear()

    // The next visit: the player's keys, look, sound and songs are all gone.
    expect(createSettingsStore(storage).get()).toEqual(DEFAULT_SETTINGS)
    expect(createSongLibrary(storage).list()).toEqual([])
    expect(createSongLibrary(storage).get('my-tune')).toBeNull()
  })

  it('a page still open when the data is cleared keeps its settings and saves them again', () => {
    const storage = fakeStorage()
    const settings = createSettingsStore(storage)
    settings.set({ bindings: { KeyQ: 0 }, accent: 'blue' })

    storage.entries.clear()
    settings.set({ volume: 0.4 })

    expect(createSettingsStore(storage).get()).toMatchObject({
      bindings: { KeyQ: 0 },
      accent: 'blue',
      volume: 0.4,
    })
  })
})
