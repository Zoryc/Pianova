import { useState } from 'react'
import { bus } from '../app/pianoApp'
import type { LayoutMap } from '../input/keyLabels'
import type { KeyPreset } from '../input/keymap'
import { settingsStore } from '../state/settings'
import {
  EDITOR_CLOSED,
  EDITOR_OPEN,
  KEYS_RESET_MESSAGE,
  KEY_SETTINGS,
  pressKey,
  selectSlot,
} from './keyEditorModel'
import type { KeyEditorState } from './keyEditorModel'

export interface KeyEditor extends KeyEditorState {
  /** Enters "Customize keys". */
  open(): void
  /** Leaves it. */
  close(): void
  /** A piano key was clicked: it now waits for a computer key. */
  select(slot: number): void
  /** Replaces every key with those of a ready-made layout. */
  applyPreset(preset: KeyPreset): void
  /** Puts every key back to the default. */
  resetKeys(): void
  /** A computer key was pressed. True when the editor used the press up. */
  handleKey(event: KeyboardEvent): boolean
}

/**
 * The state of "Customize keys" and the actions that change it. The rules
 * themselves are in keyEditorModel.ts; this hook keeps the state, saves the
 * changed keys and silences the piano when a note could otherwise get stuck.
 */
export function useKeyEditor(layoutMap: LayoutMap | null): KeyEditor {
  const [state, setState] = useState(EDITOR_CLOSED)

  return {
    ...state,
    open() {
      bus.allOff()
      setState(EDITOR_OPEN)
    },
    close() {
      setState(EDITOR_CLOSED)
    },
    select(slot) {
      // The piano goes quiet while it waits for the key: whatever was held is let go.
      bus.allOff()
      setState(selectSlot(slot))
    },
    applyPreset(preset) {
      // The labels captured key by key stay: they say what is printed on the
      // player's keyboard, which a new layout does not change.
      settingsStore.set({ bindings: preset.bindings })
      // A piano key that was waiting no longer does, and the last message is
      // about keys that have just been replaced.
      setState(EDITOR_OPEN)
    },
    resetKeys() {
      settingsStore.resetKeys(KEY_SETTINGS)
      setState({ ...EDITOR_OPEN, message: KEYS_RESET_MESSAGE })
    },
    handleKey(event) {
      const result = pressKey(state, event, settingsStore.get(), layoutMap)
      if (result.changes) settingsStore.set(result.changes)
      setState(result.state)
      return result.consumed
    },
  }
}
