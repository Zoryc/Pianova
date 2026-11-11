/**
 * The colours a player can pick, tried over the whole colour cube: none of
 * them may give a light that cannot be seen on the black stage, text that
 * cannot be read on a control filled with the light, or anything that is not
 * a colour. Then the odd inputs: capital letters, damaged text, notes that
 * are not on any piano.
 */
import { describe, expect, it } from 'vitest'
import {
  ACCENT_COLOURS,
  inkOn,
  isHexColour,
  paletteFor,
  paletteForNote,
  paletteFrom,
} from './colour'
import type { AccentName } from './types'

const LOWER_CASE_COLOUR = /^#[0-9a-f]{6}$/

function channels(colour: string): [number, number, number] {
  const channel = (start: number): number => Number.parseInt(colour.slice(start, start + 2), 16)
  return [channel(1), channel(3), channel(5)]
}

/** How bright a colour looks, 0 (black) to 1 (white), as the accessibility guidelines measure it. */
function luminance(colour: string): number {
  const light = (value: number): number => {
    const share = value / 255
    return share <= 0.04045 ? share / 12.92 : ((share + 0.055) / 1.055) ** 2.4
  }
  const [red, green, blue] = channels(colour)
  return 0.2126 * light(red) + 0.7152 * light(green) + 0.0722 * light(blue)
}

/** The contrast of two colours: 1 (the same) to 21 (black on white). */
function contrast(one: string, other: string): number {
  const [darker, lighter] = [luminance(one), luminance(other)].sort((a, b) => a - b)
  return ((lighter ?? 0) + 0.05) / ((darker ?? 0) + 0.05)
}

function hex(red: number, green: number, blue: number): string {
  return `#${[red, green, blue].map((value) => value.toString(16).padStart(2, '0')).join('')}`
}

/** Every fifth step of every channel, and the last one: about 140,000 colours. */
function* colourCube(): Generator<string> {
  const steps = [...Array.from({ length: 51 }, (_, index) => index * 5), 255]
  for (const red of steps) for (const green of steps) for (const blue of steps) yield hex(red, green, blue)
}

describe('any colour of the whole cube', () => {
  it('gives three real colours, a light that shows on black and readable writing on it', () => {
    const problems: string[] = []

    for (const colour of colourCube()) {
      const palette = paletteFrom(colour)
      const { light, bright, deep } = palette
      if (![light, bright, deep].every((part) => LOWER_CASE_COLOUR.test(part))) {
        problems.push(`${colour}: not a colour in ${JSON.stringify(palette)}`)
        continue
      }
      // The darkest light allowed is a little under pure blue: 2.3 to 1 against black.
      if (contrast(light, '#000000') < 2.3) problems.push(`${colour}: light ${light} is too dark`)
      if (contrast(inkOn(light), light) < 4.5) problems.push(`${colour}: no readable ink on ${light}`)
      if (luminance(bright) < luminance(light)) problems.push(`${colour}: bright darker than light`)
      if (luminance(bright) < 0.6) problems.push(`${colour}: bright ${bright} is not near white`)
      if (luminance(deep) > luminance(light)) problems.push(`${colour}: deep lighter than light`)
    }

    expect(problems.slice(0, 10)).toEqual([])
  })

  it('is left exactly as picked unless it is too dark to show', () => {
    const changed: string[] = []

    for (const colour of colourCube()) {
      const { light } = paletteFrom(colour)
      if (light !== colour && contrast(colour, '#000000') >= 2.5) changed.push(`${colour} -> ${light}`)
    }

    expect(changed.slice(0, 10)).toEqual([])
  })
})

