import { ACCENT_COLOURS, paletteFrom } from '../../core/colour'

/*
 * The two things the sky needs to know about colour beyond the palettes of
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
