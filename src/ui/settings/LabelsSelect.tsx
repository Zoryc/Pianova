import { useRef } from 'react'
import type { JSX, KeyboardEvent } from 'react'
import type { LabelMode } from '../../core/types'
import { isBindableCode } from '../../input/keymap'

interface LabelsSelectProps {
  /** What the drop-down chooses, for screen readers. */
  label: string
  value: LabelMode
  onChange(value: LabelMode): void
}

const LABEL_OPTIONS: readonly { value: LabelMode; label: string }[] = [
  { value: 'both', label: 'Keys and notes' },
  { value: 'keys', label: 'Keys only' },
  { value: 'notes', label: 'Notes only' },
  { value: 'none', label: 'No labels' },
]

/**
 * The drop-down for what is written on the piano keys. While a drop-down has
 * the keyboard, the keys go to it and not to the piano, and a letter even
 * changes its choice. So it lets go of the keyboard as soon as the player is
 * done with it:
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
export function LabelsSelect({ label, value, onChange }: LabelsSelectProps): JSX.Element {
  /** True from a press with the mouse until the drop-down lets go of the keyboard. */
  const openedByPointer = useRef(false)

  return (
    <select
      className="select"
      aria-label={label}
      value={value}
      onChange={(event) => {
        const chosen = LABEL_OPTIONS.find((option) => option.value === event.currentTarget.value)
        if (chosen) onChange(chosen.value)
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
