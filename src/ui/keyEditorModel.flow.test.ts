/**
 * The rules of "Customize keys" under odd input: key presses with no code or
 * no character, dead keys, held keys, and long random sessions. Whatever is
 * pressed, the editor must not throw, must keep one key per note, and must
 * only produce settings that survive being saved and loaded.
 */
import { describe, expect, it } from 'vitest'
import { SLOT_COUNT } from '../core/layout'
import { DEFAULT_BINDINGS } from '../input/keymap'
import { DEFAULT_SETTINGS, sanitizeSettings } from '../state/settings'
import type { Settings } from '../state/settings'
import {
  EDITOR_CLOSED,
  EDITOR_OPEN,
  UNUSABLE_KEY_MESSAGE,
  pressKey,
  selectSlot,
} from './keyEditorModel'
import type { KeyEditorState, KeyPress } from './keyEditorModel'

function press(code: string, key = '', repeat = false): KeyPress {
  return { code, key, repeat }
}

/** What the settings store does with a change: merge it, then clean the result. */
function save(settings: Settings, changes: Partial<Settings> | null): Settings {
  return changes ? sanitizeSettings({ ...settings, ...changes }) : settings
}

describe('key presses with no code or no character', () => {
  const waiting = selectSlot(12)

  it('refuses a press with an empty code and keeps waiting', () => {
    const result = pressKey(waiting, press('', 'a'), DEFAULT_SETTINGS, null)

    expect(result.changes).toBeNull()
    expect(result.state).toEqual({ ...waiting, message: UNUSABLE_KEY_MESSAGE })
    expect(result.consumed).toBe(true)
  })

  it('leaves a press with an empty code to the piano when no piano key is waiting', () => {
    expect(pressKey(EDITOR_OPEN, press('', 'a'), DEFAULT_SETTINGS, null)).toEqual({
      consumed: false,
      state: EDITOR_OPEN,
      changes: null,
    })
    expect(pressKey(EDITOR_CLOSED, press(''), DEFAULT_SETTINGS, null).consumed).toBe(false)
  })

  /*
   * The app hands the editor the "keydown" events the page receives, and not
   * all of them are real key presses: a script or a browser extension can
   * send a bare event with none of these fields. The types rule that out, so
   * nothing is promised about it beyond this: it does not throw and changes
   * no key.
   */
  it('does not throw when the event is missing its fields', () => {
    const bare = {} as KeyPress
    const odd = { code: undefined, key: undefined, repeat: undefined } as unknown as KeyPress

    for (const state of [EDITOR_CLOSED, EDITOR_OPEN, waiting]) {
      expect(() => pressKey(state, bare, DEFAULT_SETTINGS, null)).not.toThrow()
      expect(() => pressKey(state, odd, DEFAULT_SETTINGS, null)).not.toThrow()
    }
    expect(pressKey(waiting, bare, DEFAULT_SETTINGS, null).changes).toBeNull()
    expect(pressKey(waiting, odd, DEFAULT_SETTINGS, null).changes).toBeNull()
  })

  // The spec says to save the character the new key types. When it types
  // none, that an older saved label of that key is dropped is the editor's choice.
  it.each(['Dead', 'Process', 'Unidentified', ' ', '', 'ab'])(
    'binds a key that reports "%s" as its character without saving that as a label',
    (key) => {
      const settings: Settings = { ...DEFAULT_SETTINGS, customLabels: { BracketLeft: 'Ü' } }

      const result = pressKey(selectSlot(0), press('BracketLeft', key), settings, null)

      expect(result.changes?.bindings.BracketLeft).toBe(0)
      expect(result.changes?.customLabels).toEqual({})
      expect(result.state.message).toBe('"[" now plays C3.')
    },
  )
})

/*
 * The spec does not cover keys that are held down. The editor's own rule,
 * checked here: while a piano key is waiting, the repeats of a held key are
 * never a choice (the key was down before the piano key was clicked).
 */
