import { useLayoutEffect, useRef } from 'react'
import type { JSX, RefObject } from 'react'
import { ConfirmButton } from './controls'

interface KeyEditorProps {
  /** Name of the piano key waiting for a computer key ("C4"), or null when none is selected. */
  selectedNote: string | null
  /** What the last action did, or null. */
  message: string | null
  onReset(): void
  onDone(): void
  /** Takes the keyboard focus when the panel closes while one of its buttons has it. */
  returnFocusTo: RefObject<HTMLElement | null>
}

/**
 * The "Customize keys" panel shown above the piano. It only explains and
 * reports: the piano itself is where a key is clicked, and the key presses
 * are handled by the app (see useKeyEditor).
 */
export function KeyEditor(props: KeyEditorProps): JSX.Element {
  const { selectedNote, message, onReset, onDone, returnFocusTo } = props
  const panel = useRef<HTMLElement>(null)

  /*
   * Closing the panel with the keyboard (Enter on "Done", or Escape while one
   * of its buttons has the focus) removes the focused button, and the focus
   * would be lost with it. React runs this clean-up just before it takes the
   * panel off the page, while the button still has the focus, so the focus
   * can be handed on. After a click with the mouse the app has already taken
   * the focus off the button, and nothing happens here.
   */
  useLayoutEffect(() => {
    const element = panel.current
    return () => {
      if (element?.contains(document.activeElement)) returnFocusTo.current?.focus()
    }
  }, [returnFocusTo])

  return (
    <section ref={panel} className="key-editor panel" aria-label="Customize keys">
      <div className="key-editor__text">
        {/* Screen readers announce it when it changes: it says what the next key press does. */}
        <p className="key-editor__lead" aria-live="polite">
          {selectedNote === null
            ? 'Click a piano key, then press the key you want to use for it.'
            : `Press a key for ${selectedNote}…`}
        </p>
        <p className="key-editor__detail">
          {/* Both are always present, so that screen readers announce their text as it appears. */}
          <span className="key-editor__hint" aria-live="polite">
            {selectedNote !== null && 'Esc = cancel · Backspace = remove this key'}
          </span>
          <span className="key-editor__message" role="status">
            {message}
          </span>
        </p>
      </div>

      <div className="key-editor__actions">
        <ConfirmButton label="Reset to default keys" onConfirm={onReset} />
        <button type="button" className="button button--primary" onClick={onDone}>
          Done
        </button>
      </div>
    </section>
  )
}
