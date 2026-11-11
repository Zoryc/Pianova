import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { KeyboardType } from '../core/types'
import {
  defaultKeyLabel,
  keyLabel,
  labelFromEventKey,
  loadLayoutMap,
  typedKeyLabel,
  useLayoutMap,
} from './keyLabels'
import type { LayoutMap } from './keyLabels'
import { DEFAULT_BINDINGS, isBindableCode } from './keymap'

/** A French (AZERTY) keyboard, as Chrome reports it: lower-case characters. */
const AZERTY: LayoutMap = new Map([
  ['KeyA', 'q'],
  ['KeyQ', 'a'],
  ['KeyW', 'z'],
  ['KeyZ', 'w'],
  ['Semicolon', 'm'],
  ['Quote', 'ù'],
  ['KeyM', ','],
  ['Digit2', 'é'],
])

const LETTER_CODES = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].map((letter) => `Key${letter}`)
const DIGIT_ROW_CODES = [...'1234567890'].map((digit) => `Digit${digit}`)
const SYMBOL_CODES = ['Minus', 'Equal', 'BracketLeft', 'BracketRight', 'Backslash', 'Semicolon']
const MORE_SYMBOL_CODES = ['Quote', 'Backquote', 'Comma', 'Period', 'Slash', 'IntlBackslash']
const JAPANESE_ONLY_CODES = ['IntlRo', 'IntlYen']
const NUMPAD_CODES = [
  ...[...'0123456789'].map((digit) => `Numpad${digit}`),
  ...['Decimal', 'Add', 'Subtract', 'Multiply', 'Divide'].map((name) => `Numpad${name}`),
]
/** The 48 keys that type a character on a French or German keyboard. */
const CHARACTER_CODES = [...LETTER_CODES, ...DIGIT_ROW_CODES, ...SYMBOL_CODES, ...MORE_SYMBOL_CODES]
const ALL_BINDABLE_CODES = [...CHARACTER_CODES, ...JAPANESE_ONLY_CODES, ...NUMPAD_CODES]
const NAMED_TYPES = ['qwerty', 'azerty', 'qwertz'] as const

/**
 * A French keyboard (the AZERTY layout of Windows), key by key: the label for
 * what each key types without Shift.
 */
const FRENCH_KEYCAPS: Readonly<Record<string, string>> = {
  Backquote: '²',
  Digit1: '&',
  Digit2: 'É',
  Digit3: '"',
  Digit4: "'",
  Digit5: '(',
  Digit6: '-',
  Digit7: 'È',
  Digit8: '_',
  Digit9: 'Ç',
  Digit0: 'À',
  Minus: ')',
  Equal: '=',
  KeyQ: 'A',
  KeyW: 'Z',
  KeyE: 'E',
  KeyR: 'R',
  KeyT: 'T',
  KeyY: 'Y',
  KeyU: 'U',
  KeyI: 'I',
  KeyO: 'O',
  KeyP: 'P',
  BracketLeft: '^',
  BracketRight: '$',
  KeyA: 'Q',
  KeyS: 'S',
  KeyD: 'D',
  KeyF: 'F',
  KeyG: 'G',
  KeyH: 'H',
  KeyJ: 'J',
  KeyK: 'K',
  KeyL: 'L',
  Semicolon: 'M',
  Quote: 'Ù',
  Backslash: '*',
  IntlBackslash: '<',
  KeyZ: 'W',
  KeyX: 'X',
  KeyC: 'C',
  KeyV: 'V',
  KeyB: 'B',
  KeyN: 'N',
  KeyM: ',',
  Comma: ';',
  Period: ':',
  Slash: '!',
}

