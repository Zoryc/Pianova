import { pitchClass } from './notes'
import type { AccentChoice, AccentName, Midi } from './types'

/*
 * All light on screen comes from one base colour. A small palette is derived
 * from it, so that a colour chosen by the player works as well as the
 * built-in ones.
 */

export interface LightPalette {
  /** The colour itself: bars, lit keys. '#rrggbb'. */
  light: string
  /** Near-white tint of it: hot centres, sparks, the light line. */
  bright: string
  /** Dark, saturated shade of it: the far end of a bar, shadows. */
  deep: string
}

/** Base colour of each named accent. */
export const ACCENT_COLOURS: Readonly<Record<AccentName, string>> = Object.freeze({
  red: '#ff2a2a',
  amber: '#ffb020',
  blue: '#2f8bff',
  green: '#2bd96b',
  purple: '#a45cff',
  white: '#e8ecff',
})

/** Used in place of anything that is not a colour. */
const FALLBACK_COLOUR = ACCENT_COLOURS.red

/** The chrome's colour when every note has its own: a calm violet. */
const RAINBOW_CHROME_COLOUR = '#9c7aff'
/**
 * How much colour a rainbow note has: it is a pure hue with a fifth of white
 * in it (in CSS terms, 100% saturation and 60% lightness). A pure hue alone
 * is too dark for some notes: pure blue is hard to see on black.
 */
const RAINBOW_SATURATION = 0.8
const PITCH_CLASSES = 12

/**
 * The darkest a light may be (0 = black, 1 = white) and still show on the
 * black stage. It sits just under pure blue, the darkest colour that has a
 * channel at full strength, so no pure colour is ever changed.
 */
const MIN_LUMINANCE = 0.07

/** `bright` keeps this share of the colour's saturation: white with a hint of the colour. */
const BRIGHT_SATURATION = 0.2
/** `deep` is this much more saturated than the colour, and this fraction of its brightness. */
const DEEP_SATURATION = 2
const DEEP_VALUE = 0.55

/**
 * How many palettes of the player's own colours are remembered. Dragging
 * through a colour picker asks for hundreds of colours, one after the other.
 */
const MAX_OWN_PALETTES = 32

const HEX_COLOUR = /^#[0-9a-f]{6}$/i

/** Red, green and blue, each 0..1. */
type Rgb = readonly [red: number, green: number, blue: number]

/** Hue in degrees (0 = red, 120 = green, 240 = blue); saturation and value 0..1. */
interface Hsv {
  hue: number
  saturation: number
  value: number
}

/** True for exactly '#' followed by 6 hex digits, in either case. */
export function isHexColour(value: unknown): value is string {
  return typeof value === 'string' && HEX_COLOUR.test(value)
}

/**
 * The palette of any colour. `light` is the colour itself, except that a
 * colour too dark to show on the black stage is made lighter. Anything that
 * is not a '#rrggbb' colour gets the palette of the default red.
 */
export function paletteFrom(base: string): LightPalette {
  const light = visibleOnBlack(parseHex(base))
  const { hue, saturation, value } = toHsv(light)
  const bright = fromHsv({ hue, saturation: saturation * BRIGHT_SATURATION, value: 1 })
  const deep = fromHsv({
    hue,
    saturation: Math.min(1, saturation * DEEP_SATURATION),
    value: value * DEEP_VALUE,
  })
  return Object.freeze({ light: toHex(light), bright: toHex(bright), deep: toHex(deep) })
}

const DEFAULT_PALETTE = paletteFrom(FALLBACK_COLOUR)
const RAINBOW_CHROME_PALETTE = paletteFrom(RAINBOW_CHROME_COLOUR)

const NAMED_PALETTES: ReadonlyMap<string, LightPalette> = new Map(
  Object.entries(ACCENT_COLOURS).map(([name, colour]) => [name, paletteFrom(colour)]),
)

/** One palette per pitch class: C is red, each next note is 30 degrees further round the wheel. */
const RAINBOW_PALETTES: readonly LightPalette[] = Array.from(
  { length: PITCH_CLASSES },
  (_, pitch) => {
    const hue = (pitch * 360) / PITCH_CLASSES
    return paletteFrom(toHex(fromHsv({ hue, saturation: RAINBOW_SATURATION, value: 1 })))
  },
)

/** Palettes of the player's own colours, in the order they were first asked for. */
const ownPalettes = new Map<string, LightPalette>()

/**
 * The palette for the chrome and for anything that is not tied to one note.
 * For 'rainbow' this is a calm violet. The same object is returned for the
 * same inputs. (The player's own colours are remembered MAX_OWN_PALETTES at
 * a time: one that comes back after that many others gets a new, equal object.)
 */