describe('held keys', () => {
  it.each(['KeyZ', 'Backspace', 'Delete', 'Escape', 'Enter', 'Space', ''])(
    'never acts on the repeats of %s while a piano key is waiting',
    (code) => {
      const waiting = selectSlot(12)

      const result = pressKey(waiting, press(code, '', true), DEFAULT_SETTINGS, null)

      expect(result.state).toBe(waiting)
      expect(result.changes).toBeNull()
      expect(result.consumed).toBe(true)
    },
  )

  it('lets the repeats of a note key through when no piano key is waiting', () => {
    const result = pressKey(EDITOR_OPEN, press('KeyA', 'a', true), DEFAULT_SETTINGS, null)

    expect(result).toEqual({ consumed: false, state: EDITOR_OPEN, changes: null })
  })
})

describe('the same key, again and again', () => {
  it('gives the same result each time the key a note already has is pressed', () => {
    let settings = DEFAULT_SETTINGS
    for (let round = 0; round < 3; round += 1) {
      const result = pressKey(selectSlot(12), press('KeyA', 'a'), settings, null)
      expect(result.state).toEqual({ ...EDITOR_OPEN, message: '"A" now plays C4.' })
      expect(result.changes?.bindings).toEqual(DEFAULT_BINDINGS)
      settings = save(settings, result.changes)
    }
    expect(settings.customLabels).toEqual({ KeyA: 'A' })
  })

  it('moves one key across the whole piano leaving no trace behind', () => {
    let settings: Settings = { ...DEFAULT_SETTINGS, bindings: {} }
    for (let slot = 0; slot < SLOT_COUNT; slot += 1) {
      const result = pressKey(selectSlot(slot), press('KeyQ', 'q'), settings, null)
      settings = save(settings, result.changes)
      expect(settings.bindings).toEqual({ KeyQ: slot })
    }
  })
})

/** A small seeded random generator, so a failing run can be repeated exactly. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state)
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296
  }
}

const CODES = [
  'KeyA',
  'KeyS',
  'KeyK',
  'KeyZ',
  'Digit1',
  'Quote',
  'BracketLeft',
  'Numpad5',
  'IntlRo',
  'Escape',
  'Backspace',
  'Delete',
  'Space',
  'Enter',
  'Tab',
  'F5',
  'ShiftLeft',
  '',
  'Unidentified',
  'constructor',
] as const

const CHARACTERS = ['a', 'A', '1', '!', "'", 'Dead', 'ß', 'é', 'ろ', '', ' ', 'Enter', 'ǆ', '\u{1D11E}']

describe('random sessions in "Customize keys"', () => {
  it.each([11, 12, 13, 14])('never throw and never break the saved keys (seed %i)', (seed) => {
    const random = seededRandom(seed)
    const pick = <Item>(items: readonly Item[]): Item => {
      const item = items[Math.floor(random() * items.length)]
      if (item === undefined) throw new Error('nothing to pick from')
      return item
    }
    let state: KeyEditorState = EDITOR_OPEN
    let settings: Settings = DEFAULT_SETTINGS

    for (let step = 0; step < 600; step += 1) {
      const roll = random()
      if (roll < 0.25) {
        state = selectSlot(Math.floor(random() * SLOT_COUNT))
        continue
      }
      if (roll < 0.3) {
        state = random() < 0.5 ? EDITOR_CLOSED : EDITOR_OPEN
        continue
      }

      const key = press(pick(CODES), pick(CHARACTERS), random() < 0.2)
      const before = state
      const result = pressKey(state, key, settings, null)

      // Only a fresh press on a waiting piano key may change the keys.
      if (result.changes !== null) {
        expect(before.selectedSlot).not.toBeNull()
        expect(key.repeat).toBe(false)
        expect(result.consumed).toBe(true)
        expect(result.state.selectedSlot).toBeNull()
        expect(result.state.message).toBeTruthy()
      }
      // Outside the editor every key belongs to the piano.
      if (!before.editing) expect(result).toEqual({ consumed: false, state: before, changes: null })
      // A closed editor never has a piano key waiting.
      if (!result.state.editing) expect(result.state.selectedSlot).toBeNull()

      const saved = save(settings, result.changes)
      if (result.changes !== null) {
        // What the editor asks to save is exactly what ends up saved.
        expect(saved.bindings).toEqual(result.changes.bindings)
        expect(saved.customLabels).toEqual(result.changes.customLabels)
      }
      const slots = Object.values(saved.bindings)
      expect(new Set(slots).size).toBe(slots.length)

      settings = saved
      state = result.state
    }
  })
})
