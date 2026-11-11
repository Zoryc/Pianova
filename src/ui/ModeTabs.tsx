import type { JSX } from 'react'

interface ModeTabsProps {
  /** The id to give the Free Play tab, so the page below can say which tab it belongs to. */
  tabId: string
  /** The id of the page below, which the Free Play tab controls. */
  panelId: string
}

/** The modes that are announced but not built yet. */
const COMING_MODES = ['Practice', 'Real-time'] as const

/**
 * The app's only navigation: one tab per mode. Free Play is the only mode so
 * far, so it is always the selected tab; the others are shown greyed out with
 * a "Soon" badge, and cannot be reached with the Tab key.
 */
export function ModeTabs({ tabId, panelId }: ModeTabsProps): JSX.Element {
  return (
    <div className="mode-tabs" role="tablist" aria-label="Modes">
      <button
        type="button"
        id={tabId}
        className="mode-tab"
        role="tab"
        aria-selected="true"
        aria-controls={panelId}
      >
        Free Play
      </button>
      {COMING_MODES.map((mode) => (
        <button
          key={mode}
          type="button"
          className="mode-tab"
          role="tab"
          aria-selected="false"
          aria-disabled="true"
          tabIndex={-1}
          title="Coming in a later update"
        >
          {mode}
          <span className="mode-tab__badge">Soon</span>
        </button>
      ))}
    </div>
  )
}
