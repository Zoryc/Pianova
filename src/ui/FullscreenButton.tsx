import { useSyncExternalStore } from 'react'
import type { JSX } from 'react'
import './chrome.css'

/**
 * Makes the app fill the whole screen, without the browser around it, and
 * puts it back. Not drawn at all where the browser cannot do that.
 */
export function FullscreenButton(): JSX.Element | null {
  const fullscreen = useSyncExternalStore(followFullscreen, isFullscreen, notOnAPage)
  if (!canGoFullscreen()) return null

  const name = fullscreen ? 'Leave full screen' : 'Full screen'
  return (
    <button
      type="button"
      className="button button--quiet button--icon"
      aria-label={name}
      title={name}
      onClick={toggleFullscreen}
    >
      {fullscreen ? <LeaveIcon /> : <EnterIcon />}
    </button>
  )
}

function canGoFullscreen(): boolean {
  return typeof document !== 'undefined' && document.fullscreenEnabled === true
}

function isFullscreen(): boolean {
  // Loosely compared: null in a browser, and not there at all on a test's simulated page.
  return document.fullscreenElement != null
}

/** What is drawn where there is no page at all (a test that draws to text). */
function notOnAPage(): boolean {
  return false
}

/** Full screen also ends without the button (Escape), so the browser is asked to tell. */
function followFullscreen(onChange: () => void): () => void {
  document.addEventListener('fullscreenchange', onChange)
  return () => document.removeEventListener('fullscreenchange', onChange)
}

function toggleFullscreen(): void {
  const change = isFullscreen()
    ? document.exitFullscreen()
    : document.documentElement.requestFullscreen()
  // The browser may say no. Then nothing changes, and the button stays as it is.
  Promise.resolve(change).catch(() => undefined)
}

/** Four corners pointing outward. */
function EnterIcon(): JSX.Element {
  return (
    <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10" />
    </svg>
  )
}

/** Four corners pointing inward. */
function LeaveIcon(): JSX.Element {
  return (
    <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M6 2.5V6H2.5M13.5 6H10V2.5M10 13.5V10h3.5M2.5 10H6v3.5" />
    </svg>
  )
}
