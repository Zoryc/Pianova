import type { JSX } from 'react'
import { APP_NAME } from '../app/appInfo'
import './chrome.css'

interface StartOverlayProps {
  /** The overlay was clicked. (Key presses are caught by the app's keyboard handler.) */
  onStart(): void
}

/**
 * Covers the whole screen until the first click or key press, with the stage
 * dimmed behind it. Browsers only allow a page to make sound after the user
 * has done one of those, so this is where the sound gets started.
 */
export function StartOverlay({ onStart }: StartOverlayProps): JSX.Element {
  return (
    <button type="button" className="start-overlay" onClick={onStart}>
      <span className="start-overlay__name">{APP_NAME}</span>
      <span className="start-overlay__line" aria-hidden="true" />
      <span className="start-overlay__action">Click or press any key to start</span>
    </button>
  )
}
