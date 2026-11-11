import { useEffect, useState } from 'react'
import type { KeyboardType } from '../core/types'

/** KeyboardEvent.code -> the character that key types on the user's current keyboard layout. */
export type LayoutMap = ReadonlyMap<string, string>

/** What a US keyboard prints on the keys that are neither letters nor digits. */
const SYMBOL_LABELS: ReadonlyMap<string, string> = new Map([
  ['Minus', '-'],
  ['Equal', '='],
  ['BracketLeft', '['],
  ['BracketRight', ']'],
  ['Backslash', '\\'],
  ['Semicolon', ';'],
  ['Quote', "'"],
  ['Backquote', '`'],
  ['Comma', ','],
  ['Period', '.'],
  ['Slash', '/'],
  // Keys a US keyboard does not have: next to the left Shift (as printed in
  // the UK), and the "ro" and yen keys of Japanese keyboards.
  ['IntlBackslash', '\\'],
  ['IntlRo', 'ろ'],
  ['IntlYen', '¥'],
  ['NumpadDecimal', 'Num .'],
  ['NumpadAdd', 'Num +'],
  ['NumpadSubtract', 'Num -'],
  ['NumpadMultiply', 'Num *'],
  ['NumpadDivide', 'Num /'],
])

/**
 * One visible character: a letter, digit, punctuation mark or symbol.
 * Spaces, control characters and lone accents do not match.
 */
const PRINTABLE_CHARACTER = /^[\p{L}\p{N}\p{P}\p{S}]$/u

/**
 * The character keys of a keyboard by physical position: one line per row,
 * from the row of digits down, each from left to right. The home row ends with
 * the key beside Enter (above it on US keyboards) and the bottom row starts
 * with the key beside the left Shift, which US keyboards do not have.
 */
const KEY_ROWS: readonly (readonly string[])[] = [
  'Backquote Digit1 Digit2 Digit3 Digit4 Digit5 Digit6 Digit7 Digit8 Digit9 Digit0 Minus Equal',
  'KeyQ KeyW KeyE KeyR KeyT KeyY KeyU KeyI KeyO KeyP BracketLeft BracketRight',
  'KeyA KeyS KeyD KeyF KeyG KeyH KeyJ KeyK KeyL Semicolon Quote Backslash',
  'IntlBackslash KeyZ KeyX KeyC KeyV KeyB KeyN KeyM Comma Period Slash',
].map((row) => row.split(' '))

/**
 * What each keyboard type prints on those keys: keyboard type -> (code ->
 * label). A keyboard is written the way it looks: one string per row of
 * KEY_ROWS, one character per key, being what that key types on its own
 * (without Shift). An accent key that waits for the next letter is written as
 * its accent. 'auto' has no table: it asks the browser instead.
 */
const TYPED_LABELS: ReadonlyMap<KeyboardType, ReadonlyMap<string, string>> = new Map<
  KeyboardType,
  ReadonlyMap<string, string>
>([
  // The US keyboard, plus the key beside the left Shift as the UK prints it.
  ['qwerty', keycapLabels(['`1234567890-=', 'qwertyuiop[]', "asdfghjkl;'\\", '\\zxcvbnm,./'])],
  // The French keyboard, as Windows lays it out. Its digits need Shift, so
  // the row of digits reads as accented letters and punctuation.
  ['azerty', keycapLabels([`²&é"'(-è_çà)=`, 'azertyuiop^$', 'qsdfghjklmù*', '<wxcvbn,;:!'])],
  // The German keyboard, as Windows lays it out.
  ['qwertz', keycapLabels(['^1234567890ß´', 'qwertzuiopü+', 'asdfghjklöä#', '<yxcvbnm,.-'])],
])

/**
 * US-QWERTY label for a code: 'KeyA'→'A', 'Digit1'→'1', 'Semicolon'→';',
 * 'Quote'→"'", 'Numpad1'→'Num 1', 'NumpadAdd'→'Num +'. Unknown codes return
 * the code itself.
 */
export function defaultKeyLabel(code: string): string {
  if (/^Key[A-Z]$/.test(code)) return code.slice('Key'.length)
  if (/^Digit[0-9]$/.test(code)) return code.slice('Digit'.length)
  if (/^Numpad[0-9]$/.test(code)) return `Num ${code.slice('Numpad'.length)}`
  return SYMBOL_LABELS.get(code) ?? code
}

/**
 * Turns KeyboardEvent.key into a label: a single printable, non-space
 * character → upper-cased (locale-independent); anything else ('Dead',
 * 'Shift', 'Enter', '') → null.
 */
export function labelFromEventKey(key: string): string | null {
  if (typeof key !== 'string' || !PRINTABLE_CHARACTER.test(key)) return null
  return toKeycapCase(key)
}

