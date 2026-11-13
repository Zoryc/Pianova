import type { JSX } from 'react'
import type { BackgroundName, BarStyle, KeyEffect, SparksLevel } from '../../core/types'
import { settingsStore } from '../../state/settings'
import type { Settings } from '../../state/settings'
import { Field, PercentSlider, Segmented, Switch } from '../controls'
import { ColourSwatches } from './ColourSwatches'
import { SectionTitle } from './SectionTitle'
import { ThemeCards } from './ThemeCards'

const BACKGROUND_OPTIONS: readonly { value: BackgroundName; label: string }[] = [
  { value: 'black', label: 'Black' },
  { value: 'night', label: 'Night' },
  { value: 'stars', label: 'Stars' },
  { value: 'aurora', label: 'Aurora' },
]

const BAR_STYLE_OPTIONS: readonly { value: BarStyle; label: string }[] = [
  { value: 'solid', label: 'Solid' },
  { value: 'neon', label: 'Neon' },
]

const SPARKS_OPTIONS: readonly { value: SparksLevel; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'some', label: 'Some' },
  { value: 'lots', label: 'Lots' },
]

/** The effect the piano has always had comes first: it is the one a new player gets. */
const KEY_EFFECT_OPTIONS: readonly { value: KeyEffect; label: string }[] = [
  { value: 'glow', label: 'Glow' },
  { value: 'press', label: 'Press' },
  { value: 'edge', label: 'Edge' },
  { value: 'pop', label: 'Pop' },
]

/** The light and the screen: a theme to start from, then every part of it one by one. */
export function LookTab({ settings }: { settings: Settings }): JSX.Element {
  return (
    <>
      <ThemeCards settings={settings} />

      <SectionTitle>Fine-tune</SectionTitle>

      <Field label="Colour" hint="Rainbow gives every note its own colour.">
        <ColourSwatches
          label="Colour"
          accent={settings.accent}
          customColour={settings.customColour}
          onAccentChange={(accent) => settingsStore.set({ accent })}
          onCustomColourChange={(customColour) =>
            settingsStore.set({ accent: 'custom', customColour })
          }
        />
      </Field>

      <Field label="Glow" hint="How strongly the light glows.">
        <PercentSlider
          label="Glow"
          value={settings.glow}
          onChange={(glow) => settingsStore.set({ glow })}
        />
      </Field>

      <Field label="Background" hint="What is behind the notes.">
        <Segmented
          value={settings.background}
          options={BACKGROUND_OPTIONS}
          onChange={(background) => settingsStore.set({ background })}
        />
      </Field>

      <Field
        label="Light bars"
        hint="Bars of light for the notes you play and the falling notes of a song."
      >
        <Switch
          label="Light bars"
          on={settings.showTrails}
          onChange={(showTrails) => settingsStore.set({ showTrails })}
        />
      </Field>

      <Field
        label="Bar style"
        hint="Solid bars are filled with light. Neon bars are glowing outlines."
      >
        <Segmented
          value={settings.barStyle}
          options={BAR_STYLE_OPTIONS}
          onChange={(barStyle) => settingsStore.set({ barStyle })}
        />
      </Field>

      <Field label="Sparks" hint="Small sparks where the light meets the keys.">
        <Segmented
          value={settings.sparks}
          options={SPARKS_OPTIONS}
          onChange={(sparks) => settingsStore.set({ sparks })}
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

      <Field
        label="Key letters on falling notes"
        hint="Shows which computer key to press on each note of a song."
      >
        <Switch
          label="Key letters on falling notes"
          on={settings.showKeyHints}
          onChange={(showKeyHints) => settingsStore.set({ showKeyHints })}
        />
      </Field>

      <Field
        label="Show the notes being played"
        hint="Writes the names of the notes you play above the piano."
      >
        <Switch
          label="Show the notes being played"
          on={settings.showNoteNames}
          onChange={(showNoteNames) => settingsStore.set({ showNoteNames })}
        />
      </Field>

      <Field label="Hide the menu automatically" hint="The top bar hides when the mouse is still.">
        <Switch
          label="Hide the menu automatically"
          on={settings.autoHideMenu}
          onChange={(autoHideMenu) => settingsStore.set({ autoHideMenu })}
        />
      </Field>
    </>
  )
}
