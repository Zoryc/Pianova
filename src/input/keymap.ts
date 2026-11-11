import { isValidSlot } from '../core/layout'

/** KeyboardEvent.code -> slot (0..SLOT_COUNT-1). */
export type Bindings = Readonly<Record<string, number>>

/**
 * Home row = white keys, row above = black keys, starting at middle C
 * (slot 12 when the piano is at its default position). The codes are
 * physical positions, named after what a US keyboard prints on them.
 */
export const DEFAULT_BINDINGS: Bindings = Object.freeze({
  KeyA: 12, // C (middle C)
  KeyW: 13, // C♯
  KeyS: 14, // D
  KeyE: 15, // D♯
  KeyD: 16, // E
  KeyF: 17, // F
  KeyT: 18, // F♯
  KeyG: 19, // G
  KeyY: 20, // G♯
  KeyH: 21, // A
  KeyU: 22, // A♯
  KeyJ: 23, // B
  KeyK: 24, // C
  KeyO: 25, // C♯
  KeyL: 26, // D
  KeyP: 27, // D♯
  Semicolon: 28, // E
  Quote: 29, // F
})

/**
 * Two rows per octave, laid out like the piano itself: a row of letters plays
 * the white keys and the keys just above it, in the gaps, play the black keys.
 */
const TWO_OCTAVES_BINDINGS: Bindings = Object.freeze({
  // Low octave: bottom row, with the black keys on the home row.
  KeyZ: 0, // C
  KeyS: 1, // C♯
  KeyX: 2, // D
  KeyD: 3, // D♯
  KeyC: 4, // E
  KeyV: 5, // F
  KeyG: 6, // F♯
  KeyB: 7, // G
  KeyH: 8, // G♯
  KeyN: 9, // A
  KeyJ: 10, // A♯
  KeyM: 11, // B
  // High octave: top row of letters, with the black keys on the digits.
  KeyQ: 12, // C (middle C)
  Digit2: 13, // C♯
  KeyW: 14, // D
  Digit3: 15, // D♯
  KeyE: 16, // E
  KeyR: 17, // F
  Digit5: 18, // F♯
  KeyT: 19, // G
  Digit6: 20, // G♯
  KeyY: 21, // A
  Digit7: 22, // A♯
  KeyU: 23, // B
  // The same two rows carry on a little way into the next octave.
  KeyI: 24, // C
  Digit9: 25, // C♯
  KeyO: 26, // D
  Digit0: 27, // D♯
  KeyP: 28, // E
  BracketLeft: 29, // F
  Equal: 30, // F♯
  BracketRight: 31, // G
})

/** One row of letters per octave, white keys only, and one more key for the top C. */
const WHITE_KEYS_BINDINGS: Bindings = Object.freeze({
  // First octave: bottom row.
  KeyZ: 0, // C
  KeyX: 2, // D
  KeyC: 4, // E
  KeyV: 5, // F
  KeyB: 7, // G
  KeyN: 9, // A
  KeyM: 11, // B
  // Second octave: home row.
  KeyA: 12, // C (middle C, as in the default keys)
  KeyS: 14, // D
  KeyD: 16, // E
  KeyF: 17, // F
  KeyG: 19, // G
  KeyH: 21, // A
  KeyJ: 23, // B
  // Third octave: top row.
  KeyQ: 24, // C
  KeyW: 26, // D
  KeyE: 28, // E
  KeyR: 29, // F
  KeyT: 31, // G
  KeyY: 33, // A
  KeyU: 35, // B
  KeyI: 36, // C, the last key of the piano
})

export type KeyPresetId = 'home-row' | 'two-octaves' | 'white-keys'

/** A ready-made set of keys the player can choose with one click. */
export interface KeyPreset {
  id: KeyPresetId
  /** "Home row", "Two octaves", "White keys only" */
  name: string
  description: string
  bindings: Bindings
}

/** In the order shown to the player. `DEFAULT_BINDINGS` is the 'home-row' preset's bindings. */
export const KEY_PRESETS: readonly KeyPreset[] = Object.freeze([
  Object.freeze({
    id: 'home-row',
    name: 'Home row',
    description: 'The middle row plays the white keys, the row above plays the black keys.',
    bindings: DEFAULT_BINDINGS,
  }),
  Object.freeze({
    id: 'two-octaves',
    name: 'Two octaves',
    description: 'Two rows for a low octave, two rows for a high octave.',
    bindings: TWO_OCTAVES_BINDINGS,
  }),
  Object.freeze({
    id: 'white-keys',
    name: 'White keys only',
    description: 'Three rows, three octaves, no black keys. Good for simple tunes.',
    bindings: WHITE_KEYS_BINDINGS,
  }),
])

