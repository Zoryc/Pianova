import { useState } from 'react'
import { bus } from '../app/pianoApp'
import type { LayoutMap } from '../input/keyLabels'
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
