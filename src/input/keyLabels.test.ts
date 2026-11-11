import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  defaultKeyLabel,
  keyLabel,
  labelFromEventKey,
  loadLayoutMap,
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
    const symbolCodes = ['Minus', 'Equal', 'BracketLeft', 'BracketRight', 'Backslash', 'Semicolon']
    const moreCodes = ['Quote', 'Backquote', 'Comma', 'Period', 'Slash', 'IntlBackslash', 'IntlRo']
    const numpadCodes = ['Decimal', 'Add', 'Subtract', 'Multiply', 'Divide'].map(
      (name) => `Numpad${name}`,
    )
    const codes = [
      ...[...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].map((letter) => `Key${letter}`),
      ...[...'0123456789'].flatMap((digit) => [`Digit${digit}`, `Numpad${digit}`]),
      ...symbolCodes,
      ...moreCodes,
      'IntlYen',
      ...numpadCodes,
    ]
    expect(codes).toHaveLength(65)
    for (const code of codes) {
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