/** A German keyboard (the QWERTZ layout of Windows), key by key. */
const GERMAN_KEYCAPS: Readonly<Record<string, string>> = {
  Backquote: '^',
  Digit1: '1',
  Digit2: '2',
  Digit3: '3',
  Digit4: '4',
  Digit5: '5',
  Digit6: '6',
  Digit7: '7',
  Digit8: '8',
  Digit9: '9',
  Digit0: '0',
  Minus: 'ß',
  Equal: '´',
  KeyQ: 'Q',
  KeyW: 'W',
  KeyE: 'E',
  KeyR: 'R',
  KeyT: 'T',
  KeyY: 'Z',
  KeyU: 'U',
  KeyI: 'I',
  KeyO: 'O',
  KeyP: 'P',
  BracketLeft: 'Ü',
  BracketRight: '+',
  KeyA: 'A',
  KeyS: 'S',
  KeyD: 'D',
  KeyF: 'F',
  KeyG: 'G',
  KeyH: 'H',
  KeyJ: 'J',
  KeyK: 'K',
  KeyL: 'L',
  Semicolon: 'Ö',
  Quote: 'Ä',
  Backslash: '#',
  IntlBackslash: '<',
  KeyZ: 'Y',
  KeyX: 'X',
  KeyC: 'C',
  KeyV: 'V',
  KeyB: 'B',
  KeyN: 'N',
  KeyM: 'M',
  Comma: ',',
  Period: '.',
  Slash: '-',
}

/** What the browser reports for such a keyboard: the characters as typed, in lower case. */
function asLayoutMap(keycaps: Readonly<Record<string, string>>): LayoutMap {
  return new Map(Object.entries(keycaps).map(([code, label]) => [code, label.toLowerCase()]))
}

/** The labels of several keys side by side, as they would read along the piano. */
function typedLabels(codes: readonly string[], type: Exclude<KeyboardType, 'auto'>): string {
  return codes.map((code) => typedKeyLabel(code, type)).join(' ')
}

describe('defaultKeyLabel', () => {
  it('names letters and digits', () => {
    expect(defaultKeyLabel('KeyA')).toBe('A')
    expect(defaultKeyLabel('KeyZ')).toBe('Z')
    expect(defaultKeyLabel('Digit0')).toBe('0')
    expect(defaultKeyLabel('Digit1')).toBe('1')
    expect(defaultKeyLabel('Digit9')).toBe('9')
  })

  it('names symbol keys as a US keyboard prints them', () => {
    const expected: Record<string, string> = {
      Minus: '-',
      Equal: '=',
      BracketLeft: '[',
      BracketRight: ']',
      Backslash: '\\',
      Semicolon: ';',
      Quote: "'",
      Backquote: '`',
      Comma: ',',
      Period: '.',
      Slash: '/',
      IntlBackslash: '\\',
      IntlRo: 'ろ',
      IntlYen: '¥',
    }
    for (const [code, label] of Object.entries(expected)) {
      expect(defaultKeyLabel(code), code).toBe(label)
    }
  })

  it('marks number-pad keys with "Num"', () => {
    expect(defaultKeyLabel('Numpad0')).toBe('Num 0')
    expect(defaultKeyLabel('Numpad1')).toBe('Num 1')
    expect(defaultKeyLabel('Numpad9')).toBe('Num 9')
    expect(defaultKeyLabel('NumpadDecimal')).toBe('Num .')
    expect(defaultKeyLabel('NumpadAdd')).toBe('Num +')
    expect(defaultKeyLabel('NumpadSubtract')).toBe('Num -')
    expect(defaultKeyLabel('NumpadMultiply')).toBe('Num *')
    expect(defaultKeyLabel('NumpadDivide')).toBe('Num /')
  })

  it('returns unknown codes unchanged', () => {
    const unknownCodes = ['Space', 'Enter', 'F5', 'KeyAA', 'Key1', 'keya', 'Digit10', 'Numpad10']
    const oddCodes = ['', '__proto__', 'constructor', 'toString']
    for (const code of [...unknownCodes, ...oddCodes]) {
      expect(defaultKeyLabel(code)).toBe(code)
    }
  })

  it('gives every default key a short label of its own', () => {
    const labels = Object.keys(DEFAULT_BINDINGS).map(defaultKeyLabel)
    expect(labels.join(' ')).toBe("A W S E D F T G Y H U J K O L P ; '")
  })

  it('gives every bindable key a short label that is not its code', () => {
    expect(new Set(ALL_BINDABLE_CODES).size).toBe(65)
    for (const code of ALL_BINDABLE_CODES) {
      expect(isBindableCode(code), code).toBe(true)
      const label = defaultKeyLabel(code)
      expect(label, code).not.toBe(code)
      expect(label.length, code).toBeGreaterThan(0)
      expect(label.length, code).toBeLessThanOrEqual(5)
    }
  })
})

