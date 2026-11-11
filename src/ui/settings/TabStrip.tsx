import type { JSX, KeyboardEvent } from 'react'

export interface TabItem<Id extends string> {
  id: Id
  /** The word written on the tab. */
  label: string
}

interface TabStripProps<Id extends string> {
  /** What the tabs are for, for screen readers. */
  label: string
  tabs: readonly TabItem<Id>[]
  active: Id
  /** The element id of a tab. The page it shows names itself after it. */
  tabId(id: Id): string
  /** The element id of the page the tabs switch. */
  panelId: string
  onChange(id: Id): void
}

/**
 * A row of tabs. Only the active tab is reached with the Tab key; from there
 * the arrow keys, Home and End move to another tab and show its page at once.
 * The look is the shared one of src/ui/chrome.css (.tabs and .tab).
 */
export function TabStrip<Id extends string>(props: TabStripProps<Id>): JSX.Element {
  const { label, tabs, active, tabId, panelId, onChange } = props

  function handleKeyDown(event: KeyboardEvent): void {
    // With Alt, the arrows are the browser's Back and Forward.
    if (event.ctrlKey || event.altKey || event.metaKey) return
    const target = tabReachedWith(event.key, tabs, active)
    if (!target) return
    event.preventDefault()
    onChange(target.id)
    document.getElementById(tabId(target.id))?.focus()
  }

  return (
    <div className="tabs" role="tablist" aria-label={label} onKeyDown={handleKeyDown}>
      {tabs.map((tab) => {
        const selected = tab.id === active
        return (
          <button
            key={tab.id}
            type="button"
            id={tabId(tab.id)}
            className="tab"
            role="tab"
            aria-selected={selected}
            aria-controls={selected ? panelId : undefined}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.id)}
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}

/** The tab a key press leads to from the active one, or undefined for any other key. */
function tabReachedWith<Id extends string>(
  key: string,
  tabs: readonly TabItem<Id>[],
  active: Id,
): TabItem<Id> | undefined {
  const index = tabs.findIndex((tab) => tab.id === active)
  switch (key) {
    case 'ArrowRight':
      return tabs[(index + 1) % tabs.length]
    case 'ArrowLeft':
      return tabs[(index - 1 + tabs.length) % tabs.length]
    case 'Home':
      return tabs[0]
    case 'End':
      return tabs[tabs.length - 1]
    default:
      return undefined
  }
}
