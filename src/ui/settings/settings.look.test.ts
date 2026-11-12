/**
 * The stylesheets behind the Settings panel, read as text and checked against
 * what docs/INTERFACE.md asks of them: the panel scrolls inside itself and
 * the page never does, every colour comes from the theme, what is chosen
 * still shows in a Windows contrast theme, nothing moves for someone who
 * asked for reduced motion, and nothing replaces the focus ring.
 *
 * There is no layout engine here. Sizes on screen are for a browser.
 */
import { describe, expect, it } from 'vitest'

interface FileReader {
  readFileSync(path: URL, encoding: 'utf8'): string
}

// The test runner empties stylesheets that are imported, so the files are read
// from disk. (Loaded this way because the project has no Node type definitions.)
const fileSystemModule = 'node:fs'
const files = (await import(/* @vite-ignore */ fileSystemModule)) as FileReader

function readStyles(path: string): string {
  return files.readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
}

const settingsCss = readStyles('./settings.css')
const chromeCss = readStyles('../chrome.css')
const themeCss = readStyles('../../styles/theme.css')
const appCss = readStyles('../../styles/app.css')

/** Every rule of `css` as [selectors, declarations], rules inside @media and @container included. */
function rules(css: string): [selector: string, body: string][] {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => [
    (match[1] ?? '').trim(),
    match[2] ?? '',
  ])
}

/** The declarations of every rule whose selector list has exactly `selector`. */
function rule(css: string, selector: string): string {
  const found = rules(css)
    .filter(([selectors]) => selectors.split(',').some((part) => part.trim() === selector))
    .map(([, body]) => body)
  if (found.length === 0) throw new Error(`There is no rule for "${selector}"`)
  return found.join(';')
}

