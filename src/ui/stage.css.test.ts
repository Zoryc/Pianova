/**
 * A code review of how the window is shared, written down as checks:
 * src/styles/app.css (the three rows of the screen), src/ui/stage.css (the
 * sky and the piano on those rows) and the page itself in theme.css. There is
 * no layout engine here: the sizes that come out were measured in a browser.
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

const stageCss = readStyles('./stage.css')
const appCss = readStyles('../styles/app.css')
const themeCss = readStyles('../styles/theme.css')
const chromeCss = readStyles('./chrome.css')

/** The declarations of every rule of `css` whose selector is exactly `selector`. */
function rule(css: string, selector: string): string {
  const found = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((match) => (match[1] ?? '').split(',').some((part) => part.trim() === selector))
    .map((match) => match[2] ?? '')
  if (found.length === 0) throw new Error(`There is no rule for "${selector}"`)
  return found.join(';')
}

/** The value of one property in a rule, or undefined when the rule does not set it. */
function value(css: string, selector: string, property: string): string | undefined {
  const found = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`).exec(rule(css, selector))
  return found?.[1]?.trim().replace(/\s+/g, ' ')
}

/** The rules `css` keeps for the windows that match `query`: what is inside "@media query { … }". */
function mediaRules(css: string, query: string): string {
  const opening = `@media ${query}`
  const start = css.indexOf(opening)
  if (start < 0) throw new Error(`There is no "${opening}"`)
  const from = css.indexOf('{', start) + 1
  let depth = 1
  let at = from
  while (at < css.length && depth > 0) {
    if (css[at] === '{') depth += 1
    if (css[at] === '}') depth -= 1
    at += 1
  }
  return css.slice(from, at - 1)
}

describe.each([
  ['stage.css', stageCss],
  ['app.css', appCss],
])('%s', (_name, css) => {
  it('takes every colour from the theme: none is written out here', () => {
    expect(css.match(/#[0-9a-f]{3,8}\b/gi)).toBeNull()
    expect(css.match(/\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/gi)).toBeNull()
  })

  it('reads only variables that the theme defines', () => {
    const used = new Set([...css.matchAll(/var\((--[\w-]+)/g)].map((match) => match[1] ?? ''))
    expect(used.size).toBeGreaterThan(0)
    expect([...used].filter((name) => !themeCss.includes(`${name}:`))).toEqual([])
  })
})

describe('the page', () => {
  it('never scrolls: the app is exactly the window and cuts off what sticks out', () => {
    expect(value(themeCss, 'body', 'overflow')).toBe('hidden')
    expect(value(themeCss, 'body', 'margin')).toBe('0')
    expect(value(appCss, '.app', 'height')).toBe('100dvh')
    expect(value(appCss, '.app', 'overflow')).toBe('hidden')
    expect(value(appCss, '.app__screen', 'height')).toBe('100%')
  })

  it('is black behind everything', () => {
    expect(value(themeCss, 'body', 'background')).toBe('var(--stage-bg)')
    expect(value(appCss, '.app', 'background')).toBe('var(--stage-bg)')
  })
})

describe('the three rows of the screen', () => {
  it('are the menu, what is left, and the piano', () => {
    expect(value(appCss, '.app__screen', 'display')).toBe('grid')
    expect(value(appCss, '.app__screen', 'grid-template-rows')).toBe('auto minmax(0, 1fr) auto')
    expect(value(appCss, '.app__screen', 'grid-template-columns')).toBe('minmax(0, 1fr)')
  })

  it('put the menu on the first row, where it keeps its place while hidden', () => {
    expect(value(appCss, '.app__screen > .menu', 'grid-area')).toBe('1 / 1')
    expect(value(chromeCss, '.menu', 'position')).toBe('relative')
    expect(rule(chromeCss, '.menu--hidden')).not.toMatch(/display|position/)
  })

  it('give the stage all three rows, which it uses as its own', () => {
    expect(value(appCss, '.app__screen > .stage', 'grid-area')).toBe('1 / 1 / -1 / -1')
    expect(value(stageCss, '.stage', 'display')).toBe('grid')
    expect(value(stageCss, '.stage', 'grid-template-rows')).toBe('subgrid')
  })

  it('keep a panel on the middle row: under the menu and off the piano', () => {
    expect(value(appCss, '.app__panels', 'grid-area')).toBe('2 / 1')
    expect(value(appCss, '.app__panels', 'min-height')).toBe('0')
    expect(value(appCss, '.app__panels', 'z-index')).toBe('var(--layer-panel)')
  })

  it('keep a panel off the line of words above the piano, where the window is high enough', () => {
    const highWindows = mediaRules(appCss, '(min-height: 560px)')
    const everyWindow = appCss.replace(highWindows, '')

    // In a low window: a small gap above the light line, and room for the panel's shadow.
    expect(value(everyWindow, '.app__panels', 'padding')).toBe('4px 0 12px')
    expect(value(everyWindow, '.app__panels', 'padding-bottom')).toBeUndefined()

    // From 560px of height on, the gap is big enough for the note names, the
    // sound status and the badges: one line of words that ends 12px above the
    // piano. Nothing else about the box changes with the height of the window.
    expect(rule(highWindows, '.app__panels').trim()).toBe('padding-bottom: 44px;')
    expect(value(stageCss, '.stage__foot', 'padding')).toBe('0 16px 12px')
    expect(value(stageCss, '.stage__foot', 'bottom')).toBe('0')
  })

  it('let clicks beside a panel through to the sky, while the panel itself takes them', () => {
    expect(value(appCss, '.app__panels', 'pointer-events')).toBe('none')
    expect(value(chromeCss, '.floating-panel', 'pointer-events')).toBe('auto')
    expect(value(chromeCss, '.floating-panel', 'max-height')).toBe('100%')
  })

  it('stack the menu over the panels', () => {
    const layer = (name: string): number =>
      Number(new RegExp(`${name}:\\s*(\\d+)`).exec(themeCss)?.[1])
    expect(value(chromeCss, '.menu', 'z-index')).toBe('var(--layer-menu)')
    expect(layer('--layer-panel')).toBeGreaterThan(0)
    expect(layer('--layer-menu')).toBeGreaterThan(layer('--layer-panel'))
    expect(layer('--layer-overlay')).toBeGreaterThan(layer('--layer-menu'))
  })
})

describe('the sky and the piano', () => {
  it('share the rows: the piano on the last one, the sky on everything above it', () => {
    expect(value(stageCss, '.stage__piano', 'grid-row')).toBe('3')
    expect(value(stageCss, '.stage__sky', 'grid-row')).toBe('1 / 3')
    expect(value(stageCss, '.stage__sky', 'min-height')).toBe('0')
  })

  it('let the sky start below a menu that is always shown', () => {
    expect(value(stageCss, '.stage--below-menu .stage__sky', 'grid-row')).toBe('2')
  })

  it('are as wide as the window: no margin, border or width of their own', () => {
    for (const selector of ['.stage', '.stage__sky', '.stage__piano']) {
      const declarations = rule(stageCss, selector)
      expect(declarations).not.toMatch(/(?:^|;)\s*(?:margin|border|width|max-width)[\w-]*\s*:/)
      expect(declarations).not.toMatch(/padding(?:-left|-right|-inline)?\s*:\s*\S+\s+[1-9]/)
    }
    // Only room under the piano: about 2% of the window's height, 8px at least.
    expect(value(stageCss, '.stage__piano', 'padding-bottom')).toBe('max(8px, 2dvh)')
    expect(value(stageCss, '.stage__piano', 'padding')).toBeUndefined()
  })

  it('make the canvas exactly the sky', () => {
    expect(value(stageCss, '.stage__sky', 'position')).toBe('relative')
    expect(value(stageCss, '.stage__sky > .sky', 'position')).toBe('absolute')
    expect(value(stageCss, '.stage__sky > .sky', 'inset')).toBe('0')
  })

  it('do not cut off the glow of the light line or of the keys', () => {
    for (const selector of ['.stage', '.stage__sky', '.stage__piano']) {
      expect(value(stageCss, selector, 'overflow')).toBeUndefined()
    }
  })

  it('draw the light line on the last two pixels of the sky, in the colour of the light', () => {
    expect(value(stageCss, '.stage__line', 'position')).toBe('absolute')
    expect(value(stageCss, '.stage__line', 'bottom')).toBe('0')
    expect(value(stageCss, '.stage__line', 'left')).toBe('0')
    expect(value(stageCss, '.stage__line', 'right')).toBe('0')
    expect(value(stageCss, '.stage__line', 'height')).toBe('2px')
    expect(value(stageCss, '.stage__line', 'background')).toBe('var(--light)')
    expect(value(stageCss, '.stage__line', 'box-shadow')).toContain('var(--glow)')
  })
})

describe('the words over the sky', () => {
  it.each(['.stage__hint', '.stage__foot', '.stage__line'])(
    '%s takes no room and never catches the mouse',
    (selector) => {
      expect(value(stageCss, selector, 'position')).toBe('absolute')
      expect(value(stageCss, selector, 'pointer-events')).toBe('none')
    },
  )

  it('fade the hint out, and take it away once it has faded', () => {
    expect(value(stageCss, '.stage__hint--gone', 'opacity')).toBe('0')
    expect(value(stageCss, '.stage__hint--gone', 'visibility')).toBe('hidden')
    const transition = value(stageCss, '.stage__hint', 'transition')
    expect(transition).toBe('opacity 400ms ease-out, visibility 0s')
    expect(value(stageCss, '.stage__hint--gone', 'transition-delay')).toBe('0s, 400ms')
  })

  it('keep the sound status and the note names apart, and the status on one line', () => {
    expect(value(stageCss, '.stage__foot', 'grid-template-columns')).toBe(
      'minmax(0, 1fr) auto minmax(0, 1fr)',
    )
    expect(value(stageCss, '.stage__sound', 'grid-column')).toBe('1')
    expect(value(stageCss, '.stage__notes', 'grid-column')).toBe('2')
    expect(value(stageCss, '.stage__status', 'white-space')).toBe('nowrap')
    expect(value(stageCss, '.stage__status', 'text-overflow')).toBe('ellipsis')
  })

  it('edge the words above the line in the dark of the stage, so that they read on a bar of light', () => {
    expect(value(stageCss, '.stage__foot', 'paint-order')).toBe('stroke fill')
    expect(value(stageCss, '.stage__foot', '-webkit-text-stroke')).toMatch(/^\dpx var\(--stage-bg\)$/)
    expect(value(stageCss, '.stage__badge', 'background')).toContain('var(--stage-bg)')
  })

  it('take the words in the middle of the sky away while a panel lies over them', () => {
    const steppingAside = '.app__panels:has(.floating-panel) ~ .stage .stage__hint'
    expect(value(appCss, steppingAside, 'opacity')).toBe('0')
  })

  it('show in red that the sound could not start', () => {
    expect(value(stageCss, ".stage__status[data-status='error']", 'color')).toBe('var(--danger)')
  })
})