describe('labelFromEventKey', () => {
  it('upper-cases letters', () => {
    expect(labelFromEventKey('a')).toBe('A')
    expect(labelFromEventKey('A')).toBe('A')
    expect(labelFromEventKey('z')).toBe('Z')
    expect(labelFromEventKey('é')).toBe('É')
    expect(labelFromEventKey('ù')).toBe('Ù')
    expect(labelFromEventKey('ç')).toBe('Ç')
    expect(labelFromEventKey('ñ')).toBe('Ñ')
    expect(labelFromEventKey('ø')).toBe('Ø')
    expect(labelFromEventKey('я')).toBe('Я')
  })

  it('keeps digits and symbols as they are', () => {
    const digitsAndSymbols = "07;',./\\-=[]`<²^¨$€+*"
    for (const key of digitsAndSymbols) expect(labelFromEventKey(key), key).toBe(key)
  })

  it('upper-cases the same way whatever the language of the computer', () => {
    // In Turkish, a locale-aware upper-case would turn "i" into "İ".
    expect(labelFromEventKey('i')).toBe('I')
    expect(labelFromEventKey('I')).toBe('I')
  })

  it('never turns one character into several, or into a different letter', () => {
    expect(labelFromEventKey('ß')).toBe('ß')
    expect(labelFromEventKey('µ')).toBe('µ')
    expect(labelFromEventKey('ı')).toBe('ı')
    expect(labelFromEventKey('İ')).toBe('İ')
    expect(labelFromEventKey('ŉ')).toBe('ŉ')
    for (const key of ['a', 'ß', 'ǆ', 'ﬁ', 'ΐ', 'ÿ']) {
      expect([...(labelFromEventKey(key) ?? '')], key).toHaveLength(1)
    }
  })

  it('rejects named keys', () => {
    const named = ['Dead', 'Shift', 'Enter', 'Control', 'Alt', 'AltGraph', 'Meta', 'Tab', 'Escape']
    const moreNamed = ['Backspace', 'Delete', 'ArrowUp', 'F1', 'F12', 'CapsLock', 'Unidentified']
    for (const key of [...named, ...moreNamed]) expect(labelFromEventKey(key), key).toBeNull()
  })

  it('rejects the space character and other blank or invisible characters', () => {
    const blanks = [
      '',
      ' ',
      '  ',
      '\t',
      '\n',
      '\r',
      '\u00a0', // no-break space
      '\u0000',
      '\u001b', // escape
      '\u007f', // delete
      '\u200b', // zero-width space
      '\u0301', // an accent with no letter under it
    ]
    for (const key of blanks) expect(labelFromEventKey(key), JSON.stringify(key)).toBeNull()
  })

  it('rejects anything longer than one character', () => {
    for (const key of ['ab', 'A ', ' a', '12', 'e\u0301', '^^']) {
      expect(labelFromEventKey(key), key).toBeNull()
    }
  })

  it('returns null instead of throwing for values that are not strings', () => {
    const notStrings: unknown[] = [undefined, null, 5, {}, ['a']]
    for (const value of notStrings) expect(labelFromEventKey(value as string)).toBeNull()
  })
})

