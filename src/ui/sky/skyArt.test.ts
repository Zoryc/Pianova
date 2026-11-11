// @vitest-environment jsdom
/**
 * The ready-made parts of the sky: its colours (skyColour.ts), the pictures
 * and gradients made once per colour (skySprites.ts), and the background
 * (skyBackdrop.ts), all on the stand-in canvas of skyTestKit.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isHexColour, paletteFor, paletteFrom } from '../../core/colour'
import { pianoRange } from '../../core/layout'
import { keyRectOf } from '../../core/pianoGeometry'
import type { BackgroundName } from '../../core/types'
import { paintBackdrop, sameBackdrop } from './skyBackdrop'
import type { BackdropSpec } from './skyBackdrop'
import { NIGHT_COLOUR, withAlpha } from './skyColour'
import { BLOOM_PICTURE_SIZE, SPARK_PICTURE_SIZE, createSkyArt } from './skySprites'
import type { ArtSpec } from './skySprites'
import { FakeGradient, installFakeBrowser } from './skyTestKit'
import type { FakeBrowser } from './skyTestKit'

const FULL = pianoRange(88, 3)
const SMALL = pianoRange(37, 3)
const RED = paletteFor('red', '')
const BLUE = paletteFor('blue', '')

let browser: FakeBrowser

beforeEach(() => {
  browser = installFakeBrowser()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('withAlpha', () => {
  it('writes how solid a colour is as a fourth pair of digits', () => {
    expect(withAlpha('#ff2a2a', 1)).toBe('#ff2a2aff')
    expect(withAlpha('#ff2a2a', 0)).toBe('#ff2a2a00')
    expect(withAlpha('#ff2a2a', 0.5)).toBe('#ff2a2a80')
    expect(withAlpha('#000080', 0.04)).toBe('#0000800a')
  })

  it('keeps odd amounts inside 0..1', () => {
    expect(withAlpha('#123456', -2)).toBe('#12345600')
    expect(withAlpha('#123456', 9)).toBe('#123456ff')
    expect(withAlpha('#123456', Number.NaN)).toBe('#123456ff')
  })
})

describe('the colour of the night', () => {
  it('is a dark blue taken from the palette of the built-in blue', () => {
    expect(isHexColour(NIGHT_COLOUR)).toBe(true)
    const [red, green, blue] = [1, 3, 5].map((at) => Number.parseInt(NIGHT_COLOUR.slice(at, at + 2), 16))
    expect(blue).toBeGreaterThan(red ?? 255)
    expect(blue).toBeGreaterThan(green ?? 255)
    expect(blue).toBeLessThan(200)
  })
})

describe('the art made for each colour', () => {
  const spec: ArtSpec = {
    skyHeight: 600,
    whiteBarWidth: 21,
    blackBarWidth: 13,
    barStyle: 'solid',
    glow: 0.6,
    pixelRatio: 1,
  }

  function newArt() {
    const canvas = document.createElement('canvas')
    const context = browser.contextOf(canvas)
    const art = createSkyArt(context as unknown as CanvasRenderingContext2D)
    return { art, context }
  }

  it('is made once per colour and remembered', () => {
    const { art } = newArt()
    art.prepare(spec)
    const red = art.of(RED)
    expect(art.of(RED)).toBe(red)
    expect(art.of(BLUE)).not.toBe(red)
    art.prepare({ ...spec })
    expect(art.of(RED)).toBe(red)
  })

  it('is made again when the size, the style, the glow or the pixel ratio changes', () => {
    const changes: Partial<ArtSpec>[] = [
      { skyHeight: 500 },
      { whiteBarWidth: 30 },
      { blackBarWidth: 18 },
      { barStyle: 'neon' },
      { glow: 0.7 },
      { pixelRatio: 2 },
    ]
    for (const change of changes) {
      const { art } = newArt()
      art.prepare(spec)
      const before = art.of(RED)
      art.prepare({ ...spec, ...change })
      expect(art.of(RED)).not.toBe(before)
    }
  })

  it('fills bars from the deep shade far from the line to the bright one on it, over the whole sky', () => {
    const { art } = newArt()
    art.prepare(spec)
    const fill = art.of(RED).barFill as unknown as FakeGradient
    expect(fill.span).toEqual([0, 0, 0, 600])
    expect(fill.stops[0]?.[1]).toBe(RED.deep)
    expect(fill.stops.at(-1)).toEqual([1, RED.bright])
    expect(fill.stops.filter(([, colour]) => colour === RED.light)).toHaveLength(2)
    const offsets = fill.stops.map(([offset]) => offset)
    expect(offsets).toEqual([...offsets].sort((a, b) => a - b))
  })

  it('makes a glow for white-key bars and one for black-key bars, wide enough to hold them', () => {
    const { art } = newArt()
    art.prepare(spec)
    const { whiteGlow, blackGlow } = art.of(RED)
    expect(whiteGlow?.width).toBeCloseTo(21 + (whiteGlow?.margin ?? 0) * 2, 10)
    expect(blackGlow?.width).toBeCloseTo(13 + (blackGlow?.margin ?? 0) * 2, 10)
    expect(whiteGlow?.margin).toBeGreaterThan(5)
    expect(whiteGlow?.image.width).toBeGreaterThanOrEqual(whiteGlow?.width ?? 0)
    expect(whiteGlow?.image.height).toBeGreaterThanOrEqual(whiteGlow?.height ?? 0)
    // Two ends and a strip to stretch between them.
    expect(whiteGlow?.height).toBeGreaterThan(((whiteGlow?.cap ?? 0) + (whiteGlow?.margin ?? 0)) * 2)
  })

  it('draws the glow sharper on a denser screen', () => {
    const { art } = newArt()
    art.prepare(spec)
    const once = art.of(RED).whiteGlow
    art.prepare({ ...spec, pixelRatio: 2 })
    const twice = art.of(RED).whiteGlow
    expect(twice?.scale).toBe(2)
    expect(twice?.width).toBe(once?.width)
    expect(twice?.image.width).toBe((once?.image.width ?? 0) * 2)
  })

  it('reaches further the stronger the glow, and makes none at glow 0', () => {
    const { art } = newArt()
    art.prepare({ ...spec, glow: 0.3 })
    const faint = art.of(RED)
    art.prepare({ ...spec, glow: 1 })
    const strong = art.of(RED)
    expect(strong.whiteGlow?.margin).toBeGreaterThan(faint.whiteGlow?.margin ?? 0)
    expect(strong.bloom).not.toBeNull()

    art.prepare({ ...spec, glow: 0 })
    const none = art.of(RED)
    expect(none.whiteGlow).toBeNull()
    expect(none.blackGlow).toBeNull()
    expect(none.bloom).toBeNull()
    // Sparks are not glow: they stay.
    expect(none.spark).not.toBeNull()
  })

  it('blurs when a picture is made, never on the canvas of the sky itself', () => {
    const { art, context } = newArt()
    art.prepare(spec)
    const { whiteGlow } = art.of(RED)
    expect(browser.contextOf(whiteGlow?.image as HTMLCanvasElement).blursAsked).toBeGreaterThan(0)
    expect(context.blursAsked).toBe(0)
  })

  it('makes a small picture of a spark and a larger one of a bloom', () => {
    const { art } = newArt()
    art.prepare(spec)
    const { spark, bloom } = art.of(RED)
    expect([spark?.width, spark?.height]).toEqual([SPARK_PICTURE_SIZE, SPARK_PICTURE_SIZE])
    expect([bloom?.width, bloom?.height]).toEqual([BLOOM_PICTURE_SIZE, BLOOM_PICTURE_SIZE])
    const light = browser.contextOf(bloom as HTMLCanvasElement).rects[0]?.fill as FakeGradient
    expect(light.kind).toBe('radial')
    // Bright in the middle, nothing at the edge.
    expect(light.stops[0]?.[1]).toBe(withAlpha(RED.bright, 1))
    expect(light.stops.at(-1)?.[1]).toBe(withAlpha(RED.light, 0))
  })

  it('lays a streak of the same light across the bloom, added to it', () => {
    const { art } = newArt()
    art.prepare(spec)
    const [round, streak] = browser.contextOf(art.of(RED).bloom as HTMLCanvasElement).rects
    const light = streak?.fill as FakeGradient
    expect(round?.blend).toBe('source-over')
    expect(streak?.blend).toBe('lighter')
    expect(light.kind).toBe('radial')
    expect(light.stops[0]?.[1].startsWith(RED.bright)).toBe(true)
    expect(light.stops.at(-1)?.[1]).toBe(withAlpha(RED.light, 0))
  })

  it('makes solid bars hottest down their middle, in the bright tint, and leaves neon bars hollow', () => {
    const { art } = newArt()
    art.prepare(spec)
    const solid = browser.contextOf(art.of(RED).whiteGlow?.image as HTMLCanvasElement)
    const core = solid.bars.at(-1)?.fill as FakeGradient
    expect(core.kind).toBe('linear')
    expect(core.stops.every(([, colour]) => colour.startsWith(RED.bright))).toBe(true)
    // Nothing at the two edges of the bar, the most half-way across.
    const solidity = core.stops.map(([, colour]) => Number.parseInt(colour.slice(7), 16))
    const middle = core.stops.findIndex(([across]) => across === 0.5)
    expect(solidity[0]).toBe(0)
    expect(solidity.at(-1)).toBe(0)
    expect(solidity[middle]).toBe(Math.max(...solidity))
    expect(solidity[middle]).toBeGreaterThan(60)

    art.prepare({ ...spec, barStyle: 'neon' })
    const neon = browser.contextOf(art.of(RED).whiteGlow?.image as HTMLCanvasElement)
    expect(neon.bars.some((bar) => bar.fill instanceof FakeGradient)).toBe(false)
  })

  it('writes key letters dark on solid bars and bright inside neon ones', () => {
    const { art } = newArt()
    art.prepare(spec)
    expect(art.of(RED).ink).toBe('#000000')
    art.prepare({ ...spec, barStyle: 'neon' })
    const neon = art.of(RED)
    expect(neon.ink).toBe(RED.bright)
    expect(neon.neonLine).toBe(RED.bright)
    expect(neon.neonFill.startsWith(RED.light)).toBe(true)
  })

  it('does not keep the art of every colour a player drags through', () => {
    const { art } = newArt()
    art.prepare(spec)
    const first = paletteFrom('#000001')
    const firstArt = art.of(first)
    for (let i = 2; i < 200; i++) art.of(paletteFrom(`#0000${i.toString(16).padStart(2, '0')}`))
    // The first colour was dropped along the way: asking again makes it anew.
    expect(art.of(first)).not.toBe(firstArt)
    expect(browser.contexts().length).toBeGreaterThan(200)
  })

  it('still gives the fills when the browser gives no drawing context for the pictures', () => {
    const { art } = newArt()
    HTMLCanvasElement.prototype.getContext = (() => null) as HTMLCanvasElement['getContext']
    art.prepare(spec)
    const red = art.of(RED)
    expect(red.barFill).toBeDefined()
    expect([red.whiteGlow, red.blackGlow, red.spark, red.bloom]).toEqual([null, null, null, null])
  })
})

describe('the backdrop', () => {
  function spec(background: BackgroundName, change: Partial<BackdropSpec> = {}): BackdropSpec {
    return {
      width: 1300,
      height: 600,
      scaleX: 1,
      scaleY: 1,
      background,
      palette: RED,
      range: FULL,
      ...change,
    }
  }

  function paint(wanted: BackdropSpec) {
    const canvas = document.createElement('canvas')
    expect(paintBackdrop(canvas, wanted)).toBe(true)
    return { canvas, context: browser.contextOf(canvas) }
  }

  /** The thin rectangles that run the whole height: the octave lines. */
  const guides = (context: ReturnType<typeof paint>['context']) =>
    context.rects.filter((rect) => rect.width <= 1 && rect.height === 600)

  it('is as large as the sky, in canvas pixels', () => {
    const { canvas, context } = paint(spec('black', { scaleX: 1.5, scaleY: 1.5 }))
    expect([canvas.width, canvas.height]).toEqual([1950, 900])
    expect(context.zoom).toEqual({ x: 1.5, y: 1.5 })
  })

  it('has nothing but the octave lines on Black', () => {
    const { context } = paint(spec('black'))
    expect(context.rects).toEqual(guides(context))
    expect(context.discs).toBe(0)
    expect(context.bars).toEqual([])
  })

  it('draws a faint line at the left edge of every C, from the top of the sky to the line', () => {
    const { context } = paint(spec('black'))
    const lines = guides(context)
    const cs = [24, 36, 48, 60, 72, 84, 96, 108]
    expect(lines.map((line) => line.x)).toEqual(
      cs.map((midi) => Math.round((keyRectOf(midi, FULL)?.left ?? 0) * 1300)),
    )
    for (const line of lines) {
      expect(line).toMatchObject({ y: 0, width: 1, height: 600 })
      const fade = line.fill as FakeGradient
      expect(fade.stops.every(([, colour]) => colour.startsWith(RED.light))).toBe(true)
      // Faint: never more than a sixth solid.
      expect(fade.stops.every(([, colour]) => Number.parseInt(colour.slice(7), 16) < 43)).toBe(true)
    }
  })

  it('draws no line on the left edge of the sky when the piano starts on a C', () => {
    const { context } = paint(spec('black', { range: SMALL }))
    const lines = guides(context)
    expect(lines).toHaveLength(3)
    expect(lines.every((line) => line.x > 0)).toBe(true)
  })

  it('keeps the lines one canvas pixel wide and on whole pixels on a denser screen', () => {
    const { context } = paint(spec('black', { scaleX: 1.5, scaleY: 1.5 }))
    const lines = context.rects.filter((rect) => rect.height === 600)
    expect(lines).toHaveLength(8)
    for (const line of lines) {
      expect(line.width * 1.5).toBeCloseTo(2, 10)
      expect((line.x * 1.5) % 1).toBeCloseTo(0, 10)
    }
  })

  it('paints Night as a wash that is near-black at the top and deeper blue at the line, with darker corners', () => {
    const { context } = paint(spec('night'))
    const [wash, vignette] = context.rects
    const night = wash?.fill as FakeGradient
    expect(wash).toMatchObject({ x: 0, y: 0, width: 1300, height: 600, blend: 'source-over' })
    expect(night.stops.every(([, colour]) => colour.startsWith(NIGHT_COLOUR))).toBe(true)
    const solid = night.stops.map(([, colour]) => Number.parseInt(colour.slice(7), 16))
    expect(solid[0]).toBeLessThan(20)
    expect(solid[1]).toBeGreaterThan((solid[0] ?? 0) * 3)
    expect(vignette?.blend).toBe('destination-out')
    expect((vignette?.fill as FakeGradient).kind).toBe('radial')
    expect(context.discs).toBe(0)
  })

  it('adds a few hundred stars to Night for Stars, the same number on every draw', () => {
    const first = paint(spec('stars')).context
    const second = paint(spec('stars')).context
    expect(first.discs).toBeGreaterThanOrEqual(200)
    expect(first.discs).toBeLessThan(700)
    expect(second.discs).toBe(first.discs)
    expect(first.rects.some((rect) => rect.blend === 'destination-out')).toBe(true)
  })

  it('adds two or three large soft glows in the colour of the light for Aurora', () => {
    const { context } = paint(spec('aurora', { palette: BLUE }))
    const glows = context.rects.filter((rect) => rect.blend === 'lighter')
    expect(glows.length).toBeGreaterThanOrEqual(2)
    expect(glows.length).toBeLessThanOrEqual(3)
    const shades = new Set<string>()
    for (const glow of glows) {
      const light = glow.fill as FakeGradient
      expect(light.kind).toBe('radial')
      // Low opacity: at most two fifths solid at its middle, and nothing at its edge.
      expect(Number.parseInt((light.stops[0]?.[1] ?? '').slice(7), 16)).toBeLessThanOrEqual(102)
      expect((light.stops.at(-1)?.[1] ?? '').slice(7)).toBe('00')
      shades.add((light.stops[0]?.[1] ?? '').slice(0, 7))
    }
    expect([...shades].sort()).toEqual([BLUE.deep, BLUE.light].sort())
  })

  it('reports when the browser gives no drawing context', () => {
    HTMLCanvasElement.prototype.getContext = (() => null) as HTMLCanvasElement['getContext']
    expect(paintBackdrop(document.createElement('canvas'), spec('stars'))).toBe(false)
  })

  it('knows when two backdrops would look the same', () => {
    const base = spec('night')
    expect(sameBackdrop(base, spec('night'))).toBe(true)
    expect(sameBackdrop(base, spec('night', { range: { first: 21, last: 108 } }))).toBe(true)
    const changes: Partial<BackdropSpec>[] = [
      { width: 1301 },
      { height: 601 },
      { scaleX: 2 },
      { scaleY: 2 },
      { background: 'stars' },
      { palette: BLUE },
      { range: SMALL },
    ]
    for (const change of changes) expect(sameBackdrop(base, spec('night', change))).toBe(false)
  })
})
