/**
 * A code review of the stylesheets written down as checks: the numbers and
 * the rules the look and the layout depend on (docs/INTERFACE.md sections 1,
 * 2, 6 and 8), read from the stylesheets themselves.
 *
 * The styles of the screen are in several files: theme.css (the tokens) and
 * app.css (how the window is shared) here, and next to their components
 * chrome.css (the menu, the panels and every shared control), stage.css,
 * piano.css, settings.css, songs.css and sky.css.
 *
 * There is no layout engine here. How high things are, and whether the piano
 * stays in view in a low window or under an open panel, can only be seen in
 * a browser. These checks guard the declarations that decide it.
 *
 * Checked elsewhere and not repeated here: the three rows of the screen and
 * the words over the sky (src/ui/stage.css.test.ts), the song screen
 * (src/ui/songs.css.test.ts) and the look of the piano itself
 * (src/ui/Piano.pointer.test.tsx).
 */
import { describe, expect, it } from 'vitest'
import { inkOn, paletteFor } from '../core/colour'
import { DEFAULT_SETTINGS } from '../state/settings'

interface FileReader {
  readFileSync(path: URL, encoding: 'utf8'): string
}

// The test runner empties stylesheets that are imported, so the files are read
// from disk. (Loaded this way because the project has no Node type definitions.)
const fileSystemModule = 'node:fs'
const files = (await import(/* @vite-ignore */ fileSystemModule)) as FileReader

function readSource(path: string): string {
  return files.readFileSync(new URL(path, import.meta.url), 'utf8')
}

function readStyles(path: string): string {
  return readSource(path).replace(/\/\*[\s\S]*?\*\//g, '')
}

const appCss = readStyles('./app.css')
const themeCss = readStyles('./theme.css')
const chromeCss = readStyles('../ui/chrome.css')
const stageCss = readStyles('../ui/stage.css')
const pianoCss = readStyles('../ui/piano.css')
const settingsCss = readStyles('../ui/settings/settings.css')
const songsCss = readStyles('../ui/songs.css')
const skyCss = readStyles('../ui/sky/sky.css')

/** Every stylesheet of the screen but the theme, by name. */
const SHEETS: Readonly<Record<string, string>> = {
  'app.css': appCss,
  'chrome.css': chromeCss,
  'stage.css': stageCss,
  'piano.css': pianoCss,
  'settings.css': settingsCss,
  'songs.css': songsCss,
  'sky.css': skyCss,
}

/** The sheets that draw the chrome: the menu, the panels and the controls in them. */
const CHROME_SHEETS: Readonly<Record<string, string>> = {
  'chrome.css': chromeCss,
  'settings.css': settingsCss,
  'songs.css': songsCss,
}

interface StyleRule {
  /** Each selector of the rule, with single spaces. */
  selectors: string[]
  declarations: string
}

/** Every rule of a stylesheet, including those inside @media and the like. */
function rules(css: string): StyleRule[] {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    // A comma inside brackets, as in :not(a, b), does not start a new selector.
    selectors: (match[1] ?? '').split(/,(?![^(]*\))/).map((part) => part.trim().replace(/\s+/g, ' ')),
    declarations: match[2] ?? '',
  }))
}

/** The declarations of every rule whose selector is exactly `selector`, one after the other. */
function rule(selector: string, css: string): string {
  const declarations = rules(css)
    .filter(({ selectors }) => selectors.includes(selector))
    .map((found) => found.declarations)
  if (declarations.length === 0) throw new Error(`The stylesheet has no rule for "${selector}"`)
  return declarations.join(';')
}

