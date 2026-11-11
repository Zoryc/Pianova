/**
 * The ready-made key layouts seen through the letters drawn on the piano:
 * whatever keyboard the player has, every key of a layout carries a letter of
 * its own, a layout never needs Shift or a second key, and the letters a
 * browser reports are used with care (odd values never reach the piano).
 */
import { describe, expect, it } from 'vitest'
import { SLOT_COUNT, slotToMidi } from '../core/layout'
import { isBlackKey } from '../core/notes'
import type { KeyboardType } from '../core/types'
import { defaultKeyLabel, keyLabel, labelFromEventKey, typedKeyLabel } from './keyLabels'
import type { LayoutMap } from './keyLabels'
import { KEY_PRESETS, isBindableCode, matchingPreset, sanitizeBindings } from './keymap'

const TYPES: readonly KeyboardType[] = ['auto', 'qwerty', 'azerty', 'qwertz']

/** The rows of character keys, as physical positions, top to bottom and left to right. */
const ROWS: readonly (readonly string[])[] = [
  'Backquote Digit1 Digit2 Digit3 Digit4 Digit5 Digit6 Digit7 Digit8 Digit9 Digit0 Minus Equal',
  'KeyQ KeyW KeyE KeyR KeyT KeyY KeyU KeyI KeyO KeyP BracketLeft BracketRight',
  'KeyA KeyS KeyD KeyF KeyG KeyH KeyJ KeyK KeyL Semicolon Quote Backslash',
  'KeyZ KeyX KeyC KeyV KeyB KeyN KeyM Comma Period Slash',
].map((row) => row.split(' '))

function positionOf(code: string): { row: number; column: number } {
  for (const [row, codes] of ROWS.entries()) {
    const column = codes.indexOf(code)
    if (column !== -1) return { row, column }
  }
  throw new Error(`${code} is not one of the character keys`)
}

describe.each(KEY_PRESETS)('the "$name" layout', ({ bindings }) => {
  const entries = Object.entries(bindings)

  it.each(TYPES)('draws a different letter on every one of its keys on a %s keyboard', (type) => {
    const labels = entries.map(([code]) => keyLabel(code, null, {}, type))
    expect(new Set(labels).size).toBe(labels.length)
    for (const label of labels) {
      expect(label.trim()).not.toBe('')
      // One character: it fits the narrow keys of a full piano.
      expect([...label]).toHaveLength(1)
    }
  })

  it('uses only keys that type a character on their own: no Shift, no key pressed with another', () => {
    for (const [code] of entries) {
      expect(isBindableCode(code), code).toBe(true)
      expect(code, code).not.toMatch(/Shift|Control|Alt|Meta|Space|Enter|Tab|Numpad/)
      // On the main block of the keyboard, where every keyboard has a key.
      expect(() => positionOf(code), code).not.toThrow()
    }
  })

  it('gives each key one note and each note one key, all of them on the 37 notes of the zone', () => {
    const slots = entries.map(([, slot]) => slot)
    expect(new Set(slots).size).toBe(slots.length)
    for (const slot of slots) {
      expect(Number.isInteger(slot)).toBe(true)
      expect(slot).toBeGreaterThanOrEqual(0)
      expect(slot).toBeLessThan(SLOT_COUNT)
    }
  })

  it('goes up the piano from left to right along every row of the keyboard', () => {
    for (const codes of ROWS) {
      const slots = codes
        .filter((code) => Object.hasOwn(bindings, code))
        .map((code) => bindings[code] ?? -1)
      expect(slots).toEqual([...slots].sort((a, b) => a - b))
    }
  })

  it('keeps each row to one colour of piano key: a row of white keys, or the black keys above it', () => {
    for (const codes of ROWS) {
      const colours = new Set(
        codes
          .filter((code) => Object.hasOwn(bindings, code))
          .map((code) => isBlackKey(slotToMidi(bindings[code] ?? 0, 3))),
      )
      expect(colours.size).toBeLessThanOrEqual(1)
    }
  })

  it('is found again after the settings were saved and loaded', () => {
    const reloaded = sanitizeBindings(JSON.parse(JSON.stringify(bindings)))
    expect(reloaded).not.toBeNull()
    expect(matchingPreset(reloaded ?? {})).toBe(matchingPreset(bindings))
    expect(matchingPreset(bindings)).not.toBeNull()
  })
})