describe('keyLabel', () => {
  it('uses the US label when nothing else is known', () => {
    expect(keyLabel('KeyA', null)).toBe('A')
    expect(keyLabel('Semicolon', null)).toBe(';')
    expect(keyLabel('Quote', null, {})).toBe("'")
    expect(keyLabel('Space', null)).toBe('Space')
  })

  it("prefers the character of the user's current keyboard layout, upper-cased", () => {
    expect(keyLabel('KeyA', AZERTY)).toBe('Q')
    expect(keyLabel('KeyW', AZERTY)).toBe('Z')
    expect(keyLabel('Semicolon', AZERTY)).toBe('M')
    expect(keyLabel('Quote', AZERTY)).toBe('Ù')
    expect(keyLabel('KeyM', AZERTY)).toBe(',')
    expect(keyLabel('Digit2', AZERTY)).toBe('É')
  })

  it('puts the current layout before the label captured when the key was bound', () => {
    expect(keyLabel('KeyA', AZERTY, { KeyA: 'X' })).toBe('Q')
  })

  it('uses the captured label for keys the layout does not know', () => {
    expect(keyLabel('KeyS', AZERTY, { KeyS: 'ß' })).toBe('ß')
    expect(keyLabel('KeyS', null, { KeyS: 'ö' })).toBe('Ö')
    expect(keyLabel('KeyS', new Map(), { KeyS: 'Ö' })).toBe('Ö')
    expect(keyLabel('IntlBackslash', null, { IntlBackslash: '<' })).toBe('<')
  })

  it('falls back to the US label when neither knows the key', () => {
    expect(keyLabel('KeyS', AZERTY, { KeyD: 'X' })).toBe('S')
    expect(keyLabel('KeyS', AZERTY)).toBe('S')
  })

  it('skips layout characters that cannot be shown', () => {
    const odd: LayoutMap = new Map([
      ['KeyA', ''],
      ['KeyS', ' '],
      ['KeyD', 'Dead'],
      ['KeyF', '\u0301'],
    ])
    expect(keyLabel('KeyA', odd)).toBe('A')
    expect(keyLabel('KeyS', odd, { KeyS: 'x' })).toBe('X')
    expect(keyLabel('KeyD', odd)).toBe('D')
    expect(keyLabel('KeyF', odd)).toBe('F')
  })

  it('shows a longer captured label as it is, and skips a blank one', () => {
    expect(keyLabel('KeyA', null, { KeyA: 'Alt Gr' })).toBe('Alt Gr')
    expect(keyLabel('KeyA', null, { KeyA: '' })).toBe('A')
    expect(keyLabel('KeyA', null, { KeyA: '  ' })).toBe('A')
    expect(keyLabel('KeyA', null, { KeyA: 5 } as unknown as Record<string, string>)).toBe('A')
  })

  it('always marks number-pad keys with "Num", so they are not taken for the digit row', () => {
    const withNumpad: LayoutMap = new Map([['Numpad1', '1']])
    expect(keyLabel('Numpad1', null, { Numpad1: '1' })).toBe('Num 1')
    expect(keyLabel('Numpad1', withNumpad)).toBe('Num 1')
    expect(keyLabel('NumpadAdd', null, { NumpadAdd: '+' })).toBe('Num +')
    expect(keyLabel('Digit1', null, { Digit1: '&' })).toBe('&')
  })

  it('never reads inherited names as labels', () => {
    expect(keyLabel('constructor', null, {})).toBe('constructor')
    expect(keyLabel('toString', null, {})).toBe('toString')
    expect(keyLabel('__proto__', null, {})).toBe('__proto__')
  })
})

