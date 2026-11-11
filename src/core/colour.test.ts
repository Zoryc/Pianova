import { describe, expect, it } from 'vitest'
import {
  ACCENT_COLOURS,
  inkOn,
  isHexColour,
  paletteFor,
  paletteForNote,
  paletteFrom,
} from './colour'
import type { LightPalette } from './colour'
import type { AccentChoice, AccentName } from './types'

const ACCENT_NAMES = Object.keys(ACCENT_COLOURS) as AccentName[]
const PALETTE_PARTS = ['light', 'bright', 'deep'] as const
const BLACK = '#000000'
const WHITE = '#ffffff'

/** Red, green and blue of a '#rrggbb' colour, each 0..255. */
function channels(hex: string): [number, number, number] {
  const channel = (start: number): number => Number.parseInt(hex.slice(start, start + 2), 16)
  return [channel(1), channel(3), channel(5)]
}

function hex(red: number, green: number, blue: number): string {
  return `#${[red, green, blue].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`
}

/** The amount of red, green and blue light a colour gives off, each 0..1. */
function lightOf(colour: string): [number, number, number] {
  return channels(colour).map((channel) => {
    const stored = channel / 255
    return stored <= 0.04045 ? stored / 12.92 : ((stored + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
}

/** How bright a colour looks, 0 (black) to 1 (white), as the web accessibility guidelines measure it. */
function luminance(colour: string): number {
  const [red, green, blue] = lightOf(colour)
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

/**
 * The share of red, green and blue in the light a colour gives off. A colour
 * and a brighter version of the same colour have the same shares.
 */
function lightMix(colour: string): number[] {
  const light = lightOf(colour)
  const total = light[0] + light[1] + light[2]
  return light.map((amount) => amount / total)
}

/** Contrast ratio of two colours, from 1 (the same) to 21 (black and white). */
function contrast(one: string, other: string): number {
  const [darker, lighter] = [luminance(one), luminance(other)].sort((a, b) => a - b) as [
    number,
    number,
  ]
  return (lighter + 0.05) / (darker + 0.05)
}

/** Hue in degrees (0 = red, 120 = green, 240 = blue), or null for a grey. */
function hue(colour: string): number | null {
  const [red, green, blue] = channels(colour)
  const most = Math.max(red, green, blue)
  const spread = most - Math.min(red, green, blue)
  if (spread === 0) return null
  if (most === red) return (60 * ((green - blue) / spread) + 360) % 360
  if (most === green) return 60 * ((blue - red) / spread) + 120
  return 60 * ((red - green) / spread) + 240
}

/** 0 for a grey, 1 for a colour with no grey in it. */
function saturation(colour: string): number {
  const most = Math.max(...channels(colour))
  return most === 0 ? 0 : (most - Math.min(...channels(colour))) / most
}

/** Degrees between two hues, the short way round the wheel. */
function hueDistance(one: number, other: number): number {
  const apart = Math.abs(one - other) % 360
  return Math.min(apart, 360 - apart)
}

function isGrey(colour: string): boolean {
  return hue(colour) === null
}

/** Small seeded generator, so the random colours are the same on every run. */
function createRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let mixed = Math.imul(state ^ (state >>> 15), state | 1)
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61)
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296
  }
}

/** Colours a player could pick: an even grid over all of them, the extremes, and random ones. */
function sampleColours(): string[] {
  const steps = [0, 1, 17, 51, 85, 128, 170, 204, 238, 254, 255]
  const colours: string[] = []
  for (const red of steps) {
    for (const green of steps) {
      for (const blue of steps) colours.push(hex(red, green, blue))
    }
  }
  const random = createRandom(88)
  const channel = (): number => Math.floor(random() * 256)
  for (let count = 0; count < 2000; count++) colours.push(hex(channel(), channel(), channel()))
  return colours
}

const SAMPLES = sampleColours()

/** The least contrast with black that still shows on the stage: a little under pure blue's. */
const VISIBLE_ON_BLACK = 2.35

describe('ACCENT_COLOURS', () => {
  it('holds the base colour of each named accent', () => {
    expect(ACCENT_COLOURS).toEqual({
      red: '#ff2a2a',
      amber: '#ffb020',
      blue: '#2f8bff',
      green: '#2bd96b',
      purple: '#a45cff',
      white: '#e8ecff',
    })
    expect(Object.isFrozen(ACCENT_COLOURS)).toBe(true)
  })
})

describe('isHexColour', () => {
  it("accepts '#' followed by exactly 6 hex digits, in either case", () => {
    for (const colour of ['#ff2a2a', '#FF2A2A', '#Ff2a2A', BLACK, WHITE, '#012345', '#abcdef']) {
      expect(isHexColour(colour)).toBe(true)
    }
  })

  it('refuses every other text', () => {
    const wrongLength = ['', '#', '#fff', '#ff2a2', '#ff2a2a0', '#ff2a2a00']
    const wrongDigits = ['#ff2a2g', '#ff 2a2', '#ff-2a2', '#+f2a2a', '#0x2a2a', '#ｆｆ2a2a']
    const wrongStart = ['ff2a2a', 'ff2a2a#', '##f2a2a', '0xff2a2a']
    const padded = [' #ff2a2a', '#ff2a2a ', '#ff2a2a\n', '\n#ff2a2a', '#ff2a2a\n#ff2a2a']
    const otherNotations = ['red', 'rgb(255, 42, 42)', 'hsl(0 100% 58%)', 'transparent']
    const all = [...wrongLength, ...wrongDigits, ...wrongStart, ...padded, ...otherNotations]
    for (const text of all) expect(isHexColour(text)).toBe(false)
  })

  it('refuses anything that is not text', () => {
    const notText: unknown[] = [null, undefined, 0xff2a2a, 0, true, ['#ff2a2a'], { colour: BLACK }]
    for (const value of [...notText, new String('#ff2a2a')]) expect(isHexColour(value)).toBe(false)
  })
})

describe('paletteFrom', () => {
  it('gives the default look: red light, a pale hot centre, a dark red far end', () => {
    expect(paletteFrom(ACCENT_COLOURS.red)).toEqual({
      light: '#ff2a2a',
      bright: '#ffd4d4',
      deep: '#8c0000',
    })
  })

  it('makes every part a valid lower-case #rrggbb colour, for any colour', () => {
    for (const base of SAMPLES) {
      const palette = paletteFrom(base)
      expect(Object.keys(palette)).toEqual([...PALETTE_PARTS])
      for (const part of PALETTE_PARTS) expect(palette[part]).toMatch(/^#[0-9a-f]{6}$/)
    }
  })

  it('reads the colour in either case', () => {
    expect(paletteFrom('#FF2A2A')).toEqual(paletteFrom('#ff2a2a'))
    expect(paletteFrom('#A45CfF')).toEqual(paletteFrom('#a45cff'))
    expect(paletteFrom('#A45CFF').light).toBe('#a45cff')
  })

  it('keeps the colour itself as the light when it shows on black', () => {
    for (const name of ACCENT_NAMES) {
      expect(paletteFrom(ACCENT_COLOURS[name]).light).toBe(ACCENT_COLOURS[name])
    }
    const pure = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#00ffff', '#ff00ff', WHITE]
    for (const colour of pure) expect(paletteFrom(colour).light).toBe(colour)

    const showing = SAMPLES.filter((colour) => contrast(colour, BLACK) >= 2.5)
    expect(showing.length).toBeGreaterThan(1000)
    for (const colour of showing) expect(paletteFrom(colour).light).toBe(colour)
  })

  it('always gives a light that shows on the black stage', () => {
    for (const base of SAMPLES) {
      expect(contrast(paletteFrom(base).light, BLACK)).toBeGreaterThanOrEqual(VISIBLE_ON_BLACK)
    }
  })

  it('lifts a very dark colour', () => {
    const darkRed = paletteFrom('#200000').light
    expect(channels(darkRed)[0]).toBeGreaterThan(0x90)
    expect(channels(darkRed).slice(1)).toEqual([0, 0])

    const darkGreen = paletteFrom('#001000').light
    expect(channels(darkGreen)[1]).toBeGreaterThan(0x50)
    expect([channels(darkGreen)[0], channels(darkGreen)[2]]).toEqual([0, 0])

    expect(paletteFrom('#000040').light).toBe(paletteFrom('#000080').light)
    expect(hue(paletteFrom('#000040').light)).toBe(240)
  })

  it('lifts by adding more of the same light: the mix of red, green and blue is kept', () => {
    const dark = SAMPLES.filter((colour) => contrast(colour, BLACK) < 2 && colour !== BLACK)
    expect(dark.length).toBeGreaterThan(100)
    for (const colour of dark) {
      const lifted = paletteFrom(colour).light
      expect(luminance(lifted)).toBeGreaterThan(luminance(colour))
      lightMix(lifted).forEach((share, index) => {
        expect(Math.abs(share - (lightMix(colour)[index] ?? 0))).toBeLessThan(0.02)
      })
    }
  })

  it('lifts no more than needed: the darker of two shades never ends up the lighter one', () => {
    const shades = ['#050000', '#200000', '#600000', '#900000', '#c00000', '#ff0000']
    const lights = shades.map((shade) => luminance(paletteFrom(shade).light))
    expect(lights).toEqual([...lights].sort((a, b) => a - b))
  })

  it('turns black and near-black into a grey that shows', () => {
    for (const base of [BLACK, '#010101', '#0a0a0a', '#202020']) {
      const palette = paletteFrom(base)
      expect(isGrey(palette.light)).toBe(true)
      expect(contrast(palette.light, BLACK)).toBeGreaterThanOrEqual(VISIBLE_ON_BLACK)
      expect(palette.bright).toBe(WHITE)
      expect(isGrey(palette.deep)).toBe(true)
      expect(luminance(palette.deep)).toBeLessThan(luminance(palette.light))
    }
  })

  it('keeps a grey grey: lighter for the centre, darker for the far end', () => {
    expect(paletteFrom('#808080')).toEqual({ light: '#808080', bright: WHITE, deep: '#464646' })
  })

  it('copes with white and near-white', () => {
    expect(paletteFrom(WHITE)).toEqual({ light: WHITE, bright: WHITE, deep: '#8c8c8c' })

    const nearWhite = paletteFrom('#fff8f0')
    expect(nearWhite.light).toBe('#fff8f0')
    expect(luminance(nearWhite.bright)).toBeGreaterThanOrEqual(luminance(nearWhite.light))
    expect(contrast(nearWhite.deep, nearWhite.light)).toBeGreaterThan(2)
  })

  it('makes the bright part a near-white tint, never darker than the light', () => {
    for (const base of SAMPLES) {
      const { light, bright } = paletteFrom(base)
      expect(Math.min(...channels(bright))).toBeGreaterThanOrEqual(204)
      expect(Math.max(...channels(bright))).toBe(255)
      channels(bright).forEach((channel, index) => {
        expect(channel).toBeGreaterThanOrEqual(channels(light)[index] ?? 0)
      })
    }
  })

  it('makes the deep part a darker shade that is at least as saturated', () => {
    for (const base of SAMPLES) {
      const { light, deep } = paletteFrom(base)
      expect(luminance(deep)).toBeLessThan(luminance(light))
      channels(deep).forEach((channel, index) => {
        expect(channel).toBeLessThanOrEqual(channels(light)[index] ?? 0)
      })
      // Whole numbers 0..255 cannot hold a saturation exactly: allow for the rounding.
      expect(saturation(deep)).toBeGreaterThanOrEqual(saturation(light) - 0.02)
    }
    expect(saturation(paletteFrom('#ffb0c0').deep)).toBeGreaterThan(saturation('#ffb0c0') * 1.5)
  })

  it('keeps the hue of a colourful base in all three parts', () => {
    const colourful = SAMPLES.filter((colour) => saturation(colour) >= 0.5)
    expect(colourful.length).toBeGreaterThan(1000)
    for (const base of colourful) {
      const palette = paletteFrom(base)
      const own = hue(palette.light) ?? Number.NaN
      // The pale tint has few steps between its channels, so its hue is coarse.
      expect(hueDistance(hue(palette.bright) ?? Number.NaN, own)).toBeLessThan(10)
      expect(hueDistance(hue(palette.deep) ?? Number.NaN, own)).toBeLessThan(6)
    }
  })

  it('gives the red palette for anything that is not a colour', () => {
    const red = paletteFrom(ACCENT_COLOURS.red)
    const notColours: unknown[] = ['', 'red', '#fff', '#ff2a2g', 'rgb(0, 0, 255)', null, undefined, 7]
    for (const value of notColours) expect(paletteFrom(value as string)).toEqual(red)
  })

  it('hands out palettes that cannot be changed', () => {
    expect(Object.isFrozen(paletteFrom('#123456'))).toBe(true)
    expect(Object.isFrozen(paletteFrom('nope'))).toBe(true)
  })
})

describe('paletteFor', () => {
  it('gives each named accent the palette of its base colour', () => {
    for (const name of ACCENT_NAMES) {
      expect(paletteFor(name, '#123456')).toEqual(paletteFrom(ACCENT_COLOURS[name]))
    }
  })

  it("uses the player's own colour only for 'custom'", () => {
    expect(paletteFor('custom', '#00ffcc')).toEqual(paletteFrom('#00ffcc'))
    expect(paletteFor('custom', '#00FFCC')).toEqual(paletteFrom('#00ffcc'))
    expect(paletteFor('red', '#00ffcc')).toBe(paletteFor('red', '#ffffff'))
    expect(paletteFor('rainbow', '#00ffcc')).toBe(paletteFor('rainbow', '#ffffff'))
  })

  it("falls back to red when the player's own colour is not a colour", () => {
    for (const colour of ['', 'blue', '#12345', '#1234567']) {
      expect(paletteFor('custom', colour)).toEqual(paletteFrom(ACCENT_COLOURS.red))
    }
  })

  it('gives a calm violet for rainbow: a violet hue, softer than the notes', () => {
    const { light } = paletteFor('rainbow', '#ff2a2a')
    expect(hue(light)).toBeGreaterThan(240)
    expect(hue(light)).toBeLessThan(280)
    expect(saturation(light)).toBeLessThan(saturation(paletteForNote(60, 'rainbow', '').light))
    expect(contrast(light, BLACK)).toBeGreaterThan(4.5)
  })

  it('returns the same object for the same inputs', () => {
    const accents: AccentChoice[] = [...ACCENT_NAMES, 'custom', 'rainbow']
    for (const accent of accents) {
      expect(paletteFor(accent, '#3366cc')).toBe(paletteFor(accent, '#3366cc'))
    }
    const first = paletteFor('custom', '#3366cc')
    paletteFor('custom', '#cc6633')
    expect(paletteFor('custom', '#3366cc')).toBe(first)
  })

  it('stays correct after a long drag through a colour picker', () => {
    for (let step = 0; step < 500; step++) {
      const colour = hex(step % 256, (step * 7) % 256, (step * 13) % 256)
      const palette = paletteFor('custom', colour)
      expect(palette).toEqual(paletteFrom(colour))
      expect(paletteFor('custom', colour)).toBe(palette)
    }
  })

  it('gives the red palette for a choice it does not know', () => {
    for (const accent of ['', 'pink', 'constructor', '__proto__', undefined]) {
      expect(paletteFor(accent as AccentChoice, '#00ffcc')).toEqual(paletteFrom(ACCENT_COLOURS.red))
    }
  })
})

describe('paletteForNote', () => {
  /** One octave from middle C: one note of each pitch class, C first. */
  const OCTAVE = Array.from({ length: 12 }, (_, pitch) => 60 + pitch)

  it('is the same as paletteFor for every choice but rainbow', () => {
    for (const accent of [...ACCENT_NAMES, 'custom'] as AccentChoice[]) {
      for (const midi of [21, 60, 61, 108]) {
        expect(paletteForNote(midi, accent, '#00ffcc')).toBe(paletteFor(accent, '#00ffcc'))
      }
    }
  })

  it('gives each of the 12 notes its own hue, 30 degrees apart, with red on C', () => {
    const lights = OCTAVE.map((midi) => paletteForNote(midi, 'rainbow', '#00ffcc').light)
    expect(new Set(lights).size).toBe(12)
    expect(lights[0]).toBe('#ff3333')
    lights.forEach((light, pitch) => {
      expect(hueDistance(hue(light) ?? Number.NaN, pitch * 30)).toBeLessThan(1)
    })
  })

  it('uses the same saturation and brightness for every note', () => {
    for (const midi of OCTAVE) {
      const { light } = paletteForNote(midi, 'rainbow', '')
      expect(saturation(light)).toBeCloseTo(0.8, 2)
      expect(Math.max(...channels(light))).toBe(255)
    }
  })

  it('makes every rainbow colour read as light on black', () => {
    for (const midi of OCTAVE) {
      const palette = paletteForNote(midi, 'rainbow', '')
      expect(contrast(palette.light, BLACK)).toBeGreaterThanOrEqual(3)
      expect(palette).toEqual(paletteFrom(palette.light))
    }
  })

  it('gives a note the same colour in every octave', () => {
    for (let midi = 21; midi <= 108; midi++) {
      expect(paletteForNote(midi, 'rainbow', '')).toBe(paletteForNote(60 + (midi % 12), 'rainbow', ''))
    }
  })

  it('returns the same object for the same inputs, whatever the own colour is', () => {
    const seen = new Set<LightPalette>()
    for (const midi of OCTAVE) {
      const palette = paletteForNote(midi, 'rainbow', '#112233')
      expect(paletteForNote(midi, 'rainbow', '#112233')).toBe(palette)
      expect(paletteForNote(midi, 'rainbow', '#445566')).toBe(palette)
      expect(Object.isFrozen(palette)).toBe(true)
      seen.add(palette)
    }
    expect(seen.size).toBe(12)
  })

  it('still gives a palette for something that is not a note', () => {
    for (const midi of [Number.NaN, Number.POSITIVE_INFINITY, -1, 60.5, 1e9]) {
      const palette = paletteForNote(midi, 'rainbow', '')
      for (const part of PALETTE_PARTS) expect(isHexColour(palette[part])).toBe(true)
    }
    expect(paletteForNote(-1, 'rainbow', '')).toBe(paletteForNote(71, 'rainbow', ''))
    expect(paletteForNote(60.5, 'rainbow', '')).toBe(paletteForNote(60, 'rainbow', ''))
  })
})

describe('inkOn', () => {
  it('writes in black on light colours and in white on dark ones', () => {
    for (const colour of [WHITE, '#e8ecff', '#ffff00', '#00ff00', '#c0c0c0', '#ffb020']) {
      expect(inkOn(colour)).toBe(BLACK)
    }
    for (const colour of [BLACK, '#0000ff', '#400000', '#123456', '#4b4b4b', '#800080']) {
      expect(inkOn(colour)).toBe(WHITE)
    }
  })

  it('picks whichever of the two reads better', () => {
    for (const colour of SAMPLES) {
      const ink = inkOn(colour)
      const other = ink === BLACK ? WHITE : BLACK
      expect(contrast(ink, colour)).toBeGreaterThanOrEqual(contrast(other, colour))
    }
  })

  it('is readable on every colour a player can pick', () => {
    for (const colour of SAMPLES) expect(contrast(inkOn(colour), colour)).toBeGreaterThanOrEqual(4.5)
  })

  it('is readable on the light of every palette the app can show', () => {
    const lights = [
      ...ACCENT_NAMES.map((name) => paletteFor(name, '').light),
      paletteFor('rainbow', '').light,
      ...SAMPLES.slice(0, 300).map((colour) => paletteFrom(colour).light),
    ]
    for (const light of lights) expect(contrast(inkOn(light), light)).toBeGreaterThanOrEqual(4.5)
  })

  it('reads the colour in either case', () => {
    expect(inkOn('#FFFFFF')).toBe(BLACK)
    expect(inkOn('#0000FF')).toBe(WHITE)
  })

  it('treats anything that is not a colour as the default red', () => {
    for (const value of ['', 'white', '#fff', null, undefined]) {
      expect(inkOn(value as string)).toBe(inkOn(ACCENT_COLOURS.red))
    }
  })
})
