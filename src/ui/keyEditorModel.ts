/**
 * The rules of choosing the computer keys (the Keys tab of Settings), with no
 * React and no DOM so they can be unit-tested: what a key press does while a
 * piano key waits for its computer key, which settings it changes, and the
 * sentence shown to the user afterwards.
 */
import { slotToMidi } from '../core/layout'
import { noteName } from '../core/notes'
import type { LabelMode } from '../core/types'
import { keyLabel, labelFromEventKey } from '../input/keyLabels'
import type { LayoutMap } from '../input/keyLabels'
import { assignBinding, clearSlot, isBindableCode } from '../input/keymap'
import type { Settings } from '../state/settings'

export interface KeyEditorState {
  /** True while the computer keys are being chosen: the Keys tab of Settings is showing. */
  editing: boolean
  /** The piano key waiting for a computer key, or null when none is selected. */
  selectedSlot: number | null
  /** What the last action did, in words for the user. Null when there is nothing to say. */
  message: string | null
}

export const EDITOR_CLOSED: KeyEditorState = { editing: false, selectedSlot: null, message: null }
/** Open, with no piano key selected: the keyboard plays as usual. */
export const EDITOR_OPEN: KeyEditorState = { editing: true, selectedSlot: null, message: null }

/** The settings that hold the user's keys: what "Reset to default keys" puts back. */
export const KEY_SETTINGS = ['bindings', 'customLabels'] as const
export type KeySettings = Pick<Settings, (typeof KEY_SETTINGS)[number]>

export const UNUSABLE_KEY_MESSAGE = "That key can't be used. Try a letter, number or symbol key."
export const KEYS_RESET_MESSAGE = 'The default keys are back.'

/** The parts of a KeyboardEvent the editor looks at. */
export interface KeyPress {
  /** Which physical key (KeyboardEvent.code). */
  code: string
  /** The character it types (KeyboardEvent.key), used as its label. */
  key: string
  /** True for the repeats a held key sends. */
  repeat: boolean
}

export interface KeyPressResult {
  /** True when the press was used up by the editor: it must not play a note or toggle sustain. */
  consumed: boolean
  state: KeyEditorState
  /** The key settings to save, or null when the press did not change them. */
  changes: KeySettings | null
}

/** F1…F12 and beyond: the browser's own keys (F5 reloads, F11 is full screen). */
export function isFunctionKey(code: string): boolean {
  return /^F\d+$/.test(code)
}

/** Full name of the note a piano key plays right now, as the user reads it: "C4" or "Do4". */
export function slotNoteName(settings: Settings, slot: number): string {
  return noteName(slotToMidi(slot, settings.baseOctave), settings.noteNaming)
}

/**
 * What is written on the piano keys while the computer keys are being chosen
 * (the Keys tab of Settings): the player's own choice of labels, with the
 * computer keys added when it leaves them out. They are what is being
 * changed, so they have to be visible. The saved choice is not touched and
 * applies again afterwards.
 */
export function labelModeWhileEditing(labelMode: LabelMode): LabelMode {
  if (labelMode === 'none') return 'keys'
  if (labelMode === 'notes') return 'both'
  return labelMode
}

/** A piano key was clicked: it now waits for a computer key. */
export function selectSlot(slot: number): KeyEditorState {
  return { editing: true, selectedSlot: slot, message: null }
}

/**
 * A computer key was pressed. While a piano key is selected the press is for
 * it: a letter, number or symbol becomes its key, Backspace or Delete removes
 * its key, Escape cancels. With nothing selected no press is used up here:
 * the keyboard plays as usual, and Escape is left to the app shell, the one
 * place that decides what it does then (docs/INTERFACE.md, section 5.0).
 */
export function pressKey(
  state: KeyEditorState,
  press: KeyPress,
  settings: Settings,
  layoutMap: LayoutMap | null,
): KeyPressResult {
  const slot = state.selectedSlot
  if (!state.editing || slot === null) return { consumed: false, state, changes: null }

  // A key that was already down when the piano key was selected keeps
  // repeating. That is not the user choosing it.
  if (press.repeat) return { consumed: true, state, changes: null }

  if (press.code === 'Escape') return { consumed: true, state: EDITOR_OPEN, changes: null }
  if (press.code === 'Backspace' || press.code === 'Delete') {
    return finished(removeKey(settings, slot))
  }
  if (isBindableCode(press.code)) {
    return finished(assignKey(settings, layoutMap, slot, press))
  }
  return {
    // The message is shown, but the browser keeps its function keys.
    consumed: !isFunctionKey(press.code),
    state: { ...state, message: UNUSABLE_KEY_MESSAGE },
    changes: null,
  }
}

/** What a change to the keys saves, and what it tells the user. */
interface KeyChange {
  changes: KeySettings
  message: string
}

/** The change is done: nothing is selected any more and the user is told what happened. */
function finished(change: KeyChange): KeyPressResult {
  return {
    consumed: true,
    state: { ...EDITOR_OPEN, message: change.message },
    changes: change.changes,
  }
}

function assignKey(
  settings: Settings,
  layoutMap: LayoutMap | null,
  slot: number,
  press: KeyPress,
): KeyChange {
  const { bindings, replacedCode, vacatedSlot } = assignBinding(settings.bindings, press.code, slot)
  const customLabels = withLabel(settings.customLabels, press.code, labelFromEventKey(press.key))
  // The same label the piano draws on the key, so the sentence names what the player sees.
  const quoted = (code: string): string =>
    `"${keyLabel(code, layoutMap, customLabels, settings.keyboardType)}"`

  const sentences = [`${quoted(press.code)} now plays ${slotNoteName(settings, slot)}.`]
  if (replacedCode !== null) sentences.push(`${quoted(replacedCode)} no longer plays a note.`)
  if (vacatedSlot !== null) sentences.push(`${slotNoteName(settings, vacatedSlot)} has no key now.`)
  return { changes: { bindings, customLabels }, message: sentences.join(' ') }
}

function removeKey(settings: Settings, slot: number): KeyChange {
  return {
    changes: {
      bindings: clearSlot(settings.bindings, slot),
      customLabels: settings.customLabels,
    },
    message: `${slotNoteName(settings, slot)} has no key now.`,
  }
}

/**
 * The saved labels with the one for `code` replaced. A key that types no
 * character of its own (`label` is null) loses its saved label, so an old one
 * from another keyboard layout is not shown for it.
 */
function withLabel(
  labels: Readonly<Record<string, string>>,
  code: string,
  label: string | null,
): Readonly<Record<string, string>> {
  const others = Object.entries(labels).filter(([labelledCode]) => labelledCode !== code)
  return Object.fromEntries(label === null ? others : [...others, [code, label]])
}