function value(css: string, selector: string, property: string): string | undefined {
  const found = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`).exec(rule(css, selector))
  return found?.[1]?.trim().replace(/\s+/g, ' ')
}

/** What is inside the block that starts at `start` (an at-rule and its condition) in `css`. */
function blockAt(css: string, start: number): string {
  const open = css.indexOf('{', start)
  let depth = 0
  for (let index = open; index >= 0 && index < css.length; index += 1) {
    if (css[index] === '{') depth += 1
    if (css[index] === '}') depth -= 1
    if (depth === 0) return css.slice(open + 1, index)
  }
  throw new Error(`The block "${css.slice(start, start + 40)}" is never closed`)
}

/** What is inside the first `@media (query)` block of `css`. */
function mediaBlock(css: string, query: string): string {
  const start = css.indexOf(`@media (${query})`)
  if (start < 0) throw new Error(`There is no @media (${query})`)
  return blockAt(css, start)
}

/** What is inside every `@container` block of `css` that asks how wide the container is. */
function widthContainerBlocks(css: string): string[] {
  return [...css.matchAll(/@container \([^)]*width[^)]*\)/g)].map((match) =>
    blockAt(css, match.index),
  )
}

/** How a box treats what does not fit, sideways and up and down. */
function overflowOf(css: string, selector: string): { sideways: string; upAndDown: string } {
  // The short form takes one word for both directions, or two: sideways first.
  const [first = 'visible', second = first] = (value(css, selector, 'overflow') ?? '').split(' ')
  return {
    sideways: value(css, selector, 'overflow-x') ?? first,
    upAndDown: value(css, selector, 'overflow-y') ?? second,
  }
}

/** A length written in pixels, as a number. */
function pixels(length: string | undefined): number {
  const found = /^(\d+(?:\.\d+)?)px$/.exec(length ?? '')
  if (!found) throw new Error(`"${String(length)}" is not a length in pixels`)
  return Number(found[1])
}

describe('the panel in a window that is too small for it', () => {
  it('scrolls inside itself, up and down only', () => {
    const body = overflowOf(chromeCss, '.floating-panel__body')
    expect(body.upAndDown).toBe('auto')
    expect(['hidden', 'clip']).toContain(body.sideways)
    expect(value(chromeCss, '.floating-panel__body', 'min-height')).toBe('0')
    // Scrolling to the end of the panel does not go on to anything behind it.
    expect(value(chromeCss, '.floating-panel__body', 'overscroll-behavior')).toBe('contain')
  })

  it('is never higher than the room between the menu and the piano', () => {
    expect(value(chromeCss, '.floating-panel', 'max-height')).toBe('100%')
    // Cut off, and not "hidden": a hidden box can still be scrolled by the
    // browser when something in it takes the focus. Only the body scrolls.
    expect(overflowOf(chromeCss, '.floating-panel')).toEqual({ sideways: 'clip', upAndDown: 'clip' })
    expect(value(appCss, '.app__panels', 'min-height')).toBe('0')
    expect(value(appCss, '.app__panels', 'grid-area')).toBe('2 / 1')
  })

  it('stays off the line of words above the piano, where a window is high enough for that', () => {
    // The names of the notes being played, the sound status and the badges are
    // written just above the piano: what is changed in Settings shows there.
    const highWindow = mediaBlock(appCss, 'min-height: 560px')
    expect(value(highWindow, '.app__panels', 'padding-bottom')).toBe('44px')

    // A lower window has no room to spare: a small gap above the piano.
    const anyWindow = appCss.replace(highWindow, '')
    expect(value(anyWindow, '.app__panels', 'padding')).toBe('4px 0 12px')
    expect(value(anyWindow, '.app__panels', 'padding-bottom')).toBeUndefined()
  })

  it('is at most 760px wide and 94% of the window, as the spec says', () => {
    expect(value(chromeCss, '.floating-panel', 'width')).toBe('min(760px, 94%)')
  })

  it('leaves the page itself without scroll bars', () => {
    expect(value(themeCss, 'body', 'overflow')).toBe('hidden')
    expect(value(appCss, '.app', 'overflow')).toBe('hidden')
    expect(value(appCss, '.app', 'height')).toBe('100dvh')
  })

  it('puts each control under its name when the panel is narrow, by the width of the panel', () => {
    expect(value(settingsCss, '.settings-page', 'container-type')).toBe('inline-size')
    // Below some width of the panel (not of the window) the row of an option is laid out anew.
    const narrowPanel = widthContainerBlocks(settingsCss).filter((block) =>
      rules(block).some(([selectors]) => /\.field\b/.test(selectors)),
    )
    expect(narrowPanel.length).toBeGreaterThan(0)
    // The theme cards go from six in a row to three, never to a row that needs sideways scrolling.
    expect(value(settingsCss, '.choice-cards--themes', 'grid-template-columns')).toContain(
      'minmax(0, 1fr)',
    )
  })
})

describe('colours', () => {
  it('are never written out in the stylesheet of the Settings panel', () => {
    expect(settingsCss.match(/#[0-9a-f]{3,8}\b/gi)).toBeNull()
    expect(settingsCss.match(/\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/gi)).toBeNull()
  })

  it('are never written out in the stylesheet of the shared controls either', () => {
    expect(chromeCss.match(/#[0-9a-f]{3,8}\b/gi)).toBeNull()
    expect(chromeCss.match(/\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/gi)).toBeNull()
  })

  it('come from variables that exist: the theme, the stylesheet itself or a component', () => {
    /** Set on an element from TypeScript (ThemeCards, MiniKeys, ColourSwatches, PresetCards). */
    const fromComponents = [
      '--preview-light',
      '--preview-bright',
      '--preview-deep',
      '--preview-glow',
      '--preview-night',
      '--bar-light',
      '--bar-bright',
      '--bar-deep',
      '--key-light',
      '--key-light-bright',
      '--swatch',
      '--indent',
    ]
    const used = new Set([...settingsCss.matchAll(/var\((--[\w-]+)/g)].map((match) => match[1] ?? ''))
    const unknown = [...used].filter(
      (name) =>
        !themeCss.includes(`${name}:`) &&
        !settingsCss.includes(`${name}:`) &&
        !fromComponents.includes(name),
    )

    expect(used.size).toBeGreaterThan(20)
    expect(unknown).toEqual([])
  })

  it('fill what is switched on or chosen with the light, and write on it in the ink that reads', () => {
    expect(value(chromeCss, ".segmented__option[aria-pressed='true']", 'background')).toBe(
      'var(--light)',
    )
    expect(value(chromeCss, ".segmented__option[aria-pressed='true']", 'color')).toBe(
      'var(--light-ink)',
    )
    expect(value(chromeCss, ".switch[aria-checked='true'] .switch__track", 'background')).toBe(
      'var(--light)',
    )
    expect(value(chromeCss, ".switch[aria-checked='true'] .switch__thumb", 'background')).toBe(
      'var(--light-ink)',
    )
    expect(value(chromeCss, '.button--primary', '--button-ink')).toBe('var(--light-ink)')
    expect(value(settingsCss, ".choice-card[aria-pressed='true']::after", 'border')).toContain(
      'var(--light-ink)',
    )
  })

  it('never use the light itself as the colour of text: a dark colour would not be readable', () => {
    const textInTheLight = [...rules(settingsCss), ...rules(chromeCss)].filter(([, body]) =>
      /(?:^|;)\s*color\s*:\s*var\(--light(?:-deep)?\)/.test(body),
    )
    expect(textInTheLight.map(([selector]) => selector)).toEqual([])
  })

  it('start as the Ember theme in the stylesheet, before the app sets them', () => {
    expect(value(themeCss, ':root', '--light')).toBe('#ff2a2a')
    expect(value(themeCss, ':root', '--light-bright')).toBe('#ffd4d4')
    expect(value(themeCss, ':root', '--light-deep')).toBe('#8c0000')
    expect(value(themeCss, ':root', '--light-ink')).toBe('#000000')
    expect(value(themeCss, ':root', '--glow')).toBe('0.6')
    expect(value(themeCss, ':root', '--panel-glass')).toBe('rgb(16 17 22 / 0.86)')
    expect(value(themeCss, ':root', '--stage-bg')).toBe('#000')
  })
})

describe('the glow', () => {
  it('of every control scales with --glow, so that 0% leaves no halo', () => {
    const glows = [...rules(chromeCss), ...rules(settingsCss)]
      .flatMap(([selector, body]) =>
        [...body.matchAll(/(?:box-shadow|filter)\s*:\s*([^;]+)/g)].map(
          (match) => [selector, (match[1] ?? '').replace(/\s+/g, ' ')] as const,
        ),
      )
      // A shadow in the colour of the light is a glow. (Rings, edges and the panel's own shadow are not.)
      .filter(([, shadow]) => /var\(--(?:light|bar-light|preview-light|button-glow)\)/.test(shadow))

    expect(glows.length).toBeGreaterThan(3)
    for (const [selector, shadow] of glows) {
      expect(shadow, selector).toMatch(/calc\(var\(--(?:glow|preview-glow)\) \* \d+px\)/)
    }
  })
})

describe('a Windows contrast theme', () => {
  const settingsForced = mediaBlock(settingsCss, 'forced-colors: active')
  const chromeForced = mediaBlock(chromeCss, 'forced-colors: active')

  it('still shows which colour, which theme, which choice and which tab is the chosen one', () => {
    expect(value(settingsForced, ".swatch[aria-checked='true']", 'border-color')).toBe('Highlight')
    expect(value(settingsForced, ".choice-card[aria-pressed='true']", 'border-color')).toBe(
      'Highlight',
    )
    expect(value(chromeForced, ".segmented__option[aria-pressed='true']", 'background')).toBe(
      'Highlight',
    )
    expect(value(chromeForced, ".segmented__option[aria-pressed='true']", 'color')).toBe(
      'HighlightText',
    )
    expect(value(chromeForced, ".tab[aria-selected='true']::after", 'background')).toBe('Highlight')
    expect(value(chromeForced, ".switch[aria-checked='true'] .switch__track", 'background')).toBe(
      'Highlight',
    )
  })

  it('keeps the colours that are the point of a swatch or a picture', () => {
    for (const selector of ['.swatch__dot', '.theme-preview', '.mini-keys']) {
      expect(value(settingsForced, selector, 'forced-color-adjust'), selector).toBe('none')
    }
  })

  it('shows the keyboard focus with an outline, since these themes drop every shadow', () => {
    expect(value(themeCss, ':focus-visible', 'outline')).toBe('2px solid transparent')
    expect(value(themeCss, ':focus-visible', 'box-shadow')).toBe('var(--focus-ring)')
    // The panel keeps that outline when it holds the focus itself.
    expect(rule(chromeCss, '.floating-panel:focus-visible')).not.toMatch(/outline/)
  })
})

describe('reduced motion', () => {
  it('stops every transition and animation of the panel and its controls', () => {
    const reduced = mediaBlock(themeCss, 'prefers-reduced-motion: reduce')

    expect(reduced).toMatch(/\*,\s*\*::before,\s*\*::after/)
    expect(reduced).toMatch(/transition-duration:\s*0\.01ms\s*!important/)
    expect(reduced).toMatch(/animation-duration:\s*0\.01ms\s*!important/)
  })

  it('has nothing in the Settings panel that keeps moving by itself', () => {
    // Something that moves once and stops is cut short by the rule above. Something
    // that starts over without end would not be: neither stylesheet has any.
    expect(settingsCss).not.toMatch(/\binfinite\b/)
    expect(chromeCss).not.toMatch(/\binfinite\b/)
  })
})

describe('the focus ring', () => {
  it('is not replaced by a shadow of its own on anything in Settings that takes the focus', () => {
    const focusable = [
      '.swatch',
      '.choice-card',
      '.tab',
      '.switch',
      '.segmented__option',
      '.slider',
      '.button',
      '.select',
    ]
    const withOwnShadow = [...rules(settingsCss), ...rules(chromeCss)]
      .filter(([, body]) => /(?:^|;)\s*box-shadow\s*:/.test(body))
      .flatMap(([selectors]) => selectors.split(',').map((part) => part.trim()))
      // The element itself, in any state: not a part inside it (a track, a dot, a line under a tab).
      .filter((selector) =>
        focusable.some((name) =>
          new RegExp(`^${name.replace('.', '\\.')}(?:\\[[^\\]]*\\]|:(?!:)[\\w-]+(?:\\([^)]*\\))?)*$`).test(
            selector,
          ),
        ),
      )

    expect(withOwnShadow).toEqual([])
  })

  it('is big enough on every control: at least 36px high', () => {
    const sizes: [name: string, size: string | undefined][] = [
      ['.button', value(chromeCss, '.button', 'min-height')],
      ['.switch', value(chromeCss, '.switch', 'min-height')],
      ['.tab', value(chromeCss, '.tab', 'min-height')],
      ['.slider', value(chromeCss, '.slider', 'height')],
      ['.swatch (high)', value(settingsCss, '.swatch', 'min-height')],
      ['.swatch (wide)', value(settingsCss, '.swatch', 'min-width')],
    ]
    for (const [name, size] of sizes) expect(pixels(size), name).toBeGreaterThanOrEqual(36)
  })
})

describe('the colour picker of the browser', () => {
  it('is on the page, so that the picker opens next to "Your colour", but takes no click itself', () => {
    const picker = rule(settingsCss, '.swatch-own__picker')

    // Not display: none: some browsers open no picker for an element that is not drawn.
    expect(picker).not.toMatch(/display\s*:\s*none/)
    expect(picker).not.toMatch(/visibility\s*:\s*hidden/)
    expect(value(settingsCss, '.swatch-own__picker', 'opacity')).toBe('0')
    expect(value(settingsCss, '.swatch-own__picker', 'pointer-events')).toBe('none')
    expect(value(settingsCss, '.swatch-own__picker', 'position')).toBe('absolute')
    expect(value(settingsCss, '.swatch-own', 'position')).toBe('relative')
  })
})
