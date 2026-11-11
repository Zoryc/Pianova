import { useSyncExternalStore } from 'react'
import { DEFAULT_BASE_OCTAVE, clampBaseOctave } from '../core/layout'
import type { LabelMode, NoteNaming, ReleaseLength } from '../core/types'
import { DEFAULT_BINDINGS, isBindableCode, sanitizeBindings } from '../input/keymap'
import type { Bindings } from '../input/keymap'

/** Defined in src/core/types.ts; re-exported here for convenience. */
export type { LabelMode, NoteNaming, ReleaseLength } from '../core/types'

export interface Settings {
  bindings: Bindings
  /** code -> label captured from KeyboardEvent.key when the user bound that key. */
  customLabels: Readonly<Record<string, string>>
  /** MIN_BASE_OCTAVE..MAX_BASE_OCTAVE */
  baseOctave: number
  /** 0..1 */
  volume: number
  sustain: boolean
  labelMode: LabelMode

  // Advanced settings (the Advanced panel). Defaults suit a beginner.

  /** "Touch": how hard notes are played, MIN_VELOCITY..1 */
  velocity: number
  /** Whole semitones, -MAX_TRANSPOSE..MAX_TRANSPOSE */
  transpose: number
  /** 'letters' (C D E) or 'solfege' (Do Ré Mi) */
  noteNaming: NoteNaming
  /** "Room echo", 0..1 */
  reverb: number
  /** How long a note rings after its key is released. */
  release: ReleaseLength
  /** Light trails above the piano. */
  showTrails: boolean
}

export const MIN_VELOCITY = 0.1
export const MAX_TRANSPOSE = 12

/** The keys of Settings that the Advanced panel controls (used by "Reset advanced settings"). */
export const ADVANCED_KEYS: readonly (keyof Settings)[] = Object.freeze([
  'velocity',
  'transpose',
  'noteNaming',
  'reverb',
  'release',
  'showTrails',
])

export const DEFAULT_SETTINGS: Settings = Object.freeze({
  bindings: DEFAULT_BINDINGS,
  customLabels: Object.freeze({}),
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
})

export const STORAGE_KEY = 'pianoapp.settings.v1'

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]

// Written as objects rather than lists so the compiler complains when an
// option is added to the type but forgotten here.
const LABEL_MODES: Readonly<Record<LabelMode, true>> = {
  keys: true,
  notes: true,
  both: true,
  none: true,
}
const NOTE_NAMINGS: Readonly<Record<NoteNaming, true>> = { letters: true, solfege: true }
const RELEASE_LENGTHS: Readonly<Record<ReleaseLength, true>> = {
  short: true,
  normal: true,
  long: true,
}

const MAX_LABEL_LENGTH = 6

/**
 * Turns anything (parsed JSON, garbage, null) into valid Settings; every
 * invalid or missing field falls back to its default.
 */
export function sanitizeSettings(raw: unknown): Settings {
  const defaults = DEFAULT_SETTINGS
  const read = (key: keyof Settings): unknown => ownValue(raw, key)

  return Object.freeze({
    bindings: sanitizeBindings(read('bindings')) ?? defaults.bindings,
    customLabels: sanitizeCustomLabels(read('customLabels')),
    baseOctave: clampBaseOctave(read('baseOctave')),
    volume: numberInRange(read('volume'), 0, 1, defaults.volume),
    sustain: booleanOr(read('sustain'), defaults.sustain),
    labelMode: optionOr(read('labelMode'), LABEL_MODES, defaults.labelMode),
    velocity: numberInRange(read('velocity'), MIN_VELOCITY, 1, defaults.velocity),
    transpose: wholeNumberInRange(
      read('transpose'),
      -MAX_TRANSPOSE,
      MAX_TRANSPOSE,
      defaults.transpose,
    ),
    noteNaming: optionOr(read('noteNaming'), NOTE_NAMINGS, defaults.noteNaming),
    reverb: numberInRange(read('reverb'), 0, 1, defaults.reverb),
    release: optionOr(read('release'), RELEASE_LENGTHS, defaults.release),
    showTrails: booleanOr(read('showTrails'), defaults.showTrails),
  })
}

export interface SettingsStore {
  /** Current settings. Same object reference until something changes. */
  get(): Settings
  /**
   * Merges, sanitizes, saves, notifies. No notification (and no new object)
   * when nothing actually changed.
   */
  set(patch: Partial<Settings>): void
  /** Back to DEFAULT_SETTINGS (saved and notified). */
  reset(): void
  /** Puts only the given keys back to their defaults (saved and notified). */
  resetKeys(keys: readonly (keyof Settings)[]): void
  subscribe(listener: () => void): () => void
}

/**
 * `storage` null/undefined → in-memory only. Storage errors (private mode,
 * quota, corrupt JSON) must never throw out of the store.
 */
export function createSettingsStore(storage?: StorageLike | null): SettingsStore {
  return createStore(storage).store
}

/** A store, plus the one extra thing the app-wide store needs (see `followOtherTabs`). */
interface StoreAndReload {
  store: SettingsStore
  /**
   * Reads the saved settings again and makes them the current ones. Listeners
   * are told when that changed something. Nothing is saved: the storage
   * already holds exactly this.
   */
  reloadFromStorage(): void
}