describe('typedKeyLabel', () => {
  it('reads a QWERTY keyboard exactly as defaultKeyLabel does', () => {
    const otherCodes = ['Space', 'Enter', 'F5', 'KeyAA', 'keya', '', '__proto__', 'constructor']
    for (const code of [...ALL_BINDABLE_CODES, ...otherCodes]) {
      expect(typedKeyLabel(code, 'qwerty'), code).toBe(defaultKeyLabel(code))
    }
  })

  it('knows every key of a French keyboard', () => {
    expect(Object.keys(FRENCH_KEYCAPS).sort()).toEqual([...CHARACTER_CODES].sort())
    for (const [code, label] of Object.entries(FRENCH_KEYCAPS)) {
      expect(typedKeyLabel(code, 'azerty'), code).toBe(label)
    }
  })

  it('swaps A with Q and Z with W on a French keyboard, and has M beside L', () => {
    expect(typedKeyLabel('KeyA', 'azerty')).toBe('Q')
    expect(typedKeyLabel('KeyQ', 'azerty')).toBe('A')
    expect(typedKeyLabel('KeyZ', 'azerty')).toBe('W')
    expect(typedKeyLabel('KeyW', 'azerty')).toBe('Z')
    expect(typedKeyLabel('Semicolon', 'azerty')).toBe('M')
    expect(typedKeyLabel('KeyM', 'azerty')).toBe(',')
  })

  it('reads the rows of letters of a French keyboard as they are printed', () => {
    const topRow = ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyY', 'KeyU', 'KeyI', 'KeyO', 'KeyP']
    const homeRow = ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK', 'KeyL']
    const bottomRow = ['KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyN', 'KeyM']
    expect(typedLabels(topRow, 'azerty')).toBe('A Z E R T Y U I O P')
    expect(typedLabels([...homeRow, 'Semicolon'], 'azerty')).toBe('Q S D F G H J K L M')
    expect(typedLabels(bottomRow, 'azerty')).toBe('W X C V B N ,')
  })

  it('shows what the French row of digits types without Shift: accents and punctuation', () => {
    const row = ['Backquote', ...DIGIT_ROW_CODES, 'Minus', 'Equal']
    expect(typedLabels(row, 'azerty')).toBe(`² & É " ' ( - È _ Ç À ) =`)
  })

  it('shows the French punctuation keys', () => {
    expect(typedKeyLabel('BracketLeft', 'azerty')).toBe('^')
    expect(typedKeyLabel('BracketRight', 'azerty')).toBe('$')
    expect(typedKeyLabel('Quote', 'azerty')).toBe('Ù')
    expect(typedKeyLabel('Backslash', 'azerty')).toBe('*')
    expect(typedKeyLabel('IntlBackslash', 'azerty')).toBe('<')
    expect(typedKeyLabel('Comma', 'azerty')).toBe(';')
    expect(typedKeyLabel('Period', 'azerty')).toBe(':')
    expect(typedKeyLabel('Slash', 'azerty')).toBe('!')
  })

  it('knows every key of a German keyboard', () => {
    expect(Object.keys(GERMAN_KEYCAPS).sort()).toEqual([...CHARACTER_CODES].sort())
    for (const [code, label] of Object.entries(GERMAN_KEYCAPS)) {
      expect(typedKeyLabel(code, 'qwertz'), code).toBe(label)
    }
  })

  it('swaps Y and Z on a German keyboard and leaves the other letters and the digits alone', () => {
    expect(typedKeyLabel('KeyY', 'qwertz')).toBe('Z')
    expect(typedKeyLabel('KeyZ', 'qwertz')).toBe('Y')
    const sameAsQwerty = [...LETTER_CODES, ...DIGIT_ROW_CODES].filter(
      (code) => code !== 'KeyY' && code !== 'KeyZ',
    )
    for (const code of sameAsQwerty) {
      expect(typedKeyLabel(code, 'qwertz'), code).toBe(defaultKeyLabel(code))
    }
  })

  it('has Ö, Ä, Ü and ß on their German keys, in capitals where a capital exists', () => {
    expect(typedKeyLabel('Semicolon', 'qwertz')).toBe('Ö')
    expect(typedKeyLabel('Quote', 'qwertz')).toBe('Ä')
    expect(typedKeyLabel('BracketLeft', 'qwertz')).toBe('Ü')
    expect(typedKeyLabel('Minus', 'qwertz')).toBe('ß')
  })

  it('shows the German punctuation keys', () => {
    expect(typedKeyLabel('Backquote', 'qwertz')).toBe('^')
    expect(typedKeyLabel('Equal', 'qwertz')).toBe('´')
    expect(typedKeyLabel('BracketRight', 'qwertz')).toBe('+')
    expect(typedKeyLabel('Backslash', 'qwertz')).toBe('#')
    expect(typedKeyLabel('IntlBackslash', 'qwertz')).toBe('<')
    expect(typedKeyLabel('Comma', 'qwertz')).toBe(',')
    expect(typedKeyLabel('Period', 'qwertz')).toBe('.')
    expect(typedKeyLabel('Slash', 'qwertz')).toBe('-')
  })

  it.each(NAMED_TYPES)('prints each letter from A to Z on exactly one key (%s)', (type) => {
    const labels = CHARACTER_CODES.map((code) => typedKeyLabel(code, type))
    const letters = labels.filter((label) => /^[A-Z]$/.test(label)).sort()
    expect(letters.join('')).toBe('ABCDEFGHIJKLMNOPQRSTUVWXYZ')
  })

  it.each(['azerty', 'qwertz'] as const)(
    'gives every key one character that no other key has (%s)',
    (type) => {
      const labels = CHARACTER_CODES.map((code) => typedKeyLabel(code, type))
      for (const label of labels) expect([...label], label).toHaveLength(1)
      expect(new Set(labels).size).toBe(CHARACTER_CODES.length)
    },
  )

  it('reads the default keys of the piano on each keyboard type', () => {
    const defaultKeys = Object.keys(DEFAULT_BINDINGS)
    expect(typedLabels(defaultKeys, 'qwerty')).toBe("A W S E D F T G Y H U J K O L P ; '")
    expect(typedLabels(defaultKeys, 'azerty')).toBe('Q Z S E D F T G Y H U J K O L P M Ù')
    expect(typedLabels(defaultKeys, 'qwertz')).toBe('A W S E D F T G Z H U J K O L P Ö Ä')
  })

  it('reads the number pad the same on every keyboard type', () => {
    for (const type of NAMED_TYPES) {
      for (const code of NUMPAD_CODES) {
        expect(typedKeyLabel(code, type), code).toBe(defaultKeyLabel(code))
      }
    }
    expect(typedKeyLabel('Numpad1', 'azerty')).toBe('Num 1')
    expect(typedKeyLabel('NumpadAdd', 'qwertz')).toBe('Num +')
  })

  it('keeps the usual label for a key that keyboard type does not have', () => {
    for (const type of NAMED_TYPES) {
      expect(typedKeyLabel('IntlRo', type)).toBe('ろ')
      expect(typedKeyLabel('IntlYen', type)).toBe('¥')
      for (const code of ['Space', 'Enter', 'KeyAA', '', '__proto__', 'constructor']) {
        expect(typedKeyLabel(code, type), code).toBe(code)
      }
    }
  })

  it('reads a keyboard type it has never heard of as QWERTY', () => {
    const unknownTypes: unknown[] = ['dvorak', 'auto', 'constructor', '', null, undefined, 7]
    for (const type of unknownTypes) {
      expect(typedKeyLabel('KeyA', type as 'qwerty')).toBe('A')
      expect(typedKeyLabel('Semicolon', type as 'qwerty')).toBe(';')
    }
  })
})

