import { ACCENT_COLOURS, paletteFrom } from '../../core/colour'

/*
 * The few things the sky needs to know about colour beyond the palettes of
 * src/core/colour.ts.
 */

/** The blue-black of the night sky: the darkest shade of the built-in blue, used very thinly. */
export const NIGHT_COLOUR = paletteFrom(ACCENT_COLOURS.blue).deep

/**
 * A '#rrggbb' colour made see-through: 0 is invisible, 1 is solid. The
 * result is the same colour written with a fourth pair of digits, which is
 * how a canvas is told how solid a colour is.
 */
export function withAlpha(colour: string, alpha: number): string {
  const solid = Number.isFinite(alpha) ? Math.min(1, Math.max(0, alpha)) : 1
  return `${colour}${Math.round(solid * 255)
    .toString(16)
    .padStart(2, '0')}`
}

/** How much each of red, green and blue adds to how light a colour looks. */
const CHANNEL_WEIGHTS = [0.2126, 0.7152, 0.0722] as const

/** How light a '#rrggbb' colour looks to the eye: 0 for black, 1 for white. */
export function lightnessOf(colour: string): number {
  let lightness = 0
  for (const [channel, weight] of CHANNEL_WEIGHTS.entries()) {
    const value = Number.parseInt(colour.slice(1 + channel * 2, 3 + channel * 2), 16) / 255
    // A screen does not show half the number as half the light: this is the usual correction.
    const linear = value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
    lightness += weight * linear
  }
  return lightness
}
