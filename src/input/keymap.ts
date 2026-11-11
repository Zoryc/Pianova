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
