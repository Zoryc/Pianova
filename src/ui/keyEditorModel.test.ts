import { describe, expect, it } from 'vitest'
import { DEFAULT_BINDINGS } from '../input/keymap'
import { DEFAULT_SETTINGS } from '../state/settings'
import type { Settings } from '../state/settings'
import {
  EDITOR_CLOSED,
  EDITOR_OPEN,
  KEY_SETTINGS,
  UNUSABLE_KEY_MESSAGE,
  isFunctionKey,
  labelModeWhileEditing,
  pressKey,
  selectSlot,
  slotNoteName,
} from './keyEditorModel'
import type { KeyEditorState, KeyPress } from './keyEditorModel'

/** Slots of the default piano position (C3..C6): middle C and the notes around it. */
const C4 = 12
const D4 = 14
const G4 = 19
const C5 = 24
const C6 = 36

function press(code: string, key: string, repeat = false): KeyPress {
  return { code, key, repeat }
}

function settingsWith(changes: Partial<Settings>): Settings {
  return { ...DEFAULT_SETTINGS, ...changes }
}

/** Presses a key with the default settings and no keyboard layout information. */
function pressWithDefaults(state: KeyEditorState, keyPress: KeyPress) {
  return pressKey(state, keyPress, DEFAULT_SETTINGS, null)
}

describe('isFunctionKey', () => {
  it('recognises the function keys only', () => {
    expect(isFunctionKey('F1')).toBe(true)
    expect(isFunctionKey('F5')).toBe(true)
    expect(isFunctionKey('F12')).toBe(true)
    expect(isFunctionKey('F24')).toBe(true)
    expect(isFunctionKey('KeyF')).toBe(false)
    expect(isFunctionKey('Digit5')).toBe(false)
    expect(isFunctionKey('F')).toBe(false)
    expect(isFunctionKey('')).toBe(false)
  })
})

describe('slotNoteName', () => {
  it('names the note a piano key plays at the current position', () => {
    expect(slotNoteName(DEFAULT_SETTINGS, C4)).toBe('C4')
    expect(slotNoteName(DEFAULT_SETTINGS, 13)).toBe('C♯4')
    expect(slotNoteName(settingsWith({ baseOctave: 4 }), C4)).toBe('C5')
  })

  it('follows the note naming the user chose', () => {
    expect(slotNoteName(settingsWith({ noteNaming: 'solfege' }), C4)).toBe('Do4')
    expect(slotNoteName(settingsWith({ noteNaming: 'solfege' }), G4)).toBe('Sol4')
  })
})

describe('labelModeWhileEditing', () => {
  it('adds the computer keys to a choice of labels that leaves them out', () => {
    expect(labelModeWhileEditing('none')).toBe('keys')
    expect(labelModeWhileEditing('notes')).toBe('both')
  })

  it('keeps a choice that already shows the computer keys', () => {
    expect(labelModeWhileEditing('keys')).toBe('keys')
    expect(labelModeWhileEditing('both')).toBe('both')
  })
})

describe('selectSlot', () => {
  it('makes the piano key wait for a computer key and clears the last message', () => {
    expect(selectSlot(C4)).toEqual({ editing: true, selectedSlot: C4, message: null })
  })
})

describe('pressKey outside "Customize keys"', () => {
  it('leaves every key to the piano', () => {
    for (const keyPress of [press('KeyA', 'a'), press('Escape', 'Escape'), press('Space', ' ')]) {
      const result = pressWithDefaults(EDITOR_CLOSED, keyPress)
      expect(result).toEqual({ consumed: false, state: EDITOR_CLOSED, changes: null })
      expect(result.state).toBe(EDITOR_CLOSED)
    }
  })
})

describe('pressKey with no piano key selected', () => {
  it('lets the keyboard play as usual', () => {
    for (const keyPress of [press('KeyA', 'a'), press('Space', ' '), press('Backspace', 'x')]) {
      const result = pressWithDefaults(EDITOR_OPEN, keyPress)
      expect(result.consumed).toBe(false)
      expect(result.state).toBe(EDITOR_OPEN)
      expect(result.changes).toBeNull()
    }
  })

  it('keeps the last message while the user tries the keys', () => {
    const state: KeyEditorState = { ...EDITOR_OPEN, message: '"K" now plays C4.' }
    expect(pressWithDefaults(state, press('KeyK', 'k')).state).toBe(state)
  })

  it('closes the editor on Escape', () => {
    const result = pressWithDefaults(EDITOR_OPEN, press('Escape', 'Escape'))
    expect(result).toEqual({ consumed: true, state: EDITOR_CLOSED, changes: null })
  })

  it('does not close on the repeats of an Escape that is still held', () => {
    const result = pressWithDefaults(EDITOR_OPEN, press('Escape', 'Escape', true))
    expect(result.consumed).toBe(true)
    expect(result.state).toBe(EDITOR_OPEN)
  })
})