describe('keyLabel with a keyboard type', () => {
  const customLabels = { KeyA: 'X', KeyS: 'ß', IntlBackslash: '>', IntlRo: '_', Numpad1: '1' }

  it("behaves exactly as before when the type is 'auto' or left out", () => {
    const layoutMaps = [null, AZERTY, new Map<string, string>(), asLayoutMap(GERMAN_KEYCAPS)]
    const codes = [...ALL_BINDABLE_CODES, 'Space', '', 'constructor', '__proto__']
    for (const code of codes) {
      for (const layoutMap of layoutMaps) {
        for (const labels of [undefined, {}, customLabels]) {
          const before = keyLabel(code, layoutMap, labels)
          expect(keyLabel(code, layoutMap, labels, 'auto'), code).toBe(before)
          expect(keyLabel(code, layoutMap, labels, undefined), code).toBe(before)
        }
      }
    }
  })

  it('puts a chosen keyboard type before the browser layout and the captured label', () => {
    expect(keyLabel('KeyA', AZERTY, customLabels, 'qwerty')).toBe('A')
    expect(keyLabel('KeyA', asLayoutMap(GERMAN_KEYCAPS), customLabels, 'azerty')).toBe('Q')
    expect(keyLabel('KeyY', AZERTY, { KeyY: 'X' }, 'qwertz')).toBe('Z')
    expect(keyLabel('Semicolon', AZERTY, undefined, 'qwerty')).toBe(';')
    expect(keyLabel('Semicolon', null, { Semicolon: 'ñ' }, 'azerty')).toBe('M')
    expect(keyLabel('IntlBackslash', null, customLabels, 'qwertz')).toBe('<')
  })

  it('shows on every key what that type prints there, whatever else is known', () => {
    for (const type of NAMED_TYPES) {
      for (const code of CHARACTER_CODES) {
        expect(keyLabel(code, AZERTY, customLabels, type), code).toBe(typedKeyLabel(code, type))
      }
    }
  })

  it('shows with AZERTY what Auto shows on a French keyboard', () => {
    const french = asLayoutMap(FRENCH_KEYCAPS)
    for (const code of ALL_BINDABLE_CODES) {
      expect(keyLabel(code, null, undefined, 'azerty'), code).toBe(keyLabel(code, french))
    }
  })

  it('shows with QWERTZ what Auto shows on a German keyboard', () => {
    const german = asLayoutMap(GERMAN_KEYCAPS)
    for (const code of ALL_BINDABLE_CODES) {
      expect(keyLabel(code, null, undefined, 'qwertz'), code).toBe(keyLabel(code, german))
    }
  })

  it('falls back to the browser layout, then the captured label, then the US label', () => {
    const japanese: LayoutMap = new Map([
      ['IntlRo', '\\'],
      ['IntlYen', '¥'],
    ])
    for (const type of NAMED_TYPES) {
      expect(keyLabel('IntlRo', japanese, customLabels, type)).toBe('\\')
      expect(keyLabel('IntlRo', null, customLabels, type)).toBe('_')
      expect(keyLabel('IntlRo', AZERTY, undefined, type)).toBe('ろ')
      expect(keyLabel('Space', AZERTY, customLabels, type)).toBe('Space')
    }
  })

  it('always marks number-pad keys with "Num"', () => {
    const withNumpad: LayoutMap = new Map([['Numpad1', '1']])
    for (const type of ['auto', ...NAMED_TYPES] as const) {
      expect(keyLabel('Numpad1', withNumpad, customLabels, type)).toBe('Num 1')
      expect(keyLabel('NumpadAdd', null, undefined, type)).toBe('Num +')
    }
  })

  it('treats a keyboard type it has never heard of as Auto', () => {
    const unknownTypes: unknown[] = ['dvorak', 'constructor', '__proto__', '', null, 7]
    for (const type of unknownTypes) {
      expect(keyLabel('KeyA', AZERTY, customLabels, type as KeyboardType)).toBe('Q')
      expect(keyLabel('KeyS', null, customLabels, type as KeyboardType)).toBe('ß')
      expect(keyLabel('KeyD', null, undefined, type as KeyboardType)).toBe('D')
    }
  })

  it('never reads inherited names as labels', () => {
    for (const type of NAMED_TYPES) {
      expect(keyLabel('constructor', null, {}, type)).toBe('constructor')
      expect(keyLabel('toString', null, {}, type)).toBe('toString')
      expect(keyLabel('__proto__', null, {}, type)).toBe('__proto__')
    }
  })
})

