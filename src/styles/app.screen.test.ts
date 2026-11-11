/**
 * A code review of app.css written down as checks: the numbers and the rules
 * the look and the layout depend on, read from the stylesheet itself.
 *
 * There is no layout engine here. How high the page is, and whether the piano
 * stays in view on a small screen or under an open panel, can only be seen in
 * a browser. These checks guard the declarations that decide it.
 */
import { describe, expect, it } from 'vitest'

interface FileReader {
  readFileSync(path: URL, encoding: 'utf8'): string
}

// The test runner empties stylesheets that are imported, so the file is read
// from disk. (Loaded this way because the project has no Node type definitions.)
const fileSystemModule = 'node:fs'
const files = (await import(/* @vite-ignore */ fileSystemModule)) as FileReader

function readStyles(name: string): string {
  return files.readFileSync(new URL(name, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
}

const appCss = readStyles('./app.css')
const themeCss = readStyles('./theme.css')

interface StyleRule {
  /** Each selector of the rule, with single spaces. */
  selectors: string[]
  declarations: string
}

/** Every rule of a stylesheet, including those inside @media. */
function rules(css: string): StyleRule[] {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selectors: (match[1] ?? '').split(',').map((part) => part.trim().replace(/\s+/g, ' ')),
    declarations: match[2] ?? '',
  }))
}

/** The declarations of every rule whose selector is exactly `selector`, one after the other. */
function rule(selector: string, css = appCss): string {
  const declarations = rules(css)
    .filter(({ selectors }) => selectors.includes(selector))
    .map((found) => found.declarations)
  if (declarations.length === 0) throw new Error(`The stylesheet has no rule for "${selector}"`)
  return declarations.join(';')
}

