import { paletteFor } from '../core/colour'
import { DEFAULT_SETTINGS } from './settings'
import type { Settings } from './settings'

/*
 * A theme is a named set of look settings applied with one click. Everything
 * a theme sets can still be fine-tuned afterwards, one setting at a time.
 */

export type ThemeId = 'ember' | 'midnight' | 'aurora' | 'gold' | 'mono' | 'prism'

export interface LookTheme {
  id: ThemeId
  name: string
  description: string
  values: Pick<
    Settings,
    'accent' | 'customColour' | 'glow' | 'background' | 'barStyle' | 'sparks' | 'keyStyle'
  >
}

type LookValues = LookTheme['values']

/** Two glow strengths closer than this are the same: far less than one step of the slider. */
const NUMBER_TOLERANCE = 0.001

/**
 * `customColour` is not chosen theme by theme, and it is never saved when a
 * theme is applied: "Your colour" stays the player's own. It is the colour of
 * the theme's own light, and is only there so that a theme is a complete look
 * for its preview picture.
 */
function theme(
  id: ThemeId,
  name: string,
  description: string,
  look: Omit<LookValues, 'customColour'>,
): LookTheme {
  const customColour = paletteFor(look.accent, DEFAULT_SETTINGS.customColour).light
  return Object.freeze({ id, name, description, values: Object.freeze({ ...look, customColour }) })
}

/** In the order shown to the player. The first one is the look of the default settings. */
export const LOOK_THEMES: readonly LookTheme[] = Object.freeze([
  theme('ember', 'Ember', 'Red light on black.', {
    accent: 'red',
    background: 'black',
    barStyle: 'solid',
    sparks: 'some',
    keyStyle: 'classic',
    glow: 0.6,
  }),
  theme('midnight', 'Midnight', 'Blue light under the stars.', {
    accent: 'blue',
    background: 'stars',
    barStyle: 'solid',
    sparks: 'some',
    keyStyle: 'midnight',
    glow: 0.7,
  }),
  theme('aurora', 'Aurora', 'Soft purple haze and glass keys.', {
    accent: 'purple',
    background: 'aurora',
    barStyle: 'neon',
    sparks: 'some',
    keyStyle: 'glass',
    glow: 0.8,
  }),
  theme('gold', 'Gold', 'Warm gold and plenty of sparks.', {
    accent: 'amber',
    background: 'night',
    barStyle: 'solid',
    sparks: 'lots',
    keyStyle: 'classic',
    glow: 0.6,
  }),
  theme('mono', 'Mono', 'White lines, nothing else.', {
    accent: 'white',
    background: 'black',
    barStyle: 'neon',
    sparks: 'off',
    keyStyle: 'midnight',
    glow: 0.4,
  }),
  theme('prism', 'Prism', 'Every note has its own colour.', {
    accent: 'rainbow',
    background: 'black',
    barStyle: 'solid',
    sparks: 'some',
    keyStyle: 'classic',
    glow: 0.6,
  }),
])

/** The theme whose values all match the current settings, or null ("Custom"). */
export function matchingTheme(settings: Settings): ThemeId | null {
  return LOOK_THEMES.find((candidate) => hasLook(settings, candidate.values))?.id ?? null
}

function hasLook(settings: Settings, look: LookValues): boolean {
  const keys = Object.keys(look) as (keyof LookValues)[]
  return keys.every((key) => {
    // The player's own colour is not on screen unless the light is set to it.
    if (key === 'customColour' && look.accent !== 'custom') return true
    return sameValue(settings[key], look[key])
  })
}

function sameValue(one: string | number, other: string | number): boolean {
  if (typeof one === 'number' && typeof other === 'number') {
    return Math.abs(one - other) < NUMBER_TOLERANCE
  }
  return one === other
}