describe('loadLayoutMap', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('resolves to null when there is no navigator at all', async () => {
    vi.stubGlobal('navigator', undefined)
    await expect(loadLayoutMap()).resolves.toBeNull()
  })

  it('resolves to null when the browser has no keyboard map', async () => {
    vi.stubGlobal('navigator', {})
    await expect(loadLayoutMap()).resolves.toBeNull()

    vi.stubGlobal('navigator', { keyboard: null })
    await expect(loadLayoutMap()).resolves.toBeNull()

    vi.stubGlobal('navigator', { keyboard: {} })
    await expect(loadLayoutMap()).resolves.toBeNull()
  })

  it('returns the layout map of the browser', async () => {
    const getLayoutMap = vi.fn(() => Promise.resolve(AZERTY))
    vi.stubGlobal('navigator', { keyboard: { getLayoutMap } })

    await expect(loadLayoutMap()).resolves.toBe(AZERTY)
    expect(getLayoutMap).toHaveBeenCalledTimes(1)
  })

  it('calls getLayoutMap as a method of navigator.keyboard', async () => {
    const keyboard = {
      layout: AZERTY,
      getLayoutMap(): Promise<LayoutMap> {
        return Promise.resolve(this.layout)
      },
    }
    vi.stubGlobal('navigator', { keyboard })
    await expect(loadLayoutMap()).resolves.toBe(AZERTY)
  })

  it('resolves to null when getLayoutMap throws', async () => {
    const getLayoutMap = (): never => {
      throw new Error('blocked by permissions policy')
    }
    vi.stubGlobal('navigator', { keyboard: { getLayoutMap } })
    await expect(loadLayoutMap()).resolves.toBeNull()
  })

  it('resolves to null when getLayoutMap rejects', async () => {
    const getLayoutMap = (): Promise<never> => Promise.reject(new Error('not allowed here'))
    vi.stubGlobal('navigator', { keyboard: { getLayoutMap } })
    await expect(loadLayoutMap()).resolves.toBeNull()
  })

  it('resolves to null when reading navigator.keyboard itself throws', async () => {
    const hostile = {
      get keyboard(): never {
        throw new Error('no access')
      },
    }
    vi.stubGlobal('navigator', hostile)
    await expect(loadLayoutMap()).resolves.toBeNull()
  })

  it('resolves to null when the browser answers with something that is not a map', async () => {
    for (const answer of [undefined, null, 'qwerty', 12, {}]) {
      vi.stubGlobal('navigator', { keyboard: { getLayoutMap: () => Promise.resolve(answer) } })
      await expect(loadLayoutMap()).resolves.toBeNull()
    }
  })
})

describe('useLayoutMap', () => {
  it('is null until the layout has loaded', () => {
    const seen: (LayoutMap | null)[] = []
    function Probe(): null {
      seen.push(useLayoutMap())
      return null
    }
    renderToString(createElement(Probe))
    expect(seen).toEqual([null])
  })
})