function createStore(storage: StorageLike | null | undefined): StoreAndReload {
  let current = load(storage)
  const listeners = new Set<() => void>()

  /** Makes `candidate` the current settings. False when that changes nothing. */
  function replaceCurrent(candidate: Settings): boolean {
    const next = reuseUnchangedParts(current, candidate)
    if (SETTING_KEYS.every((key) => next[key] === current[key])) return false
    current = next
    return true
  }

  function apply(candidate: Settings): void {
    if (!replaceCurrent(candidate)) return
    save(storage, current)
    notify()
  }

  function notify(): void {
    for (const listener of [...listeners]) {
      try {
        listener()
      } catch (error) {
        // One broken listener must not stop the others from hearing about the change.
        console.error('[settings] listener failed', error)
      }
    }
  }

  const store: SettingsStore = {
    get: () => current,
    set(patch) {
      // A value of `undefined` in a patch means "leave this setting as it is".
      const changes = Object.entries(patch).filter(([, value]) => value !== undefined)
      apply(sanitizeSettings({ ...current, ...Object.fromEntries(changes) }))
    },
    reset() {
      apply(DEFAULT_SETTINGS)
    },
    resetKeys(keys) {
      const defaults = keys
        .filter((key) => Object.hasOwn(DEFAULT_SETTINGS, key))
        .map((key) => [key, DEFAULT_SETTINGS[key]] as const)
      apply(sanitizeSettings({ ...current, ...Object.fromEntries(defaults) }))
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }

  return {
    store,
    reloadFromStorage() {
      // With no storage there is nothing to read: the settings in memory stay.
      if (storage && replaceCurrent(load(storage))) notify()
    },
  }
}

const appStore = createStore(browserStorage())

/**
 * App-wide singleton backed by window.localStorage when available.
 * Importing this module must not throw in Node.
 */
export const settingsStore: SettingsStore = appStore.store

followOtherTabs(appStore.reloadFromStorage)

/** React hook over `settingsStore` (useSyncExternalStore). */
export function useSettings(): Settings {
  return useSyncExternalStore(settingsStore.subscribe, settingsStore.get, settingsStore.get)
}

/**
 * The browser's storage, or null where there is none (Node, tests) or where
 * the browser refuses access: in some privacy modes merely reading
 * `window.localStorage` throws.
 */
function browserStorage(): StorageLike | null {
  try {
    return typeof window === 'undefined' ? null : (window.localStorage ?? null)
  } catch {
    return null
  }
}

/**
 * Keeps the app-wide store up to date when the app is open in several tabs.
 * Each time one tab saves, the browser sends a `storage` event to the other
 * tabs, and they read the settings again. Without this, a tab opened earlier
 * would save its old copy at its next change, over what the other tab had
 * saved (the player's own keys, for example).
 */
function followOtherTabs(reloadFromStorage: () => void): void {
  // Node has no window, and a stand-in window (in tests) may have no events.
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return

  window.addEventListener('storage', (event) => {
    // A key of null means everything the site had saved was cleared at once.
    if (event.key === STORAGE_KEY || event.key === null) reloadFromStorage()
  })
}

function load(storage: StorageLike | null | undefined): Settings {
  if (!storage) return DEFAULT_SETTINGS
  try {
    const saved = storage.getItem(STORAGE_KEY)
    return saved === null ? DEFAULT_SETTINGS : sanitizeSettings(JSON.parse(saved))
  } catch {
    // Storage that cannot be read, or damaged data: start from the defaults.
    return DEFAULT_SETTINGS
  }
}

function save(storage: StorageLike | null | undefined, settings: Settings): void {
  if (!storage) return
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // Private browsing or full storage: the settings still work until the page is closed.
  }
}

/**
 * `next`, but pointing at the previous `bindings` / `customLabels` objects
 * when their content did not change. Unchanged settings can then be spotted
 * with a plain `===`, by the store and by React.
 */
function reuseUnchangedParts(previous: Settings, next: Settings): Settings {
  return Object.freeze({
    ...next,
    bindings: sameEntries(previous.bindings, next.bindings) ? previous.bindings : next.bindings,
    customLabels: sameEntries(previous.customLabels, next.customLabels)
      ? previous.customLabels
      : next.customLabels,
  })
}

function sameEntries<Value>(
  a: Readonly<Record<string, Value>>,
  b: Readonly<Record<string, Value>>,
): boolean {
  const keys = Object.keys(a)
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.hasOwn(b, key) && a[key] === b[key])
  )
}

/** `raw[key]` when `raw` is an object with that property of its own (never an inherited one). */
function ownValue(raw: unknown, key: keyof Settings): unknown {
  if (typeof raw !== 'object' || raw === null || !Object.hasOwn(raw, key)) return undefined
  return (raw as Record<string, unknown>)[key]
}

function sanitizeCustomLabels(raw: unknown): Readonly<Record<string, string>> {
  if (typeof raw !== 'object' || raw === null) return DEFAULT_SETTINGS.customLabels

  const kept: [string, string][] = []
  for (const [code, label] of Object.entries(raw)) {
    if (isBindableCode(code) && isShortLabel(label)) kept.push([code, label])
  }
  return Object.freeze(Object.fromEntries(kept))
}

function isShortLabel(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= MAX_LABEL_LENGTH
}

function numberInRange(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

function wholeNumberInRange(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number') return fallback
  const whole = numberInRange(Math.round(value), min, max, fallback)
  // Math.round(-0.4) is -0, which would be shown as "-0".
  return whole === 0 ? 0 : whole
}

function booleanOr(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function optionOr<Option extends string>(
  value: unknown,
  options: Readonly<Record<Option, true>>,
  fallback: Option,
): Option {
  return typeof value === 'string' && Object.hasOwn(options, value) ? (value as Option) : fallback
}