/**
 * Label to show for a physical key. Priority: the keyboard type the player
 * chose, for the keys that keyboard has ('auto' chooses none) → layoutMap
 * (current layout) → customLabels (captured when the user bound the key) →
 * defaultKeyLabel. Letters are upper-cased.
 */
export function keyLabel(
  code: string,
  layoutMap: LayoutMap | null,
  customLabels?: Readonly<Record<string, string>>,
  keyboardType: KeyboardType = 'auto',
): string {
  // The number pad is the same on every layout, and the character it types
  // ("1") would be mistaken for the digit row, so it always reads "Num 1".
  if (code.startsWith('Numpad')) return defaultKeyLabel(code)
  return (
    typedLabel(code, keyboardType) ??
    layoutLabel(code, layoutMap) ??
    customLabel(code, customLabels) ??
    defaultKeyLabel(code)
  )
}

/**
 * The letter printed on a physical key for a given keyboard type ('qwerty' is
 * `defaultKeyLabel`). A key that keyboard does not have keeps its
 * `defaultKeyLabel`, and so does the number pad, which is the same on all.
 */
export function typedKeyLabel(code: string, type: Exclude<KeyboardType, 'auto'>): string {
  return typedLabel(code, type) ?? defaultKeyLabel(code)
}

/**
 * navigator.keyboard.getLayoutMap() when the browser has it (Chrome/Edge);
 * null otherwise or on failure. Never rejects.
 */
export async function loadLayoutMap(): Promise<LayoutMap | null> {
  try {
    const keyboard = browserKeyboard()
    if (keyboard === null) return null
    const layoutMap: unknown = await keyboard.getLayoutMap()
    return isLayoutMap(layoutMap) ? layoutMap : null
  } catch {
    // The browser can refuse (for example inside an embedded frame).
    // The saved and default labels are used instead.
    return null
  }
}

/** React hook: null until loaded (or forever when unsupported). */
export function useLayoutMap(): LayoutMap | null {
  const [layoutMap, setLayoutMap] = useState<LayoutMap | null>(null)

  useEffect(() => {
    let unmounted = false
    void loadLayoutMap().then((loaded) => {
      if (!unmounted) setLayoutMap(loaded)
    })
    return () => {
      unmounted = true
    }
  }, [])

  return layoutMap
}

/** The one part of the Keyboard Map API this app uses. It is not in TypeScript's DOM types. */
interface LayoutMapSource {
  getLayoutMap(): Promise<LayoutMap>
}

function browserKeyboard(): LayoutMapSource | null {
  if (typeof navigator === 'undefined') return null
  const keyboard = (navigator as { keyboard?: Partial<LayoutMapSource> | null }).keyboard
  return typeof keyboard?.getLayoutMap === 'function' ? (keyboard as LayoutMapSource) : null
}

function isLayoutMap(value: unknown): value is LayoutMap {
  return (
    typeof value === 'object' && value !== null && typeof (value as LayoutMap).get === 'function'
  )
}

/** Turns the rows of characters of one keyboard into its labels, key by key. */
function keycapLabels(typedRows: readonly string[]): ReadonlyMap<string, string> {
  const labels = new Map<string, string>()
  KEY_ROWS.forEach((codes, row) => {
    const characters = [...(typedRows[row] ?? '')]
    codes.forEach((code, column) => {
      const character = characters[column]
      if (character !== undefined) labels.set(code, toKeycapCase(character))
    })
  })
  return labels
}

/** Null when the keyboard type is 'auto' or has no such key. */
function typedLabel(code: string, type: KeyboardType): string | null {
  return TYPED_LABELS.get(type)?.get(code) ?? null
}

function layoutLabel(code: string, layoutMap: LayoutMap | null): string | null {
  const character = layoutMap?.get(code)
  return character === undefined ? null : labelFromEventKey(character)
}

function customLabel(
  code: string,
  customLabels: Readonly<Record<string, string>> | undefined,
): string | null {
  if (!customLabels || !Object.hasOwn(customLabels, code)) return null
  const label = customLabels[code]
  if (typeof label !== 'string' || label.trim() === '') return null
  return labelFromEventKey(label) ?? label
}

/**
 * Upper-cases a character the way it is printed on a keycap. `toUpperCase`
 * gives the same result whatever the browser's language is (unlike
 * `toLocaleUpperCase`). A few characters have no capital of their own
 * ('ß' would become 'SS', 'µ' the Greek letter 'Μ'): those stay as typed.
 */
function toKeycapCase(character: string): string {
  const upper = character.toUpperCase()
  return upper.toLowerCase() === character.toLowerCase() ? upper : character
}