/** The value of one property in a rule, or null when the rule does not set it. */
function declared(selector: string, property: string, css: string): string | null {
  const found = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`).exec(rule(selector, css))
  return found?.[1]?.trim().replace(/\s+/g, ' ') ?? null
}

/** The value of one property in a rule, e.g. value('.button', 'min-height', chromeCss) → "36px". */
function value(selector: string, property: string, css: string): string {
  const found = declared(selector, property, css)
  if (found === null) throw new Error(`"${selector}" does not set ${property}`)
  return found
}

/** The same, looked for in the first of the chrome's sheets that has a rule for the selector. */
function chromeValue(selector: string, property: string): string {
  for (const css of Object.values(CHROME_SHEETS)) {
    if (rules(css).some(({ selectors }) => selectors.includes(selector))) {
      return value(selector, property, css)
    }
  }
  throw new Error(`No stylesheet of the chrome has a rule for "${selector}"`)
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

  const plain = /^(-?\d+(?:\.\d+)?)(px|d?vh)$/.exec(length)
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

/** What theme.css gives a token, e.g. token('--glow') → "0.6". */
function token(name: string): string {
  const found = new RegExp(`(?:^|[;{\\s])${name}\\s*:\\s*([^;]+);`).exec(themeCss)
  if (!found?.[1]) throw new Error(`theme.css does not define ${name}`)
  return found[1].trim().replace(/\s+/g, ' ')
}

/** The rules a stylesheet keeps for Windows contrast themes. */
function contrastThemeRules(css: string): StyleRule[] {
  const opening = '@media (forced-colors: active)'
  const start = css.indexOf(opening)
  if (start < 0) return []
  const from = css.indexOf('{', start) + 1
  let depth = 1
  let at = from
  while (at < css.length && depth > 0) {
    if (css[at] === '{') depth++
    if (css[at] === '}') depth--
    at++
  }
  return rules(css.slice(from, at - 1))
}

describe('the page', () => {
  it('lets the stage use the whole window: nothing caps or pads the page', () => {
    // Every pixel of the window is the stage, so the root and the screen in
    // it have no width, margin, padding or border of their own.
    for (const selector of ['.app', '.app__screen']) {
      expect(rule(selector, appCss), selector).not.toMatch(
        /(?:^|;)\s*(?:max-width|width|margin[a-z-]*|padding[a-z-]*|border[a-z-]*)\s*:/,
      )
    }
    for (const selector of ['html', 'body', '#root']) {
      expect(value(selector, 'height', themeCss), selector).toBe('100%')
    }
  })

  it('caps only a panel: 760px wide, 94% of a narrower window, and centred', () => {
    expect(value('.floating-panel', 'width', chromeCss)).toBe('min(760px, 94%)')
    expect(value('.floating-panel', 'margin', chromeCss)).toBe('0 auto')
  })

  // The piano never leaves the screen: the sky is what is left of the window
  // above it, down to nothing, and a panel is never higher than its box. A
  // height or a minimum height of their own is exactly what would hold the
  // middle of the screen open, and push the piano out at the bottom.
  it('promises the sky and an open panel no height of their own, so the piano never leaves the screen', () => {
    const boxes: [selector: string, css: string][] = [
      ['.stage__sky', stageCss],
      ['.stage__sky > .sky', stageCss],
      ['.sky', skyCss],
      ['.app__panels', appCss],
      ['.floating-panel', chromeCss],
      ['.floating-panel__body', chromeCss],
    ]
    const promised = boxes.flatMap(([selector, css]) =>
      ['height', 'min-height']
        .map((property) => declared(selector, property, css))
        .filter((text) => text !== null)
        // In a window with no height at all, whatever is left is a height they would hold on to.
        .map((text) => ({ selector, height: lengthAt(text, 0) })),
    )
    expect(promised.filter(({ height }) => height !== null && height > 0)).toEqual([])
    // What does not fit in a panel scrolls inside it, up and down only.
    expect(value('.floating-panel__body', 'overflow', chromeCss)).toBe('hidden auto')
    expect(value('.floating-panel__body', 'min-height', chromeCss)).toBe('0')
  })

  it('puts nothing between the sky and the piano: no gap, no margin, no room above the keys', () => {
    // The stage takes its rows from the screen, and their gaps with them.
    const gap = /(?:^|;)\s*(?:gap|row-gap|grid-gap|grid-row-gap)\s*:/
    expect(rule('.app__screen', appCss)).not.toMatch(gap)
    expect(rule('.stage', stageCss)).not.toMatch(gap)
    for (const selector of ['.stage', '.stage__sky', '.stage__piano']) {
      expect(rule(selector, stageCss), selector).not.toMatch(/(?:^|;)\s*margin[a-z-]*\s*:/)
    }
    // The only room the piano's box adds is under the keys.
    const paddings = [...rule('.stage__piano', stageCss).matchAll(/(?:^|;)\s*(padding[a-z-]*)\s*:/g)]
    expect(paddings.map((match) => match[1])).toEqual(['padding-bottom'])
    expect(rule('.stage__sky', stageCss)).not.toMatch(/(?:^|;)\s*padding[a-z-]*\s*:/)
  })

  it('makes the canvas fill the sky, without ever catching the mouse', () => {
    expect(value('.sky', 'display', skyCss)).toBe('block')
    expect(value('.sky', 'width', skyCss)).toBe('100%')
    expect(value('.sky', 'height', skyCss)).toBe('100%')
    expect(value('.sky', 'pointer-events', skyCss)).toBe('none')
    // The key letters written on falling notes are in the typeface of the keycaps.
    expect(value('.sky', 'font-family', skyCss)).toBe('var(--font-mono)')
    expect(value('.keycap', 'font-family', chromeCss)).toBe('var(--font-mono)')
  })
})

describe('controls', () => {
  it.each(['.button', '.switch', '.select', '.field__control', '.mode-tab', '.tab', '.swatch'])(
    '%s is at least 36px high',
    (selector) => {
      expect(px(chromeValue(selector, 'min-height'))).toBeGreaterThanOrEqual(36)
    },
  )

  it('sliders, round buttons and icon buttons are 36px too', () => {
    expect(px(value('.slider', 'height', chromeCss))).toBeGreaterThanOrEqual(36)
    expect(px(value('.button--round', 'width', chromeCss))).toBeGreaterThanOrEqual(36)
    expect(px(value('.button--icon', 'width', chromeCss))).toBeGreaterThanOrEqual(36)
    // A swatch is round: as wide as it is high.
    expect(px(value('.swatch', 'min-width', settingsCss))).toBeGreaterThanOrEqual(36)
  })

  it('the options of a segmented switch reach 36px with the border around them', () => {
    const border = px(value('.segmented', 'border', chromeCss).split(' ')[0] ?? '')
    expect(
      px(value('.segmented__option', 'min-height', chromeCss)) + 2 * border,
    ).toBeGreaterThanOrEqual(36)
  })

  it.each(['.button', '.switch', '.segmented__option', '.choice-card', '.swatch'])(
    '%s reacts to being pressed',
    (control) => {
      const whilePressed = Object.values(CHROME_SHEETS)
        .flatMap((css) => rules(css))
        .flatMap(({ selectors }) => selectors)
        .filter((selector) => selector.startsWith(control) && selector.includes(':active'))
      expect(whilePressed).not.toEqual([])
    },
  )

  it('never takes the focus ring away from a control (only the full-screen start overlay may)', () => {
    const switchedOff = /(?:outline|box-shadow)\s*:\s*(?:none|0)\s*(?:;|$)/
    for (const [name, css] of Object.entries(SHEETS)) {
      const withoutRing = rules(css)
        .filter(({ declarations }) => switchedOff.test(declarations))
        .flatMap(({ selectors }) => selectors)
        .filter((selector) => selector.includes(':focus'))
      expect(
        withoutRing.filter((selector) => !selector.startsWith('.start-overlay')),
        name,
      ).toEqual([])
    }
    // The overlay covers the window, so its ring goes around its line of text instead.
    const movedRing = rule('.start-overlay:focus-visible .start-overlay__action', chromeCss)
    expect(movedRing).toMatch(/box-shadow\s*:\s*var\(--focus-ring\)/)
    expect(movedRing).not.toMatch(/outline\s*:\s*(?:none|0)\s*(?:;|$)/)

    const ring = rule(':focus-visible', themeCss)
    expect(ring).toMatch(/box-shadow\s*:\s*var\(--focus-ring\)/)
    // Windows contrast themes drop every shadow and draw outlines in a colour
    // of their own: there the outline is the ring, so it must not be switched off.
    expect(ring).not.toMatch(/outline\s*:\s*(?:none|0)\s*(?:;|$)/)
  })

  // The ring is a shadow, drawn by a rule of theme.css that any rule naming a
  // class outranks. A shadow given to a control would therefore take its
  // place, unless that shadow is the ring itself, or has the ring in it.
  it('gives no control a shadow of its own, which would take the place of the focus ring', () => {
    const controls = [
      'button',
      'switch',
      'segmented__option',
      'select',
      'slider',
      'tab',
      'mode-tab',
      'choice-card',
      'swatch',
      'song-part',
      'song-row__name',
    ]
    // The control itself, in any kind (--primary) and state ([aria-…], :hover), but not a part inside it.
    const isControl = new RegExp(`^\\.(?:${controls.join('|')})(?:--[\\w-]+)?(?![\\w-])`)
    const shadowed: string[] = []
    for (const css of Object.values(CHROME_SHEETS)) {
      for (const { selectors, declarations } of rules(css)) {
        const shadow = /(?:^|;)\s*box-shadow\s*:\s*([^;]+)/.exec(declarations)?.[1]
        if (shadow === undefined || shadow.includes('var(--focus-ring)')) continue
        for (const selector of selectors) {
          // A part drawn inside the control (::after, a slider's thumb) is not the control.
          if (selector.includes('::')) continue
          const subject = selector.split(/[\s>+~]+/).at(-1) ?? ''
          if (isControl.test(subject)) shadowed.push(selector)
        }
      }
    }
    expect(shadowed).toEqual([])
  })

  // These themes repaint every control in a few system colours and drop
  // every shadow. What is chosen or switched on is shown here by the colour
  // of the light alone, so each of those is painted in the theme's own
  // "selected" colour instead.
  it('still shows what is chosen or switched on in a Windows contrast theme', () => {
    const marked = (css: string, selector: string): string => {
      const found = contrastThemeRules(css).filter(({ selectors }) => selectors.includes(selector))
      if (found.length === 0) throw new Error(`Nothing is said about "${selector}" for contrast themes`)
      return found.map(({ declarations }) => declarations).join(';')
    }
    const filled = [
      '.button--primary',
      ".segmented__option[aria-pressed='true']",
      ".segmented__option[aria-checked='true']",
      ".switch[aria-checked='true'] .switch__track",
      ".tab[aria-selected='true']::after",
      ".mode-tab[aria-selected='true']::after",
    ]
    for (const selector of filled) {
      const declarations = marked(chromeCss, selector)
      expect(declarations, selector).toMatch(/forced-color-adjust\s*:\s*none/)
      expect(declarations, selector).toMatch(/background\s*:\s*Highlight\s*(?:;|$)/)
    }
    for (const selector of ['.button--primary', ".segmented__option[aria-pressed='true']"]) {
      expect(marked(chromeCss, selector), selector).toMatch(/(?:^|;)\s*color\s*:\s*HighlightText/)
    }
    expect(marked(chromeCss, ".switch[aria-checked='true'] .switch__thumb")).toMatch(
      /background\s*:\s*HighlightText/,
    )

    for (const selector of [".swatch[aria-checked='true']", ".choice-card[aria-pressed='true']"]) {
      expect(marked(settingsCss, selector), selector).toMatch(/border-color\s*:\s*Highlight/)
    }
    // A colour to choose from, and a picture of a look, keep their own colours.
    for (const selector of ['.swatch__dot', '.theme-preview', '.mini-keys', '.keyboard-picture']) {
      expect(marked(settingsCss, selector), selector).toMatch(/forced-color-adjust\s*:\s*none/)
    }

    for (const selector of [".song-part[aria-checked='true'] .song-part__box", '.song-progress']) {
      const declarations = marked(songsCss, selector)
      expect(declarations, selector).toMatch(/forced-color-adjust\s*:\s*none/)
      expect(declarations, selector).toMatch(/background\s*:\s*Highlight/)
    }
  })
})

describe('the visual rules of the spec', () => {
  it.each(Object.keys(SHEETS))(
    '%s takes every colour from the theme: no colour is written out',
    (name) => {
      const css = SHEETS[name] ?? ''
      expect(css).not.toBe('')
      // Not as a number, not as a colour function, and not by name.
      expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
      expect(css).not.toMatch(/\b(?:rgba?|hsla?|hwb|oklch|oklab|lab|lch)\(/)
      const named = /:\s*(?:white|black|red|blue|green|gray|grey|orange|yellow|purple|pink)\s*[;}]/
      expect(css).not.toMatch(named)
    },
  )

  /**
   * The variables that are not tokens of the theme: a component sets each of
   * them on its own element, in the file named here.
   */
  const SET_BY_A_COMPONENT: Readonly<Record<string, string>> = {
    '--piano-white-keys': '../ui/Piano.tsx',
    '--piano-black-key-width': '../ui/Piano.tsx',
    '--piano-black-key-height': '../ui/Piano.tsx',
    '--key-light': '../ui/Piano.tsx',
    '--key-light-bright': '../ui/Piano.tsx',
    '--key-light-ink': '../ui/Piano.tsx',
    '--label-chars': '../ui/Piano.tsx',
    '--preview-night': '../ui/settings/ThemeCards.tsx',
    '--preview-light': '../ui/settings/ThemeCards.tsx',
    '--preview-bright': '../ui/settings/ThemeCards.tsx',
    '--preview-deep': '../ui/settings/ThemeCards.tsx',
    '--preview-glow': '../ui/settings/ThemeCards.tsx',
    '--bar-light': '../ui/settings/ThemeCards.tsx',
    '--bar-bright': '../ui/settings/ThemeCards.tsx',
    '--bar-deep': '../ui/settings/ThemeCards.tsx',
    '--indent': '../ui/settings/PresetCards.tsx',
    '--swatch': '../ui/settings/ColourSwatches.tsx',
    '--song-progress': '../ui/PlayerLine.tsx',
  }

  it('only uses variables that theme.css defines, or that a component sets', () => {
    const defined = new Set([...themeCss.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((match) => match[1]))
    let usedInAll = 0
    for (const [name, css] of Object.entries({ ...SHEETS, 'theme.css': themeCss })) {
      const local = new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((match) => match[1]))
      const used = new Set([...css.matchAll(/var\((--[a-z0-9-]+)/g)].map((match) => match[1] ?? ''))
      usedInAll += used.size
      const unknown = [...used].filter(
        (variable) =>
          !defined.has(variable) && !local.has(variable) && !(variable in SET_BY_A_COMPONENT),
      )
      expect(unknown, name).toEqual([])
    }
    expect(usedInAll).toBeGreaterThan(100)

    // And the components do set them: the list above names where.
    for (const [variable, component] of Object.entries(SET_BY_A_COMPONENT)) {
      expect(readSource(component), `${component} sets ${variable}`).toContain(`'${variable}'`)
    }
  })

  // Like the 4 px grid below, this is a rule for the controls: chrome.css
  // promises at its top that every control answers within 80 to 160 ms, and
  // the sheets of the two panels are full of controls. The piano and the stage
  // are left out on purpose. They have timings of their own, which their own
  // tests hold them to: a key dips in 50 ms and its light fades over 250 ms
  // (src/ui/Piano.pointer.test.tsx), and the words "how to play" fade over
  // 400 ms (src/ui/stage.css.test.ts).
  it.each(Object.keys(CHROME_SHEETS))('%s keeps every transition between 80 and 160 ms', (name) => {
    const durations = [...(CHROME_SHEETS[name] ?? '').matchAll(/(\d+(?:\.\d+)?)ms/g)].map((match) =>
      Number(match[1]),
    )
    expect(durations.length).toBeGreaterThan(name === 'chrome.css' ? 10 : 0)
    for (const duration of durations) {
      expect(duration).toBeGreaterThanOrEqual(80)
      expect(duration).toBeLessThanOrEqual(160)
    }
    // Nothing is timed in whole seconds either, apart from "at once".
    const seconds = [...(CHROME_SHEETS[name] ?? '').matchAll(/(?<![\w.-])(\d+(?:\.\d+)?)s\b/g)]
    expect(seconds.map((match) => Number(match[1])).filter((amount) => amount !== 0)).toEqual([])
  })

  it('slides the menu away in 160 ms, and only then takes it out of reach of the Tab key', () => {
    // What changes gradually, in the order the stylesheet lists it, and how long each takes.
    const timed = value('.menu', 'transition', chromeCss)
      .split(',')
      .map((part) => part.trim().split(/\s+/))
    const properties = timed.map(([property]) => property)
    const durationOf = (property: string): string | undefined =>
      timed.find(([name]) => name === property)?.[1]
    // It fades and it slides, both in 160 ms. How the movement eases is not prescribed.
    expect(durationOf('opacity')).toBe('160ms')
    expect(durationOf('transform')).toBe('160ms')
    expect(value('.menu--hidden', 'opacity', chromeCss)).toBe('0')
    expect(declared('.menu--hidden', 'transform', chromeCss)).not.toBeNull()

    // Out of reach is not gradual: it happens in one go…
    expect(durationOf('visibility')).toBe('0s')
    expect(value('.menu--hidden', 'visibility', chromeCss)).toBe('hidden')
    // …when the slide is over. The fade and the slide themselves start at once.
    const waits = value('.menu--hidden', 'transition-delay', chromeCss)
      .split(',')
      .map((wait) => wait.trim())
    expect(waits).toHaveLength(properties.length)
    expect(waits[properties.indexOf('visibility')]).toBe('160ms')
    expect(waits[properties.indexOf('opacity')]).toBe('0s')
    expect(waits[properties.indexOf('transform')]).toBe('0s')
    // And it is back at once, because the menu itself has no wait.
    expect(declared('.menu', 'transition-delay', chromeCss)).toBeNull()
    // The mouse pointer hides with it.
    expect(value('.cursor-hidden', 'cursor', chromeCss)).toBe('none !important')
    expect(value('.cursor-hidden *', 'cursor', chromeCss)).toBe('none !important')
  })

  // The 4 px grid is a rule for the shared controls, which chrome.css draws
  // (it says so at its top), and for how the window is shared (app.css and
  // stage.css). settings.css and songs.css are left out on purpose: the
  // layout a panel adds for itself is not held to the grid, where a small
  // drawing or a tight row may need a gap of 2px.
  it('spaces things in multiples of 4px', () => {
    const sheets = [chromeCss, appCss, stageCss].join('\n')
    const spacing = [
      ...sheets.matchAll(/(?:^|[;{\s])(gap|padding(?:-[a-z]+)?|margin(?:-[a-z]+)?)\s*:\s*([^;]+);/g),
    ]
    expect(spacing.length).toBeGreaterThan(30)
    for (const [, property, text] of spacing) {
      for (const length of (text ?? '').matchAll(/(\d+(?:\.\d+)?)px/g)) {
        expect(Number(length[1]) % 4, `${property}: ${text}`).toBe(0)
      }
    }
  })

  it('uses no image and no font from outside', () => {
    for (const [name, css] of Object.entries({ ...SHEETS, 'theme.css': themeCss })) {
      expect(css, name).not.toMatch(/url\(|@import|@font-face/)
    }
  })

  it('defines the tokens of the stage with the values of the spec', () => {
    expect(token('--stage-bg')).toBe('#000')
    expect(token('--panel-glass')).toBe('rgb(16 17 22 / 0.86)')
    expect(token('--bar-fade')).toBe(
      'linear-gradient(to bottom, rgb(0 0 0 / 0.85), rgb(0 0 0 / 0))',
    )
    expect(token('--top-bar-height')).toBe('52px')
    const keyColours = [
      '--key-ivory',
      '--key-ivory-shine',
      '--key-ivory-shade',
      '--key-ebony',
      '--key-ebony-edge',
    ]
    for (const name of keyColours) {
      expect(token(name), name).toMatch(/^#[0-9a-f]{6}$/)
    }
    // The menu and the panels are made of them.
    expect(value('.menu', 'background', chromeCss)).toBe('var(--bar-fade)')
    expect(value('.top-bar', 'height', chromeCss)).toBe('var(--top-bar-height)')
    expect(value('.floating-panel', 'background', chromeCss)).toBe('var(--panel-glass)')
    expect(value('.floating-panel', 'backdrop-filter', chromeCss)).toMatch(/^blur\(\d+px\)$/)
  })

  // The app sets the light on its root element from the player's settings.
  // Until it has, and wherever it does not reach, the stylesheet's own values
  // show: they are the look of the settings a new player starts with.
  it('starts in the look of the default settings: the light of Ember', () => {
    const light = paletteFor(DEFAULT_SETTINGS.accent, DEFAULT_SETTINGS.customColour)
    expect(token('--light')).toBe(light.light)
    expect(token('--light-bright')).toBe(light.bright)
    expect(token('--light-deep')).toBe(light.deep)
    expect(token('--light-ink')).toBe(inkOn(light.light))
    expect(Number(token('--glow'))).toBe(DEFAULT_SETTINGS.glow)
    expect(token('--light')).toBe('#ff2a2a')
    expect(token('--glow')).toBe('0.6')
  })

  it('paints what is chosen or switched on in the colour of the light, and writes on it in its ink', () => {
    // The main button.
    expect(value('.button--primary', '--button-fill', chromeCss)).toBe('var(--light)')
    expect(value('.button--primary', '--button-ink', chromeCss)).toBe('var(--light-ink)')
    // The line under the chosen tab.
    expect(value('.tab::after', 'background', chromeCss)).toBe('var(--light)')
    expect(value('.mode-tab::after', 'background', chromeCss)).toBe('var(--light)')
    expect(value(".tab[aria-selected='true']::after", 'opacity', chromeCss)).toBe('1')
    expect(value('.tab::after', 'opacity', chromeCss)).toBe('0')
    // A switch that is on.
    expect(value(".switch[aria-checked='true'] .switch__track", 'background', chromeCss)).toBe(
      'var(--light)',
    )
    expect(value(".switch[aria-checked='true'] .switch__thumb", 'background', chromeCss)).toBe(
      'var(--light-ink)',
    )
    // The chosen one of a few.
    for (const state of ['aria-pressed', 'aria-checked']) {
      const chosen = `.segmented__option[${state}='true']`
      expect(value(chosen, 'background', chromeCss), chosen).toBe('var(--light)')
      expect(value(chosen, 'color', chromeCss), chosen).toBe('var(--light-ink)')
    }
    // A slider, from its start up to the thumb. Firefox has a part for exactly
    // that. Chrome and Edge have none, so how it is drawn there is left to the
    // stylesheet: one of the slider's parts carries the light.
    const usesTheLight = /var\(--light\)/
    expect(rule('.slider::-moz-range-progress', chromeCss)).toMatch(usesTheLight)
    const partsInChrome = rules(chromeCss).filter(({ selectors }) =>
      selectors.some((selector) => selector.startsWith('.slider::-webkit-')),
    )
    expect(partsInChrome.some(({ declarations }) => usesTheLight.test(declarations))).toBe(true)

    // Never the light itself as the colour of text: a dark colour of the
    // player's own could not be read on the dark panels.
    for (const [name, css] of Object.entries(CHROME_SHEETS)) {
      const lightText = rules(css)
        .filter(({ declarations }) => /(?:^|;)\s*color\s*:\s*var\(--light\)/.test(declarations))
        .flatMap(({ selectors }) => selectors)
      expect(lightText, name).toEqual([])
    }
  })
})
