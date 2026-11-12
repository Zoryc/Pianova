import { useEffect, useEffectEvent, useId, useLayoutEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import type { LayoutMap } from '../input/keyLabels'
import type { Settings } from '../state/settings'
import { FloatingPanel } from './FloatingPanel'
import { AboutTab } from './settings/AboutTab'
import { KeysTab } from './settings/KeysTab'
import { LookTab } from './settings/LookTab'
import { PianoTab } from './settings/PianoTab'
import { SoundTab } from './settings/SoundTab'
import { TabStrip } from './settings/TabStrip'
import type { TabItem } from './settings/TabStrip'
import type { KeyEditor } from './useKeyEditor'
import './settings/settings.css'

export interface SettingsPanelProps {
  /** The element id, for aria-controls on the button that opens the panel. */
  id: string
  settings: Settings
  /** What `useKeyEditor` returns; the Keys tab shows its state and calls its actions. */
  keyEditor: KeyEditor
  /** Part of the agreement with the app shell. No tab needs it so far. */
  layoutMap: LayoutMap | null
  onClose(): void
}

type TabId = 'sound' | 'keys' | 'piano' | 'look' | 'about'

const TABS: readonly TabItem<TabId>[] = [
  { id: 'sound', label: 'Sound' },
  { id: 'keys', label: 'Keys' },
  { id: 'piano', label: 'Piano' },
  { id: 'look', label: 'Look' },
  { id: 'about', label: 'About' },
]

/**
 * The tab the panel was last on. It lives outside the component, so that it
 * is remembered from one opening of the panel to the next while the app is open.
 */
let lastTab: TabId = 'sound'

/**
 * Every option of the app, in five tabs. The panel floats over the sky and
 * leaves the piano in view, so each change shows on the real piano at once.
 */
export function SettingsPanel(props: SettingsPanelProps): JSX.Element {
  const { id, settings, keyEditor, onClose } = props
  const [tab, setTab] = useState(lastTab)
  const baseId = useId()
  const pageId = `${baseId}-page`
  const tabId = (which: TabId): string => `${baseId}-${which}`
  const page = useRef<HTMLDivElement>(null)

  function showTab(next: TabId): void {
    lastTab = next
    setTab(next)
  }

  useKeyEditing(tab === 'keys', keyEditor)

  // A tab is shown from its top, wherever the tab before it had been scrolled
  // to. What scrolls is the body of the floating panel, which the page sits in.
  useLayoutEffect(() => {
    const scrollingBody = page.current?.parentElement
    if (scrollingBody) scrollingBody.scrollTop = 0
  }, [tab])

  return (
    <FloatingPanel
      id={id}
      title="Settings"
      onClose={onClose}
      headerExtra={
        <TabStrip
          label="Settings"
          tabs={TABS}
          active={tab}
          tabId={tabId}
          panelId={pageId}
          onChange={showTab}
        />
      }
    >
      <div
        ref={page}
        id={pageId}
        className="settings-page"
        role="tabpanel"
        aria-labelledby={tabId(tab)}
      >
        {tab === 'sound' && <SoundTab settings={settings} />}
        {tab === 'keys' && <KeysTab settings={settings} keyEditor={keyEditor} />}
        {tab === 'piano' && <PianoTab settings={settings} />}
        {tab === 'look' && <LookTab settings={settings} />}
        {tab === 'about' && <AboutTab />}
      </div>
    </FloatingPanel>
  )
}

/**
 * Choosing the computer keys (clicking a piano key selects it) is on exactly
 * while the Keys tab is showing: it starts when the tab becomes the active
 * one, and ends when another tab is chosen or the panel goes away.
 */
function useKeyEditing(onKeysTab: boolean, keyEditor: KeyEditor): void {
  // The editor's actions are new functions at every render: the effect below
  // must run when the tab changes, not each time those functions do.
  const open = useEffectEvent(() => keyEditor.open())
  const close = useEffectEvent(() => keyEditor.close())

  useEffect(() => {
    if (!onKeysTab) return
    open()
    return () => close()
  }, [onKeysTab])
}
