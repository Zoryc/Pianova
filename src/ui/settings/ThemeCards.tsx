import { memo } from 'react'
import type { CSSProperties, JSX } from 'react'
import { ACCENT_COLOURS, paletteFor, paletteForNote } from '../../core/colour'
import type { LightPalette } from '../../core/colour'
import type { PianoRange } from '../../core/layout'
import { keyRectOf } from '../../core/pianoGeometry'
import type { Midi, SparksLevel } from '../../core/types'
import { settingsStore } from '../../state/settings'
import type { Settings } from '../../state/settings'
import { LOOK_THEMES, matchingTheme } from '../../state/themes'
import type { LookTheme } from '../../state/themes'
import { ChoiceCard, ChoiceGroup, CustomLabel } from './ChoiceGroup'
import { MiniKeys } from './MiniKeys'

/**
 * The themes, one card each. A click applies the look of the theme; the card
 * of the theme the settings match is marked, and when they match none the
 * group says "Custom".
 */
export function ThemeCards({ settings }: { settings: Settings }): JSX.Element {
  const current = matchingTheme(settings)

  return (
    <ChoiceGroup
      label="Theme"
      hint="Pick a look. You can fine-tune it below."
      aside={current === null && <CustomLabel />}
    >
      <div className="choice-cards choice-cards--themes">
        {LOOK_THEMES.map((theme) => (
          <ChoiceCard
            key={theme.id}
            name={theme.name}
            description={theme.description}
            chosen={theme.id === current}
            onClick={() => applyTheme(theme)}
          >
            <ThemePreview look={theme.values} />
          </ChoiceCard>
        ))}
      </div>
    </ChoiceGroup>
  )
}

/**
 * Saves the look of a theme. "Your colour" is not part of it: the player made
 * that colour, and it is still theirs after a theme was tried. (In a change to
 * the settings, `undefined` means "leave this one as it is".)
 */
function applyTheme(theme: LookTheme): void {
  settingsStore.set({ ...theme.values, customColour: undefined })
}

type Look = LookTheme['values']

/** One octave of piano, C to B: enough to show a key style. */
const PREVIEW_RANGE: PianoRange = { first: 60, last: 71 }

/** A bar of light in the picture. `height` and `lift` are shares of the height of the sky. */
interface PreviewBar {
  midi: Midi
  height: number
  /** How far the bar has risen above the keys. 0 for a note still held, whose key is lit. */
  lift: number
}

const PREVIEW_BARS: readonly PreviewBar[] = [
  { midi: 60, height: 0.5, lift: 0 },
  { midi: 64, height: 0.3, lift: 0.52 },
  { midi: 67, height: 0.72, lift: 0 },
  { midi: 70, height: 0.26, lift: 0.36 },
]

/** Where the sparks are, as shares of the sky from its left and bottom edges: by the held notes. */
const PREVIEW_SPARKS: readonly { x: number; y: number }[] = [
  { x: 0.05, y: 0.12 },
  { x: 0.62, y: 0.2 },
  { x: 0.7, y: 0.07 },
  { x: 0.12, y: 0.3 },
  { x: 0.01, y: 0.24 },
  { x: 0.58, y: 0.4 },
  { x: 0.74, y: 0.3 },
  { x: 0.67, y: 0.52 },
]

/** How many of those sparks each setting shows. */
const SPARK_COUNTS: Readonly<Record<SparksLevel, number>> = { off: 0, some: 3, lots: 8 }

/**
 * A tiny picture of the stage as a theme makes it look: its background, its
 * bars of light, its sparks and its keys, all in the theme's own colours.
 * The stylesheet draws it; the colours are handed to it as variables.
 */
const ThemePreview = memo(function ThemePreview({ look }: { look: Look }): JSX.Element {
  const chrome = paletteFor(look.accent, look.customColour)
  const noteLight = (midi: Midi): LightPalette =>
    paletteForNote(midi, look.accent, look.customColour)
  const heldNotes = PREVIEW_BARS.filter((bar) => bar.lift === 0).map((bar) => bar.midi)
  const style = {
    '--preview-light': chrome.light,
    '--preview-bright': chrome.bright,
    '--preview-deep': chrome.deep,
    '--preview-glow': look.glow,
    // The blue that the night sky is a very dark shade of.
    '--preview-night': ACCENT_COLOURS.blue,
  } as CSSProperties

  return (
    <span
      className="theme-preview"
      data-background={look.background}
      data-bar-style={look.barStyle}
      style={style}
      aria-hidden="true"
    >
      <span className="theme-preview__sky">
        {PREVIEW_BARS.map((bar) => (
          <span key={bar.midi} className="theme-preview__bar" style={barStyle(bar, noteLight)} />
        ))}
        {PREVIEW_SPARKS.slice(0, SPARK_COUNTS[look.sparks]).map((spark) => (
          <span
            key={`${spark.x}:${spark.y}`}
            className="theme-preview__spark"
            style={{ left: percent(spark.x), bottom: percent(spark.y) }}
          />
        ))}
      </span>
      <span className="theme-preview__line" />
      <MiniKeys
        keyStyle={look.keyStyle}
        range={PREVIEW_RANGE}
        lit={new Map(heldNotes.map((midi) => [midi, noteLight(midi)]))}
      />
    </span>
  )
})

/** A bar stands over its own key, like the bars of the real sky. */
function barStyle(bar: PreviewBar, noteLight: (midi: Midi) => LightPalette): CSSProperties {
  const rect = keyRectOf(bar.midi, PREVIEW_RANGE)
  const light = noteLight(bar.midi)
  return {
    left: percent(rect?.left ?? 0),
    width: percent(rect?.width ?? 0),
    bottom: percent(bar.lift),
    height: percent(bar.height),
    '--bar-light': light.light,
    '--bar-bright': light.bright,
    '--bar-deep': light.deep,
  } as CSSProperties
}

function percent(fraction: number): string {
  return `${fraction * 100}%`
}
