import { useId, useLayoutEffect, useRef } from 'react'
import type { JSX, ReactNode } from 'react'
import './chrome.css'
import { controlsIn } from './useAutoHide'

export interface FloatingPanelProps {
  /** The element id, for aria-controls on the button that opens the panel. */
  id: string
  title: string
  onClose(): void
  /** Shown in the heading row after the title (the Settings tabs go here). */
  headerExtra?: ReactNode
  children: ReactNode
}

/**
 * The panel that floats over the sky: Settings and Songs. It is on the page
 * while it is open and taken off when it is closed (the app decides which).
 *
 * It fills the box of the element it is put in, up to its own widest, and its
 * content scrolls inside it. That box is how the app keeps it off the piano.
 *
 * It draws the heading, the close button and the scrolling body. It does not
 * listen for Escape and does not watch clicks outside itself: the app does both.
 */
export function FloatingPanel(props: FloatingPanelProps): JSX.Element {
  const { id, title, onClose, headerExtra, children } = props
  const titleId = useId()
  const panel = useRef<HTMLElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)

  /*
   * Someone working with the keyboard alone opened the panel from a button
   * that still has the focus: the focus goes to the panel's first control,
   * and back to that button when the panel closes.
   *
   * After a click with the mouse nothing has the focus (buttons let go of it,
   * so that the keyboard goes back to the piano). Then the panel itself takes
   * it: Tab continues inside the panel, and no control shows a focus ring at
   * the next note played.
   *
   * React runs the clean-up just before it takes the panel off the page,
   * while the focus is still inside it.
   */
  useLayoutEffect(() => {
    const element = panel.current
    if (!element) return
    const cameFrom = focusedOutside(element)
    const target = cameFrom ? firstControl(element, closeButton.current) : element
    target.focus()
    return () => {
      if (element.contains(document.activeElement)) cameFrom?.focus()
    }
  }, [])

  return (
    <section
      ref={panel}
      id={id}
      className="floating-panel"
      role="dialog"
      aria-labelledby={titleId}
      tabIndex={-1}
    >
      <header className="floating-panel__header">
        <h2 id={titleId} className="floating-panel__title">
          {title}
        </h2>
        {headerExtra !== undefined && <div className="floating-panel__extra">{headerExtra}</div>}
        <button
          ref={closeButton}
          type="button"
          className="button button--quiet button--icon floating-panel__close"
          aria-label={`Close ${title}`}
          title="Close"
          onClick={onClose}
        >
          <CloseIcon />
        </button>
      </header>
      <div className="floating-panel__body">{children}</div>
    </section>
  )
}

/** The control that has the keyboard focus, when it is not part of `panel`. */
function focusedOutside(panel: HTMLElement): HTMLElement | null {
  const focused = document.activeElement
  if (!(focused instanceof HTMLElement) || focused === document.body) return null
  return panel.contains(focused) ? null : focused
}

/** The first control of the panel. The close button only when there is no other. */
function firstControl(panel: HTMLElement, closeButton: HTMLElement | null): HTMLElement {
  const controls = controlsIn(panel)
  return controls.find((control) => control !== closeButton) ?? controls[0] ?? panel
}

function CloseIcon(): JSX.Element {
  return (
    <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />
    </svg>
  )
}