describe('pressKey with a piano key selected', () => {
  it('gives a free computer key to the note', () => {
    const result = pressWithDefaults(selectSlot(C6), press('KeyZ', 'z'))
    expect(result.consumed).toBe(true)
    expect(result.state).toEqual({
      editing: true,
      selectedSlot: null,
      message: '"Z" now plays C6.',
    })
    expect(result.changes).toEqual({
      bindings: { ...DEFAULT_BINDINGS, KeyZ: C6 },
      customLabels: { KeyZ: 'Z' },
    })
  })

  it('says which key lost its note when the note already had one', () => {
    // C4 is played by A; Z is free.
    const result = pressWithDefaults(selectSlot(C4), press('KeyZ', 'z'))
    expect(result.state.message).toBe('"Z" now plays C4. "A" no longer plays a note.')
    expect(result.changes?.bindings).not.toHaveProperty('KeyA')
    expect(result.changes?.bindings.KeyZ).toBe(C4)
  })

  it('says which note lost its key when the key already played another note', () => {
    // K plays C5; C6 has no key.
    const result = pressWithDefaults(selectSlot(C6), press('KeyK', 'k'))
    expect(result.state.message).toBe('"K" now plays C6. C5 has no key now.')
    expect(result.changes?.bindings.KeyK).toBe(C6)
    expect(Object.values(result.changes?.bindings ?? {})).not.toContain(C5)
  })

  it('says both when a key is moved onto a note that had another key', () => {
    // K plays C5 and A plays C4.
    const result = pressWithDefaults(selectSlot(C4), press('KeyK', 'k'))
    expect(result.state.message).toBe(
      '"K" now plays C4. "A" no longer plays a note. C5 has no key now.',
    )
    expect(result.changes?.bindings).not.toHaveProperty('KeyA')
    expect(result.changes?.bindings.KeyK).toBe(C4)
    expect(Object.values(result.changes?.bindings ?? {})).not.toContain(C5)
  })

  it('keeps the keys as they are when the key already plays that note', () => {
    const result = pressWithDefaults(selectSlot(C4), press('KeyA', 'a'))
    expect(result.state).toEqual({ ...EDITOR_OPEN, message: '"A" now plays C4.' })
    expect(result.changes?.bindings).toBe(DEFAULT_BINDINGS)
  })

  it('writes note names the way the user chose', () => {
    const settings = settingsWith({ noteNaming: 'solfege', baseOctave: 2 })
    const result = pressKey(selectSlot(C4), press('KeyK', 'k'), settings, null)
    expect(result.state.message).toBe(
      '"K" now plays Do3. "A" no longer plays a note. Do4 has no key now.',
    )
  })

  it('labels keys with the character printed on the user keyboard', () => {
    // On a French keyboard the key at the "A" position types Q, and the one at "Q" types A.
    const layoutMap = new Map([
      ['KeyA', 'q'],
      ['KeyQ', 'a'],
    ])
    const result = pressKey(selectSlot(C4), press('KeyQ', 'a'), DEFAULT_SETTINGS, layoutMap)
    expect(result.state.message).toBe('"A" now plays C4. "Q" no longer plays a note.')
  })

  it('names keys as the keyboard type the player chose prints them, as the piano does', () => {
    // The player said "AZERTY" while typing on something else: the piano draws
    // French letters on its keys, and the sentence has to name the same ones.
    const settings = settingsWith({ keyboardType: 'azerty' })
    const usLayout = new Map([
      ['KeyA', 'a'],
      ['KeyQ', 'q'],
    ])
    const result = pressKey(selectSlot(C4), press('KeyQ', 'q'), settings, usLayout)
    expect(result.state.message).toBe('"A" now plays C4. "Q" no longer plays a note.')
    // What the key really typed is still remembered, for when the type goes back to Auto.
    expect(result.changes?.customLabels).toEqual({ KeyQ: 'Q' })
  })

  it('remembers the character the key typed, for browsers with no layout information', () => {
    const result = pressWithDefaults(selectSlot(C6), press('Semicolon', 'm'))
    expect(result.changes?.customLabels).toEqual({ Semicolon: 'M' })
    expect(result.state.message).toBe('"M" now plays C6. E5 has no key now.')
  })

  it('forgets an older label when the key types no character of its own', () => {
    const settings = settingsWith({ customLabels: { BracketLeft: 'Ü', KeyZ: 'Y' } })
    const result = pressKey(selectSlot(C6), press('BracketLeft', 'Dead'), settings, null)
    expect(result.changes?.customLabels).toEqual({ KeyZ: 'Y' })
    expect(result.state.message).toBe('"[" now plays C6.')
  })

  it('always calls number-pad keys "Num"', () => {
    const result = pressWithDefaults(selectSlot(C6), press('Numpad1', '1'))
    expect(result.state.message).toBe('"Num 1" now plays C6.')
  })

  it('removes the key of the note on Backspace and on Delete', () => {
    for (const code of ['Backspace', 'Delete']) {
      const result = pressWithDefaults(selectSlot(C4), press(code, code))
      expect(result.consumed).toBe(true)
      expect(result.state).toEqual({ ...EDITOR_OPEN, message: 'C4 has no key now.' })
      expect(result.changes?.bindings).not.toHaveProperty('KeyA')
      expect(result.changes?.customLabels).toBe(DEFAULT_SETTINGS.customLabels)
    }
  })

  it('says the same when the note had no key to remove', () => {
    const result = pressWithDefaults(selectSlot(C6), press('Backspace', 'Backspace'))
    expect(result.state.message).toBe('C6 has no key now.')
    expect(result.changes?.bindings).toBe(DEFAULT_BINDINGS)
  })

  it('cancels on Escape and stays in the editor', () => {
    const selected: KeyEditorState = { ...selectSlot(D4), message: UNUSABLE_KEY_MESSAGE }
    const result = pressWithDefaults(selected, press('Escape', 'Escape'))
    expect(result).toEqual({ consumed: true, state: EDITOR_OPEN, changes: null })
  })

  it('refuses keys that cannot play a note and keeps waiting', () => {
    const selected = selectSlot(D4)
    const refused = ['Space', 'Enter', 'Tab', 'ArrowLeft', 'ShiftLeft', 'CapsLock', 'Home']
    for (const code of refused) {
      const result = pressWithDefaults(selected, press(code, code))
      expect(result.consumed).toBe(true)
      expect(result.state).toEqual({ ...selected, message: UNUSABLE_KEY_MESSAGE })
      expect(result.changes).toBeNull()
    }
  })

  it('refuses function keys too, but leaves them to the browser', () => {
    const selected = selectSlot(D4)
    const result = pressWithDefaults(selected, press('F5', 'F5'))
    expect(result.consumed).toBe(false)
    expect(result.state).toEqual({ ...selected, message: UNUSABLE_KEY_MESSAGE })
    expect(result.changes).toBeNull()
  })

  it('ignores the repeats of a key that was already held', () => {
    const selected = selectSlot(D4)
    for (const code of ['KeyK', 'Backspace', 'Escape', 'Space']) {
      const result = pressWithDefaults(selected, press(code, code, true))
      expect(result.consumed).toBe(true)
      expect(result.state).toBe(selected)
      expect(result.changes).toBeNull()
    }
  })

  it('never changes the settings it was given', () => {
    const before = JSON.stringify(DEFAULT_SETTINGS)
    pressWithDefaults(selectSlot(C4), press('KeyK', 'k'))
    pressWithDefaults(selectSlot(C4), press('Backspace', 'Backspace'))
    expect(JSON.stringify(DEFAULT_SETTINGS)).toBe(before)
  })
})

describe('the wording', () => {
  it('is the one the user sees in the app', () => {
    expect(UNUSABLE_KEY_MESSAGE).toBe("That key can't be used. Try a letter, number or symbol key.")
  })

  it('resets exactly the settings a key change saves', () => {
    const result = pressWithDefaults(selectSlot(C6), press('KeyZ', 'z'))
    expect(Object.keys(result.changes ?? {}).sort()).toEqual([...KEY_SETTINGS].sort())
  })
})
