import { useState } from 'react'
import type { JSX } from 'react'
import { settingsStore } from '../../state/settings'
import { ConfirmButton } from '../controls'
import { LogoMark, Wordmark } from '../Logo'
import { forgetKeysBeforeSong } from '../useSongs'

/** The licence of the piano recordings, which asks for the credit shown here. */
const PIANO_SOUND_LICENCE_URL = 'https://creativecommons.org/licenses/by/3.0/'

/** What "Reset all settings" says once it has done its work. */
const RESET_DONE_MESSAGE = 'Everything is back to how it was at the start.'

/** What the app is, whose work it uses, where the player's data stays, and a way to start over. */
export function AboutTab(): JSX.Element {
  /** True once the player has reset everything, for as long as the tab stays on screen. */
  const [resetDone, setResetDone] = useState(false)

  function resetEverything(): void {
    settingsStore.reset()
    // A loaded song would put the computer keys back, when it is closed, where they were before the reset.
    forgetKeysBeforeSong()
    setResetDone(true)
  }

  return (
    <div className="about">
      <h3 className="about__name">
        <LogoMark />
        <Wordmark />
      </h3>
      <p className="about__tagline">A piano you play with your computer keyboard.</p>

      <p className="about__line">
        Piano sound: Salamander Grand Piano by Alexander Holm (
        <a href={PIANO_SOUND_LICENCE_URL} target="_blank" rel="noreferrer">
          CC BY 3.0
        </a>
        )
      </p>
      <p className="about__line">Everything stays in your browser. Nothing is uploaded.</p>
      <p className="about__line">
        Clearing the browser's data for this page removes your settings and songs.
      </p>

      <div className="about__reset">
        <ConfirmButton label="Reset all settings" onConfirm={resetEverything} />
        <div>
          <p className="settings-hint">
            Puts every setting and every key back to how it was at the start.
          </p>
          {/* Always present, so that screen readers announce its text as it appears. */}
          <div className="about__reset-done" role="status">
            {resetDone && RESET_DONE_MESSAGE}
          </div>
        </div>
      </div>
    </div>
  )
}
