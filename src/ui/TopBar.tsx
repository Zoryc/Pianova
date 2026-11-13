import type { JSX, ReactNode, RefObject } from 'react'
import { settingsStore } from '../state/settings'
import type { Settings } from '../state/settings'
import './chrome.css'
import { formatPercent, toPercent } from './format'
import type { AutoHideMenu } from './useAutoHide'

export interface TopBarProps {
  /** Volume and sustain are shown and changed here. */
  settings: Settings
  /** Whether the start box, which the Menu button opens and closes, is open. */
  startBoxOpen: boolean
  /** The id of the start box (what StartBox gets as `id`). */
  startBoxId: string
  onToggleStartBox(): void
  /**
   * What useAutoHide returned: whether the menu is shown, and what follows the
   * mouse and the keyboard focus over it.
   */
  menu: AutoHideMenu
  /** Lets the app put the keyboard focus on the Menu button. */
  startBoxButtonRef?: RefObject<HTMLButtonElement | null>
  /** Drawn in the bar, and hidden and shown with it: the player line. */
  children?: ReactNode
}

/**
 * The menu at the top of the stage: what is needed while playing, and
 * nothing else. It hides when the mouse is still.
 *
 * Left to right: the Menu button, which opens the start box with everything
 * that is used now and then; whatever it is given as children (the controls
 * of the song, in the same row when the window is wide enough and in a row of
 * their own under it otherwise); then volume and sustain, which are written
 * straight to the settings.
 */
export function TopBar(props: TopBarProps): JSX.Element {
  const { settings, startBoxOpen, menu, children } = props

  return (
    <header className={menu.visible ? 'menu' : 'menu menu--hidden'} {...menu.menuProps}>
      <div className="top-bar">
        <button
          ref={props.startBoxButtonRef}
          type="button"
          className="button top-bar__menu"
          aria-expanded={startBoxOpen}
          // A closed box is not on the page, and there is nothing to point at.
          aria-controls={startBoxOpen ? props.startBoxId : undefined}
          onClick={props.onToggleStartBox}
        >
          <MenuIcon />
          Menu
        </button>
        {children}
        <div className="top-bar__space" />
        <Volume volume={settings.volume} />
        <Sustain on={settings.sustain} />
      </div>
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

/** Three lines: a list to open. */
function MenuIcon(): JSX.Element {
  return (
    <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2.5 4h11M2.5 8h11M2.5 12h11" />
    </svg>
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