const LETTERS = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ']
const DIGITS = [...'0123456789']

/**
 * Only keys that type a character may play a note. Space, Enter, Tab, Escape,
 * the arrows, F-keys and modifiers keep their usual job in the browser.
 */
const BINDABLE_CODES: ReadonlySet<string> = new Set([
  ...LETTERS.map((letter) => `Key${letter}`),
  ...DIGITS.map((digit) => `Digit${digit}`),
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
  ...DIGITS.map((digit) => `Numpad${digit}`),
  'NumpadDecimal',
  'NumpadAdd',
  'NumpadSubtract',
  'NumpadMultiply',
  'NumpadDivide',
])

/** True for keys the user may bind (see the allow-list above). */
export function isBindableCode(code: string): boolean {
  return BINDABLE_CODES.has(code)
}

/** The key bound to `slot`, or null. */
export function codeForSlot(bindings: Bindings, slot: number): string | null {
  for (const [code, boundSlot] of Object.entries(bindings)) {
    if (boundSlot === slot) return code
  }
  return null
}

export interface AssignResult {
  bindings: Bindings
  /** A different key that used to play `slot` and now plays nothing (null if none). */
  replacedCode: string | null
  /**
   * The slot `code` used to play, which now has no key
   * (null if `code` was unbound or already on `slot`).
   */
  vacatedSlot: number | null
}

/**
 * Makes `code` play `slot`. Throws RangeError if the code is not bindable or
 * the slot is invalid. Never mutates its input.
 */
export function assignBinding(bindings: Bindings, code: string, slot: number): AssignResult {
  if (!isBindableCode(code)) {
    throw new RangeError(`Key "${code}" cannot be used to play a note.`)
  }
  if (!isValidSlot(slot)) {
    throw new RangeError(`${slot} is not a key of the piano.`)
  }

  const previousSlot = slotForCode(bindings, code)
  if (previousSlot === slot) {
    return { bindings, replacedCode: null, vacatedSlot: null }
  }

  // One key = one note: drop the key's old note and the note's old key.
  const untouched = Object.entries(bindings).filter(
    ([boundCode, boundSlot]) => boundCode !== code && boundSlot !== slot,
  )
  return {
    bindings: toBindings([...untouched, [code, slot]]),
    replacedCode: codeForSlot(bindings, slot),
    vacatedSlot: previousSlot,
  }
}

/** Removes whatever key is bound to `slot`. Returns the same object if nothing was bound. */
export function clearSlot(bindings: Bindings, slot: number): Bindings {
  if (codeForSlot(bindings, slot) === null) return bindings
  return toBindings(Object.entries(bindings).filter(([, boundSlot]) => boundSlot !== slot))
}

/**
 * Cleans data read from storage. Returns null when `raw` is not a plain object
 * (caller then uses DEFAULT_BINDINGS). Otherwise keeps only entries with a
 * bindable code and a valid slot; if two codes point at the same slot, the
 * first one in iteration order wins. An empty object is valid (all keys cleared).
 */
export function sanitizeBindings(raw: unknown): Bindings | null {
  if (!isPlainObject(raw)) return null

  const takenSlots = new Set<number>()
  const kept: [string, number][] = []
  for (const [code, slot] of Object.entries(raw)) {
    if (!isBindableCode(code) || !isValidSlot(slot) || takenSlots.has(slot)) continue
    takenSlots.add(slot)
    kept.push([code, slot])
  }
  return toBindings(kept)
}

/** The preset whose keys are exactly these, or null ("Custom"). */
export function matchingPreset(bindings: Bindings): KeyPresetId | null {
  return KEY_PRESETS.find((preset) => sameBindings(preset.bindings, bindings))?.id ?? null
}

/** Same keys playing the same notes, in whatever order they are stored. */
function sameBindings(first: Bindings, second: Bindings): boolean {
  const entries = Object.entries(first)
  return (
    entries.length === Object.keys(second).length &&
    entries.every(([code, slot]) => slotForCode(second, code) === slot)
  )
}

function slotForCode(bindings: Bindings, code: string): number | null {
  // Own properties only, so inherited names such as "constructor" are never read as a slot.
  return Object.hasOwn(bindings, code) ? (bindings[code] ?? null) : null
}

/** Object.fromEntries defines plain own properties, so no entry can ever reach the prototype. */
function toBindings(entries: readonly (readonly [string, number])[]): Bindings {
  return Object.freeze(Object.fromEntries(entries))
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false
  const prototype: unknown = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}
