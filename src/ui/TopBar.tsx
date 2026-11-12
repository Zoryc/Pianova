import type { JSX, ReactNode, RefObject } from 'react'
import { APP_NAME } from '../app/appInfo'
import { settingsStore } from '../state/settings'
import type { Settings } from '../state/settings'
import './chrome.css'
import { FullscreenButton } from './FullscreenButton'
import { ModeTabs } from './ModeTabs'
import { formatPercent, toPercent } from './format'
import type { AutoHideMenu } from './useAutoHide'

/** The two panels that open from the top bar. Only one is open at a time. */
export type PanelName = 'songs' | 'settings'

export interface TopBarProps {
  /** Volume and sustain are shown and changed here. */
  settings: Settings
  /** The panel that is open right now, or null. */
  openPanel: PanelName | null
  /** The ids of the two panels (what FloatingPanel gets as `id`). */
  songsPanelId: string
  settingsPanelId: string
  onToggleSongs(): void
  onToggleSettings(): void
  /**
   * What useAutoHide returned: whether the menu is shown, and what follows the
   * mouse and the keyboard focus over it.
   */
  menu: AutoHideMenu
  /** The id to give the Free Play tab, and the id of the part of the page it stands for. */
  modeTabId: string
  modePanelId: string
  /** Let the app put the keyboard focus on the "Songs" and "Settings" buttons. */
  songsButtonRef?: RefObject<HTMLButtonElement | null>
  settingsButtonRef?: RefObject<HTMLButtonElement | null>
  /** Drawn under the bar, and hidden and shown with it: the player line. */
  children?: ReactNode
}

/**
 * The menu at the top of the stage: the bar itself, and under it whatever it
 * is given as children. Both hide together when the mouse is still.
 *
 * Left to right: the app's name, the modes, then volume, sustain, the buttons
 * that open the Songs and Settings panels, and full screen. Volume and
 * sustain are written straight to the settings.
 */
export function TopBar(props: TopBarProps): JSX.Element {
  const { settings, openPanel, menu, children } = props

  return (
    <header className={menu.visible ? 'menu' : 'menu menu--hidden'} {...menu.menuProps}>
      <div className="top-bar">
        <h1 className="top-bar__name">{APP_NAME}</h1>
        <ModeTabs tabId={props.modeTabId} panelId={props.modePanelId} />
        <div className="top-bar__space" />
        <Volume volume={settings.volume} />
        <Sustain on={settings.sustain} />
        <PanelButton
          label="Songs"
          open={openPanel === 'songs'}
          panelId={props.songsPanelId}
          onToggle={props.onToggleSongs}
          buttonRef={props.songsButtonRef}
        />
        <PanelButton
          label="Settings"
          open={openPanel === 'settings'}
          panelId={props.settingsPanelId}
          onToggle={props.onToggleSettings}
          buttonRef={props.settingsButtonRef}
        />
        <FullscreenButton />
      </div>
      {children}
    </header>
  )
}

function Volume({ volume }: { volume: number }): JSX.Element {
  return (
    <div className="top-bar__volume">
      <SpeakerIcon volume={volume} />
      <input
        className="slider"
        type="range"
        min={0}
        max={100}
        step={1}
        value={toPercent(volume)}
        aria-label="Volume"
        aria-valuetext={formatPercent(volume)}
        onChange={(event) => settingsStore.set({ volume: Number(event.currentTarget.value) / 100 })}
      />
    </div>
  )
}

function Sustain({ on }: { on: boolean }): JSX.Element {
  return (
    <div className="top-bar__sustain">
      <button
        type="button"
        className="switch"
        role="switch"
        aria-checked={on}
        aria-label="Sustain"
        onClick={() => settingsStore.set({ sustain: !on })}
      >
        <span className="switch__track" aria-hidden="true">
          <span className="switch__thumb" />
        </span>
        Sustain
        <span className="switch__state">{on ? 'On' : 'Off'}</span>
      </button>
      <kbd className="keycap" title="Space turns sustain on and off">
        Space
      </kbd>
    </div>
  )
}

interface PanelButtonProps {
  label: string
  open: boolean
  panelId: string
  onToggle(): void
  buttonRef?: RefObject<HTMLButtonElement | null>
}

function PanelButton({ label, open, panelId, onToggle, buttonRef }: PanelButtonProps): JSX.Element {
  return (
    <button
      ref={buttonRef}
      type="button"
      className="button button--quiet"
      aria-expanded={open}
      // A closed panel is not on the page, and there is nothing to point at.
      aria-controls={open ? panelId : undefined}
      onClick={onToggle}
    >
      {label}
    </button>
  )
}

/** A loudspeaker: crossed out at 0, one wave when quiet, two when loud. */
function SpeakerIcon({ volume }: { volume: number }): JSX.Element {
  return (
    <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2 6.5h2.5l3.5-3v9l-3.5-3H2z" />
      {volume === 0 && <path d="M10.5 6.5l3 3M13.5 6.5l-3 3" />}
      {volume > 0 && <path d="M10.5 6.2a2.6 2.6 0 0 1 0 3.6" />}
      {volume >= 0.5 && <path d="M12.3 4.4a5.1 5.1 0 0 1 0 7.2" />}
    </svg>
  )
}
