import { useRef } from 'react'
import type { JSX, KeyboardEvent, RefObject } from 'react'
import { MAX_BASE_OCTAVE, MIN_BASE_OCTAVE } from '../core/layout'
import type { LabelMode } from '../core/types'
import { isBindableCode } from '../input/keymap'
import { settingsStore } from '../state/settings'
import type { Settings } from '../state/settings'
import { Field, PercentSlider, Switch } from './controls'
import { pianoRangeLabel } from './format'

interface ToolbarProps {
  settings: Settings
  /** True while "Customize keys" is open. */
  editing: boolean
  advancedOpen: boolean
  /** The id of the Advanced panel, which the Advanced button opens and closes. */
  advancedPanelId: string
  /** Lets the app put the keyboard focus on the "Customize keys" button. */
  customizeButtonRef: RefObject<HTMLButtonElement | null>
  onToggleEditing(): void
  onToggleAdvanced(): void
}

const LABEL_OPTIONS: readonly { value: LabelMode; label: string }[] = [
  { value: 'both', label: 'Keys and notes' },
  { value: 'keys', label: 'Keys only' },
  { value: 'notes', label: 'Notes only' },
  { value: 'none', label: 'No labels' },
]

/*
 * ◀ and ▶ are followed by a "text style" mark (U+FE0E), so that they are
 * drawn as plain shapes in the colour of the text and never as colour emoji.
 */
const ARROW_LOWER = '◀︎'
const ARROW_HIGHER = '▶︎'

/** The row of everyday controls. Every change is written straight to the settings. */
export function Toolbar(props: ToolbarProps): JSX.Element {
  const { settings, editing, advancedOpen, advancedPanelId, customizeButtonRef } = props
  const { onToggleEditing, onToggleAdvanced } = props
  const { baseOctave } = settings

  return (
    <section className="toolbar panel" aria-label="Controls">
      <Field label="Volume">
        <span className="field__icon" aria-hidden="true">
          🔊
        </span>
        <PercentSlider
          label="Volume"
          value={settings.volume}
          onChange={(volume) => settingsStore.set({ volume })}
        />
      </Field>

      <Field label="Sustain">
        <Switch
          label="Sustain"
          on={settings.sustain}
          onChange={(sustain) => settingsStore.set({ sustain })}
        />
        <kbd className="keycap">Space</kbd>
      </Field>

      <Field label="Piano position">
        <button
          type="button"
          className="button"
          disabled={baseOctave <= MIN_BASE_OCTAVE}
          onClick={() => settingsStore.set({ baseOctave: baseOctave - 1 })}
        >
          <span aria-hidden="true">{ARROW_LOWER}</span> Lower
        </button>
        {/* An <output>, so that screen readers say the new range when the piano moves. */}
        <output className="piano-range">{pianoRangeLabel(baseOctave, settings.noteNaming)}</output>
        <button
          type="button"
          className="button"
          disabled={baseOctave >= MAX_BASE_OCTAVE}
          onClick={() => settingsStore.set({ baseOctave: baseOctave + 1 })}
        >
          Higher <span aria-hidden="true">{ARROW_HIGHER}</span>
        </button>
      </Field>

      <Field label="Labels">
        <LabelsSelect value={settings.labelMode} />
      </Field>

      <button
        ref={customizeButtonRef}
        type="button"
        className="button button--primary"
        aria-pressed={editing}
        onClick={onToggleEditing}
      >
        Customize keys
      </button>

      <button
        type="button"
        className="button button--quiet toolbar__advanced"
        aria-expanded={advancedOpen}
        aria-controls={advancedOpen ? advancedPanelId : undefined}
        onClick={onToggleAdvanced}
      >
        Advanced
        <span className="button__chevron" aria-hidden="true">
          ▾
        </span>
      </button>
    </section>
  )
}

/**
 * The Labels drop-down. While a drop-down has the keyboard, the keys go to it
 * and not to the piano, and a letter even changes its choice. So it lets go
 * of the keyboard as soon as the player is done with it:
 *
 * - when a choice is made;
 * - when its list is closed without a new choice: with Escape, or by picking
 *   the choice it already shows;
 * - at the next key the piano uses, when it was opened with the mouse and its
 *   list was closed by a click somewhere else, which the page is never told
 *   about. That one key press plays nothing; the next one does.
 *
 * Someone who reaches it with Tab keeps it until they choose, press Escape
 * or Enter, or move on with Tab.
 */
function LabelsSelect({ value }: { value: LabelMode }): JSX.Element {
  /** True from a press with the mouse or a finger until the drop-down lets go of the keyboard. */
  const openedByPointer = useRef(false)

  return (
    <select
      className="select"
      aria-label="Labels"
      value={value}
      onChange={(event) => {
        const chosen = LABEL_OPTIONS.find((option) => option.value === event.currentTarget.value)
        if (chosen) settingsStore.set({ labelMode: chosen.value })
        event.currentTarget.blur()
      }}
      onKeyUp={(event) => {
        // Key up, not key down: while the list is open the browser keeps the
        // key down to itself, and Enter must first confirm the choice.
        if (event.key === 'Escape' || event.key === 'Enter') event.currentTarget.blur()
      }}
      onClick={(event) => {
        // Picking a choice in the list reaches the page as a click that no
        // mouse button made (`detail` is 0), also when nothing changed.
        if (event.detail === 0) event.currentTarget.blur()
      }}
      onPointerDown={() => {
        openedByPointer.current = true
      }}
      onBlur={() => {
        openedByPointer.current = false
      }}
      onKeyDown={(event) => {
        // In Chrome and Edge a key press only gets here while the list is closed.
        if (openedByPointer.current && isPianoKeyPress(event)) {
          // It gives the keyboard back and does nothing else: no change of choice.
          event.preventDefault()
          event.currentTarget.blur()
        }
      }}
    >
      {LABEL_OPTIONS.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}

/**
 * True for a key the piano uses, pressed on its own: Space (sustain), or a
 * key that can play a note.
 */
function isPianoKeyPress(event: KeyboardEvent): boolean {
  if (event.ctrlKey || event.altKey || event.metaKey) return false
  return event.code === 'Space' || isBindableCode(event.code)
}
