import type { JSX } from 'react'
import type { ReleaseLength } from '../../core/types'
import { MAX_TRANSPOSE, MIN_VELOCITY, settingsStore } from '../../state/settings'
import type { Settings } from '../../state/settings'
import { Field, PercentSlider, Segmented, Stepper, Switch } from '../controls'
import { formatSigned } from '../format'
import { SectionTitle } from './SectionTitle'

const RELEASE_OPTIONS: readonly { value: ReleaseLength; label: string }[] = [
  { value: 'short', label: 'Short' },
  { value: 'normal', label: 'Normal' },
  { value: 'long', label: 'Long' },
]

/** How the piano sounds. The everyday options first, the ones for fine-tuning after. */
export function SoundTab({ settings }: { settings: Settings }): JSX.Element {
  return (
    <>
      <Field label="Volume">
        <PercentSlider
          label="Volume"
          value={settings.volume}
          onChange={(volume) => settingsStore.set({ volume })}
        />
      </Field>

      <Field
        label="Sustain"
        hint="Notes keep ringing after you let go. Space also turns it on and off."
      >
        <Switch
          label="Sustain"
          on={settings.sustain}
          onChange={(sustain) => settingsStore.set({ sustain })}
        />
      </Field>

      <SectionTitle>Advanced</SectionTitle>

      <Field label="Touch" hint="How hard each note is played.">
        <PercentSlider
          label="Touch"
          min={MIN_VELOCITY}
          value={settings.velocity}
          onChange={(velocity) => settingsStore.set({ velocity })}
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
    </>
  )
}
