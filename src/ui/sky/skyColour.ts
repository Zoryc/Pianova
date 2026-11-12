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

/**
 * The '#rrggbb' colour that lies `share` of the way from `from` (0) to `to`
 * (1), mixed the way a canvas gradient mixes two solid colours.
 */
export function mixColours(from: string, to: string, share: number): string {
  const along = Number.isFinite(share) ? Math.min(1, Math.max(0, share)) : 0
  let mixed = '#'
  for (let at = 1; at < 7; at += 2) {
    const start = Number.parseInt(from.slice(at, at + 2), 16)
    const end = Number.parseInt(to.slice(at, at + 2), 16)
    mixed += Math.round(start + (end - start) * along)
      .toString(16)
      .padStart(2, '0')
  }
  return mixed
}