describe('the letters of a keyboard type', () => {
  it('are the same letters on every keyboard, moved to other keys: A to Z, each once', () => {
    const letters = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ']
    const codes = ROWS.flat()
    for (const type of ['qwerty', 'azerty', 'qwertz'] as const) {
      const drawn = codes.map((code) => typedKeyLabel(code, type))
      for (const letter of letters) {
        expect(drawn.filter((label) => label === letter), `${letter} on ${type}`).toHaveLength(1)
      }
    }
  })

  it('swap exactly the keys the spec names', () => {
    // French: A and Q swapped, Z and W swapped, M on the key right of L.
    expect(typedKeyLabel('KeyA', 'azerty')).toBe('Q')
    expect(typedKeyLabel('KeyQ', 'azerty')).toBe('A')
    expect(typedKeyLabel('KeyZ', 'azerty')).toBe('W')
    expect(typedKeyLabel('KeyW', 'azerty')).toBe('Z')
    expect(typedKeyLabel('Semicolon', 'azerty')).toBe('M')
    // German: Y and Z swapped, Ö Ä Ü ß on their keys.
    expect(typedKeyLabel('KeyY', 'qwertz')).toBe('Z')
    expect(typedKeyLabel('KeyZ', 'qwertz')).toBe('Y')
    expect(typedKeyLabel('Semicolon', 'qwertz')).toBe('Ö')
    expect(typedKeyLabel('Quote', 'qwertz')).toBe('Ä')
    expect(typedKeyLabel('BracketLeft', 'qwertz')).toBe('Ü')
    expect(typedKeyLabel('Minus', 'qwertz')).toBe('ß')

    // Every other letter key is where a US keyboard has it.
    const moved: Record<string, readonly string[]> = {
      azerty: ['KeyA', 'KeyQ', 'KeyZ', 'KeyW', 'KeyM'],
      qwertz: ['KeyY', 'KeyZ'],
    }
    for (const type of ['azerty', 'qwertz'] as const) {
      for (const letter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
        const code = `Key${letter}`
        if (moved[type]?.includes(code)) continue
        expect(typedKeyLabel(code, type), `${code} on ${type}`).toBe(letter)
      }
    }
  })

  it('leave the number pad alone: "Num 1" on every keyboard, whatever the browser or the player says', () => {
    const french: LayoutMap = new Map([['Numpad1', '1']])
    for (const type of TYPES) {
      for (let digit = 0; digit <= 9; digit++) {
        const code = `Numpad${digit}`
        expect(keyLabel(code, french, { [code]: 'X' }, type)).toBe(`Num ${digit}`)
      }
      expect(keyLabel('NumpadAdd', french, {}, type)).toBe('Num +')
    }
  })
})

describe('what the browser reports for a key', () => {
  it.each([
    ['nothing', ''],
    ['a space', ' '],
    ['an accent that waits for its letter', '́'],
    ['two characters', 'ab'],
    ['the name of a key', 'Dead'],
    ['a line break', '\n'],
  ])('is not drawn when it is %s: the saved letter, then the US one, is', (_what, reported) => {
    const layoutMap: LayoutMap = new Map([['KeyQ', reported]])
    expect(keyLabel('KeyQ', layoutMap)).toBe('Q')
    expect(keyLabel('KeyQ', layoutMap, { KeyQ: 'a' })).toBe('A')
    expect(labelFromEventKey(reported)).toBeNull()
  })

  it.each([
    ['é', 'É'],
    ['ù', 'Ù'],
    ['ç', 'Ç'],
    ['ß', 'ß'],
    ['µ', 'µ'],
    ['²', '²'],
    ['^', '^'],
    ['´', '´'],
    ['ö', 'Ö'],
    ['ñ', 'Ñ'],
    ['я', 'Я'],
    ['ろ', 'ろ'],
    ['𝄞', '𝄞'],
  ])('is drawn as one keycap character: %s reads %s', (reported, drawn) => {
    const layoutMap: LayoutMap = new Map([['KeyQ', reported]])
    expect(keyLabel('KeyQ', layoutMap)).toBe(drawn)
    expect([...keyLabel('KeyQ', layoutMap)]).toHaveLength(1)
    expect(labelFromEventKey(reported)).toBe(drawn)
  })

  it('never turns one key into a label of several letters, whatever its capital is', () => {
    // Characters whose capital is spelled with more than one letter.
    for (const character of ['ß', 'ŉ', 'ǰ', 'ΐ', 'ﬁ', 'ﬀ']) {
      const label = labelFromEventKey(character)
      expect(label === null || [...label].length === 1, character).toBe(true)
    }
  })

  it('is used key by key: a key it does not know keeps the letter of a US keyboard', () => {
    const partial: LayoutMap = new Map([['KeyA', 'q']])
    expect(keyLabel('KeyA', partial)).toBe('Q')
    expect(keyLabel('KeyS', partial)).toBe(defaultKeyLabel('KeyS'))
    expect(keyLabel('Quote', partial)).toBe("'")
  })
})