describe('the colours at the edges', () => {
  it('turns black into a grey and keeps white white', () => {
    expect(paletteFrom('#000000').light).toMatch(/^#([0-9a-f]{2})\1\1$/)
    expect(paletteFrom('#000000').light).not.toBe('#000000')
    expect(paletteFrom('#ffffff')).toEqual({ light: '#ffffff', bright: '#ffffff', deep: '#8c8c8c' })
  })

  it('writes in white on a dark colour of the player and in black on a pale one', () => {
    expect(inkOn(paletteFor('custom', '#000000').light)).toBe('#ffffff')
    expect(inkOn(paletteFor('custom', '#00007f').light)).toBe('#ffffff')
    expect(inkOn(paletteFor('custom', '#ffffff').light)).toBe('#000000')
    expect(inkOn(paletteFor('custom', '#ffff99').light)).toBe('#000000')
  })

  it('reads capital letters as the same colour', () => {
    expect(paletteFor('custom', '#AABBCC')).toEqual(paletteFor('custom', '#aabbcc'))
    expect(inkOn('#AABBCC')).toBe(inkOn('#aabbcc'))
  })

  it('leaves the six named colours exactly as the spec gives them', () => {
    const spec: Record<AccentName, string> = {
      red: '#ff2a2a',
      amber: '#ffb020',
      blue: '#2f8bff',
      green: '#2bd96b',
      purple: '#a45cff',
      white: '#e8ecff',
    }
    expect(ACCENT_COLOURS).toEqual(spec)
    for (const [name, colour] of Object.entries(spec)) {
      expect(paletteFor(name as AccentName, '#123456').light).toBe(colour)
      // Black writing reads on every one of them, the white one included.
      expect(inkOn(colour)).toBe('#000000')
    }
  })
})

describe('text that is not a colour', () => {
  const NOT_COLOURS = ['', 'red', '#fff', '#ff2a2a\n', ' #ff2a2a', '#ff2a2a00', 'ff2a2a', '#ggg000']

  it('is refused by isHexColour, whatever it is', () => {
    for (const text of NOT_COLOURS) expect(isHexColour(text), JSON.stringify(text)).toBe(false)
    for (const other of [null, undefined, 0xff2a2a, ['#ff2a2a'], { colour: '#ff2a2a' }]) {
      expect(isHexColour(other)).toBe(false)
    }
  })

  it('gives the default red light instead of an error', () => {
    const red = paletteFrom('#ff2a2a')

    for (const text of NOT_COLOURS) {
      expect(paletteFrom(text)).toEqual(red)
      expect(paletteFor('custom', text)).toEqual(red)
      expect(inkOn(text)).toBe('#000000')
    }
    expect(paletteFor('no such choice' as never, '#00ff00')).toEqual(red)
  })
})

describe('the rainbow', () => {
  it('has twelve different colours, the same in every octave, all showing on black', () => {
    const octave = Array.from({ length: 12 }, (_, note) => paletteForNote(60 + note, 'rainbow', ''))

    expect(new Set(octave.map((palette) => palette.light)).size).toBe(12)
    for (const [note, palette] of octave.entries()) {
      expect(paletteForNote(note, 'rainbow', '#abcdef')).toBe(palette)
      expect(paletteForNote(108 - ((108 - note) % 12), 'rainbow', '')).toBe(palette)
      expect(contrast(palette.light, '#000000')).toBeGreaterThan(3)
      expect(contrast(inkOn(palette.light), palette.light)).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('gives a colour, never an error, for a note that is on no piano', () => {
    for (const midi of [-1, -13, 1.5, 1e9, Number.NaN, Number.POSITIVE_INFINITY]) {
      const palette = paletteForNote(midi, 'rainbow', '')
      expect(palette.light, String(midi)).toMatch(LOWER_CASE_COLOUR)
    }
  })

  it('colours the menu and the panels a calm violet with readable writing', () => {
    const chrome = paletteFor('rainbow', '#00ff00')
    expect(chrome.light).toBe('#9c7aff')
    expect(contrast(inkOn(chrome.light), chrome.light)).toBeGreaterThanOrEqual(4.5)
  })
})

describe('a long drag through the colour picker', () => {
  it('gives equal colours for a colour that comes back after hundreds of others', () => {
    const first = paletteFor('custom', '#102030')
    const copy = { ...first }

    for (let step = 0; step < 500; step += 1) {
      paletteFor('custom', hex(step % 256, (step * 7) % 256, (step * 13) % 256))
    }

    expect(paletteFor('custom', '#102030')).toEqual(copy)
    // What was handed out earlier is never changed behind the caller's back.
    expect(first).toEqual(copy)
    expect(Object.isFrozen(first)).toBe(true)
  })

  it('hands out the very same object while the colour stays the same', () => {
    const now = paletteFor('custom', '#405060')
    for (let frame = 0; frame < 100; frame += 1) {
      expect(paletteForNote(60 + (frame % 12), 'custom', '#405060')).toBe(now)
    }
  })
})
