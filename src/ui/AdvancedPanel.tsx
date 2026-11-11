import { useId } from 'react'
import type { JSX } from 'react'
import type { NoteNaming, ReleaseLength } from '../core/types'
import { ADVANCED_KEYS, MAX_TRANSPOSE, MIN_VELOCITY, settingsStore } from '../state/settings'
import type { Settings } from '../state/settings'
import { ConfirmButton, Field, PercentSlider, Segmented, Stepper, Switch } from './controls'
import { formatSigned } from './format'

interface AdvancedPanelProps {
  /** The id of the panel, which the toolbar's Advanced button refers to. */
  id: string
  settings: Settings
}

const NAMING_OPTIONS: readonly { value: NoteNaming; label: string }[] = [
  { value: 'letters', label: 'C D E' },
  { value: 'solfege', label: 'Do Ré Mi' },
]

const RELEASE_OPTIONS: readonly { value: ReleaseLength; label: string }[] = [
  { value: 'short', label: 'Short' },
  { value: 'normal', label: 'Normal' },
  { value: 'long', label: 'Long' },
]

/**
 * The settings an experienced player may want to tune. Closed by default;
 * every change is written straight to the settings and saved.
 */
export function AdvancedPanel({ id, settings }: AdvancedPanelProps): JSX.Element {
  const titleId = useId()

  return (
    <section id={id} className="advanced panel" aria-labelledby={titleId}>
      <header className="advanced__header">
        <h2 id={titleId} className="advanced__title">
          Advanced settings
        </h2>
        <p className="advanced__intro">
          Optional. The piano works well without changing any of these.
        </p>
      </header>

      <div className="advanced__options">
        <Field label="Touch" hint="How hard each note is played.">
          <PercentSlider
            label="Touch"
            min={MIN_VELOCITY}
            value={settings.velocity}
            onChange={(velocity) => settingsStore.set({ velocity })}
          />
        </Field>

        <Field label="Transpose" hint="Shifts every note up or down. 0 is normal.">
          <Stepper
            label="Transpose"
            value={settings.transpose}
            min={-MAX_TRANSPOSE}
            max={MAX_TRANSPOSE}
            format={formatSigned}
            onChange={(transpose) => settingsStore.set({ transpose })}
          />
        </Field>

        <Field label="Note names" hint="How notes are written on the piano.">
          <Segmented
            value={settings.noteNaming}
            options={NAMING_OPTIONS}
            onChange={(noteNaming) => settingsStore.set({ noteNaming })}
          />
        </Field>

        <Field label="Room echo" hint="Adds the echo of a room. 0 is none.">
          <PercentSlider
            label="Room echo"
            value={settings.reverb}
            onChange={(reverb) => settingsStore.set({ reverb })}
          />
        </Field>

        <Field label="Note fade-out" hint="How long a note rings after you let go.">
          <Segmented
            value={settings.release}
            options={RELEASE_OPTIONS}
            onChange={(release) => settingsStore.set({ release })}
          />
        </Field>

        <Field label="Light trails" hint="Glowing trails above the keys.">
          <Switch
            label="Light trails"
            on={settings.showTrails}
            onChange={(showTrails) => settingsStore.set({ showTrails })}
          />
        </Field>
      </div>

      {/* Last for reading and for the Tab key. The stylesheet puts it at the end of the top row. */}
      <div className="advanced__reset">
        <ConfirmButton
          label="Reset advanced settings"
          onConfirm={() => settingsStore.resetKeys(ADVANCED_KEYS)}
        />
      </div>
    </section>
  )
}
