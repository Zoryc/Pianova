import type { JSX } from 'react'
import { PIANO_SIZES } from '../../core/layout'
import type { PianoSizeSetting } from '../../core/layout'
import type { KeyEffect, NoteNaming } from '../../core/types'
import { settingsStore } from '../../state/settings'
import type { Settings } from '../../state/settings'
import { Field, Segmented } from '../controls'
import { KeyStylePicker } from './KeyStylePicker'
import { LabelsSelect } from './LabelsSelect'

const SIZES: readonly PianoSizeSetting[] = ['auto', ...PIANO_SIZES]

/** The shared control takes its choices as text, so each size is offered by its number as text. */
const SIZE_OPTIONS: readonly { value: string; label: string }[] = SIZES.map((size) => ({
  value: String(size),
  label: size === 'auto' ? 'Auto' : String(size),
}))

/** The effect the piano has always had comes first: it is the one a new player gets. */
const KEY_EFFECT_OPTIONS: readonly { value: KeyEffect; label: string }[] = [
  { value: 'glow', label: 'Glow' },
  { value: 'press', label: 'Press' },
  { value: 'fill', label: 'Fill' },
  { value: 'ripple', label: 'Ripple' },
  { value: 'edge', label: 'Edge' },
  { value: 'pop', label: 'Pop' },
]

const NAMING_OPTIONS: readonly { value: NoteNaming; label: string }[] = [
  { value: 'letters', label: 'C D E' },
  { value: 'solfege', label: 'Do Ré Mi' },
]

/** Everything about the piano itself: its size, its keys and what is written on them. */
export function PianoTab({ settings }: { settings: Settings }): JSX.Element {
  function choosePianoSize(choice: string): void {
    const pianoSize = SIZES.find((size) => String(size) === choice)
    if (pianoSize !== undefined) settingsStore.set({ pianoSize })
  }

  return (
    <>
      <Field
        label="Piano size"
        hint="How many keys the piano has. Auto picks the biggest piano that fits your window. 88 is a full piano."
      >
        <Segmented
          value={String(settings.pianoSize)}
          options={SIZE_OPTIONS}
          onChange={choosePianoSize}
        />
        <span className="settings-unit">keys</span>
      </Field>

      <Field
        label="Key style"
        hint="Classic is ivory and black. Midnight is dark keys that glow. Glass is see-through."
      >
        <KeyStylePicker
          value={settings.keyStyle}
          onChange={(keyStyle) => settingsStore.set({ keyStyle })}
        />
      </Field>

      <Field
        label="Key effect"
        hint="What a key does when you play it. Try each one on the piano below."
      >
        <Segmented
          value={settings.keyEffect}
          options={KEY_EFFECT_OPTIONS}
          onChange={(keyEffect) => settingsStore.set({ keyEffect })}
        />
      </Field>

      <Field label="Labels on the keys">
        <LabelsSelect
          label="Labels on the keys"
          value={settings.labelMode}
          onChange={(labelMode) => settingsStore.set({ labelMode })}
        />
      </Field>

      <Field label="Note names" hint="How notes are written on the piano.">
        <Segmented
          value={settings.noteNaming}
          options={NAMING_OPTIONS}
          onChange={(noteNaming) => settingsStore.set({ noteNaming })}
        />
      </Field>
    </>
  )
}