export function paletteFor(accent: AccentChoice, customColour: string): LightPalette {
  if (accent === 'rainbow') return RAINBOW_CHROME_PALETTE
  if (accent === 'custom') return ownPalette(customColour)
  return NAMED_PALETTES.get(accent) ?? DEFAULT_PALETTE
}

/**
 * The palette for one note. Same as paletteFor, except for 'rainbow': each of
 * the 12 pitch classes has its own hue, evenly spread around the colour wheel
 * starting with red on C. The same object is returned for the same inputs.
 */
export function paletteForNote(
  midi: Midi,
  accent: AccentChoice,
  customColour: string,
): LightPalette {
  if (accent !== 'rainbow') return paletteFor(accent, customColour)
  return RAINBOW_PALETTES[pitchClass(midi)] ?? RAINBOW_CHROME_PALETTE
}

/** The text colour that reads best on `colour`: black on a light colour, white on a dark one. */
export function inkOn(colour: string): '#000000' | '#ffffff' {
  const background = luminance(parseHex(colour))
  return contrast(background, 0) >= contrast(1, background) ? '#000000' : '#ffffff'
}

/**
 * Looked up by the text exactly as it is given, so that asking again for the
 * colour in use (the sky does, for every bar it draws) is one quick lookup.
 */
function ownPalette(colour: string): LightPalette {
  const known = ownPalettes.get(colour)
  if (known) return known

  const palette = paletteFrom(colour)
  if (ownPalettes.size >= MAX_OWN_PALETTES) {
    const oldest = ownPalettes.keys().next().value
    if (oldest !== undefined) ownPalettes.delete(oldest)
  }
  ownPalettes.set(colour, palette)
  return palette
}

/** The colour itself, or a lighter version of it when it is too dark to show on the black stage. */
function visibleOnBlack(colour: Rgb): Rgb {
  const current = luminance(colour)
  if (current >= MIN_LUMINANCE) return colour

  // Black has no colour to keep: it becomes a grey.
  if (current === 0) {
    const grey = fromLinear(MIN_LUMINANCE)
    return [grey, grey, grey]
  }

  // More of the same light: every channel gains by the same factor. None can
  // pass full strength: a colour with a channel at full is above MIN_LUMINANCE.
  const gain = MIN_LUMINANCE / current
  return mapChannels(colour, (channel) => fromLinear(toLinear(channel) * gain))
}

/**
 * How bright a colour looks, 0 (black) to 1 (white): the "relative luminance"
 * of the web accessibility guidelines.
 */
function luminance([red, green, blue]: Rgb): number {
  return 0.2126 * toLinear(red) + 0.7152 * toLinear(green) + 0.0722 * toLinear(blue)
}

/** The contrast ratio of the web accessibility guidelines: 1 (the same) to 21 (white on black). */
function contrast(lighter: number, darker: number): number {
  return (lighter + 0.05) / (darker + 0.05)
}

/** A stored channel (0..1) as an amount of light (0..1): screens do not show numbers evenly. */
function toLinear(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
}

function fromLinear(amount: number): number {
  return amount <= 0.0031308 ? amount * 12.92 : 1.055 * amount ** (1 / 2.4) - 0.055
}

function toHsv([red, green, blue]: Rgb): Hsv {
  const value = Math.max(red, green, blue)
  const spread = value - Math.min(red, green, blue)
  // A grey has no hue.
  if (spread === 0) return { hue: 0, saturation: 0, value }

  let sixth: number
  if (value === red) sixth = ((green - blue) / spread + 6) % 6
  else if (value === green) sixth = (blue - red) / spread + 2
  else sixth = (red - green) / spread + 4
  return { hue: sixth * 60, saturation: spread / value, value }
}

function fromHsv({ hue, saturation, value }: Hsv): Rgb {
  const channel = (offset: number): number => {
    const position = (offset + hue / 60) % 6
    return value * (1 - saturation * Math.max(0, Math.min(position, 4 - position, 1)))
  }
  return [channel(5), channel(3), channel(1)]
}

function parseHex(colour: string): Rgb {
  const hex = isHexColour(colour) ? colour : FALLBACK_COLOUR
  const channel = (start: number): number => Number.parseInt(hex.slice(start, start + 2), 16) / 255
  return [channel(1), channel(3), channel(5)]
}

function toHex(colour: Rgb): string {
  const digits = (channel: number): string =>
    Math.round(Math.min(1, Math.max(0, channel)) * 255)
      .toString(16)
      .padStart(2, '0')
  return `#${digits(colour[0])}${digits(colour[1])}${digits(colour[2])}`
}

function mapChannels(colour: Rgb, change: (channel: number) => number): Rgb {
  return [change(colour[0]), change(colour[1]), change(colour[2])]
}