/** The value of one property in a rule, or null when the rule does not set it. */
function declared(selector: string, property: string, css = appCss): string | null {
  const found = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`).exec(rule(selector, css))
  return found?.[1]?.trim().replace(/\s+/g, ' ') ?? null
}

/** The value of one property in a rule, e.g. value('.now-playing', 'height') → "32px". */
function value(selector: string, property: string, css = appCss): string {
  const found = declared(selector, property, css)
  if (found === null) throw new Error(`"${selector}" does not set ${property}`)
  return found
}

function px(text: string): number {
  const found = /^(-?\d+(?:\.\d+)?)px$/.exec(text.trim())
  if (!found?.[1]) throw new Error(`"${text}" is not a length in px`)
  return Number(found[1])
}

/**
 * A length worked out for a window `viewportHeight` px high. Understands px,
 * vh, a bare 0, and clamp(), min() and max() of those. Anything else (a
 * percentage, calc(), auto…) cannot be known without a browser: null.
 */
function lengthAt(text: string, viewportHeight: number): number | null {
  const length = text.trim()
  if (length === '0') return 0

  const plain = /^(-?\d+(?:\.\d+)?)(px|vh)$/.exec(length)
  if (plain) {
    const amount = Number(plain[1])
    return plain[2] === 'px' ? amount : (amount / 100) * viewportHeight
  }

  const call = /^(clamp|min|max)\((.*)\)$/.exec(length)
  if (!call) return null
  const parts: number[] = []
  for (const argument of (call[2] ?? '').split(',')) {
    const part = lengthAt(argument, viewportHeight)
    if (part === null) return null
    parts.push(part)
  }
  if (call[1] === 'min') return Math.min(...parts)
  if (call[1] === 'max') return Math.max(...parts)
  const [lowest, preferred, highest] = parts
  if (lowest === undefined || preferred === undefined || highest === undefined) return null
  return Math.max(lowest, Math.min(preferred, highest))
}

/** How high the light trails like to be while they are switched on, in a window `viewportHeight` px high. */
function trailsHeightAt(viewportHeight: number): number {
  const wish = value('.app:has(.stage__trails)', '--trails-height')
  const height = lengthAt(wish, viewportHeight)
  if (height === null) throw new Error(`"${wish}" cannot be worked out without a browser`)
  return height
}

describe('app.css: the page', () => {
  it('caps the content at about 1280px wide', () => {
    // However the cap is written (a maximum width, or the padding around the
    // content), the rule of the page carries the number. Whether the content
    // is centred can only be seen in a browser.
    const lengths = [...rule('.app').matchAll(/(\d+(?:\.\d+)?)px/g)].map((match) => Number(match[1]))
    expect(lengths.filter((length) => length >= 1200 && length <= 1360)).not.toEqual([])
  })

  it('keeps the height of the Now playing line fixed, so the piano never jumps', () => {
    expect(px(value('.now-playing', 'height'))).toBeGreaterThanOrEqual(28)
    expect(value('.now-playing', 'overflow')).toBe('hidden')
  })

  it('asks for about 160px of light trails in a 768px-high window, and never for more than 200px', () => {
    expect(trailsHeightAt(768)).toBeGreaterThanOrEqual(140)
    expect(trailsHeightAt(768)).toBeLessThanOrEqual(200)
    for (const viewportHeight of [480, 633, 768, 1080, 1440, 2160]) {
      expect(trailsHeightAt(viewportHeight), `in a window ${viewportHeight}px high`).toBeLessThanOrEqual(200)
    }
  })

  // The piano never leaves the screen: the light trails are the part of the
  // page that gives up its height, down to nothing, when a panel opens or the
  // window is low. A height or a minimum height of their own is exactly what
  // would stop them, and push the piano off the screen again.
  it('promises the light trails no height of their own, so they can give all of it up', () => {
    const promised = ['height', 'min-height']
      .map((property) => declared('.stage__trails', property))
      .filter((text) => text !== null)
      // In a window with no height at all, whatever is left is a height they would hold on to.
      .map((text) => lengthAt(text, 0))
    expect(promised.filter((height) => height !== null && height > 0)).toEqual([])
  })

  it('puts nothing between the trails and the piano: no gap, no margin, no width of their own', () => {
    for (const selector of ['.stage', '.stage__trails']) {
      const declarations = rule(selector)
      expect(declarations).not.toMatch(/(?:^|;)\s*(gap|margin[a-z-]*|width)\s*:/)
    }
  })
})

describe('app.css: controls', () => {
  it.each(['.button', '.switch', '.select', '.field__control', '.mode-tab'])(
    '%s is at least 36px high',
    (selector) => {
      expect(px(value(selector, 'min-height'))).toBeGreaterThanOrEqual(36)
    },
  )

  it('sliders and round buttons are 36px too', () => {
    expect(px(value('.slider', 'height'))).toBeGreaterThanOrEqual(36)
    expect(px(value('.button--round', 'width'))).toBeGreaterThanOrEqual(36)
  })

  it('the options of a segmented switch reach 36px with the border around them', () => {
    const border = px(value('.segmented', 'border').split(' ')[0] ?? '')
    expect(px(value('.segmented__option', 'min-height')) + 2 * border).toBeGreaterThanOrEqual(36)
  })

  it.each(['.button', '.switch', '.segmented__option'])('%s reacts to being pressed', (control) => {
    const whilePressed = rules(appCss)
      .flatMap(({ selectors }) => selectors)
      .filter((selector) => selector.startsWith(control) && selector.includes(':active'))
    expect(whilePressed).not.toEqual([])
  })

  it('never takes the focus ring away from a control (only the full-screen start overlay may)', () => {
    const switchedOff = /(?:outline|box-shadow)\s*:\s*(?:none|0)\s*(?:;|$)/
    const withoutRing = rules(appCss)
      .filter(({ declarations }) => switchedOff.test(declarations))
      .flatMap(({ selectors }) => selectors)
      .filter((selector) => selector.includes(':focus'))
    expect(withoutRing.filter((selector) => !selector.startsWith('.start-overlay'))).toEqual([])

    const ring = rule(':focus-visible', themeCss)
    expect(ring).toMatch(/box-shadow\s*:\s*var\(--focus-ring\)/)
    // Windows contrast themes drop every shadow and draw outlines in a colour
    // of their own: there the outline is the ring, so it must not be switched off.
    expect(ring).not.toMatch(/outline\s*:\s*(?:none|0)\s*(?:;|$)/)
  })
})

describe('app.css: the visual rules of the spec', () => {
  it('takes every colour from the theme: no colour is written out', () => {
    expect(appCss).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(appCss).not.toMatch(/\b(?:rgba?|hsla?|oklch|lab|lch)\(/)
    const named = /:\s*(?:white|black|red|blue|green|gray|grey|orange|yellow)\s*[;}]/
    expect(appCss).not.toMatch(named)
  })

  it('only uses variables that theme.css defines', () => {
    const defined = new Set([...themeCss.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((match) => match[1]))
    const local = new Set([...appCss.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((match) => match[1]))
    const used = new Set([...appCss.matchAll(/var\((--[a-z0-9-]+)/g)].map((match) => match[1]))
    expect(used.size).toBeGreaterThan(10)
    const unknown = [...used].filter((name) => !defined.has(name) && !local.has(name))
    expect(unknown).toEqual([])
  })

  it('keeps every transition between 80 and 160 ms', () => {
    const durations = [...appCss.matchAll(/(\d+)ms/g)].map((match) => Number(match[1]))
    expect(durations.length).toBeGreaterThan(10)
    for (const duration of durations) {
      expect(duration).toBeGreaterThanOrEqual(80)
      expect(duration).toBeLessThanOrEqual(160)
    }
  })

  it('spaces things in multiples of 4px', () => {
    const spacing = [...appCss.matchAll(/(?:^|[;{\s])(gap|padding(?:-[a-z]+)?|margin(?:-[a-z]+)?)\s*:\s*([^;]+);/g)]
    expect(spacing.length).toBeGreaterThan(30)
    for (const [, property, text] of spacing) {
      for (const length of (text ?? '').matchAll(/(\d+(?:\.\d+)?)px/g)) {
        const pixels = Number(length[1])
        // 1280px is the page width inside the padding formula, not a space.
        if (pixels === 1280) continue
        expect(pixels % 4, `${property}: ${text}`).toBe(0)
      }
    }
  })

  it('uses no image and no font from outside', () => {
    expect(appCss).not.toMatch(/url\(/)
    expect(appCss).not.toMatch(/@import|@font-face/)
    expect(themeCss).not.toMatch(/url\(|@import|@font-face/)
  })
})
