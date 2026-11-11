import type { JSX } from 'react'
import { APP_NAME } from '../../app/appInfo'
import { settingsStore } from '../../state/settings'
import { ConfirmButton } from '../controls'

/** The licence of the piano recordings, which asks for the credit shown here. */
const PIANO_SOUND_LICENCE_URL = 'https://creativecommons.org/licenses/by/3.0/'

/** What the app is, whose work it uses, where the player's data stays, and a way to start over. */
export function AboutTab(): JSX.Element {
  return (
    <div className="about">
      <h3 className="about__name">{APP_NAME}</h3>
      <p className="about__tagline">A piano you play with your computer keyboard.</p>

      <p className="about__line">
        Piano sound: Salamander Grand Piano by Alexander Holm (
        <a href={PIANO_SOUND_LICENCE_URL} target="_blank" rel="noreferrer">
          CC BY 3.0
        </a>
        )
      </p>
      <p className="about__line">Everything stays in your browser. Nothing is uploaded.</p>

      <div className="about__reset">
        <ConfirmButton label="Reset all settings" onConfirm={() => settingsStore.reset()} />
        <p className="settings-hint">
          Puts every setting and every key back to how it was at the start.
        </p>
      </div>
    </div>
  )
}
