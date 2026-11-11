/**
 * The few style rules the shell's behaviour hangs on, read as text: how the
 * menu is taken away (so that Tab cannot reach it and the mouse goes through
 * it), the hidden cursor, what in the sky lets a click through to the sky,
 * and which layer lies over which. There is no layout engine here: this is a
 * code review written down as checks.
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

const chromeCss = readStyles('./chrome.css')
const stageCss = readStyles('./stage.css')
const skyCss = readStyles('./sky/sky.css')
const appCss = readStyles('../styles/app.css')
const themeCss = readStyles('../styles/theme.css')

/** The declarations of every rule of `css` whose selector list has exactly `selector` in it. */
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

describe('the hidden menu', () => {
  it('slides and fades for 160 ms, and is truly gone only once that is over', () => {
    expect(value(chromeCss, '.menu', 'transition')).toBe(
      'opacity 160ms ease-out, transform 160ms ease-out, visibility 0s',
    )
    expect(value(chromeCss, '.menu--hidden', 'opacity')).toBe('0')
    // Gone for Tab, for the mouse and for screen readers, not merely see-through.
    expect(value(chromeCss, '.menu--hidden', 'visibility')).toBe('hidden')
    expect(value(chromeCss, '.menu--hidden', 'transition-delay')).toBe('0s, 0s, 160ms')
  })

  it('keeps its place while hidden, so that nothing under it moves', () => {
    const hidden = rule(chromeCss, '.menu--hidden')
    expect(hidden).not.toMatch(/display\s*:/)
    expect(hidden).not.toMatch(/(?:^|;)\s*(?:height|position)\s*:/)
  })

  it('takes the mouse cursor with it, over everything on the screen', () => {
    expect(value(chromeCss, '.cursor-hidden', 'cursor')).toBe('none !important')
    expect(value(chromeCss, '.cursor-hidden *', 'cursor')).toBe('none !important')
  })
})

describe('a click on the sky', () => {
  it.each([
    ['the canvas', skyCss, '.sky'],
    ['the words that say how to play', stageCss, '.stage__hint'],
    ['the sound status and the note names', stageCss, '.stage__foot'],
    ['the light line', stageCss, '.stage__line'],
    ['the box an open panel lives in', appCss, '.app__panels'],
  ])('goes through %s', (_what, css, selector) => {
    expect(value(css, selector, 'pointer-events')).toBe('none')
  })

  it('does not go through the panel itself', () => {
    expect(value(chromeCss, '.floating-panel', 'pointer-events')).toBe('auto')
  })
})

describe('what lies over what', () => {
  function layer(name: string): number {
    return Number(value(themeCss, ':root', name))
  }

  it('is the stage, then a panel, then the menu, then the start overlay', () => {
    expect(layer('--layer-panel')).toBeGreaterThan(0)
    expect(layer('--layer-menu')).toBeGreaterThan(layer('--layer-panel'))
    expect(layer('--layer-overlay')).toBeGreaterThan(layer('--layer-menu'))

    expect(value(appCss, '.app__panels', 'z-index')).toBe('var(--layer-panel)')
    expect(value(chromeCss, '.menu', 'z-index')).toBe('var(--layer-menu)')
    expect(value(chromeCss, '.start-overlay', 'z-index')).toBe('var(--layer-overlay)')
  })

  it('has a start overlay that covers the whole window whatever is behind it', () => {
    expect(value(chromeCss, '.start-overlay', 'position')).toBe('fixed')
    expect(value(chromeCss, '.start-overlay', 'inset')).toBe('0')
  })
})

describe('the top bar in a narrow window', () => {
  it('drops the volume slider below 900px, and by then the modes that are still to come', () => {
    const narrow = [...chromeCss.matchAll(/@media \(max-width: (\d+)px\)\s*\{([\s\S]*?\})\s*\}/g)].map(
      (match) => ({ width: Number(match[1]), rules: match[2] ?? '' }),
    )
    const volume = narrow.find(({ rules }) => rules.includes('.top-bar__volume'))
    const comingModes = narrow.find(({ rules }) => rules.includes(".mode-tab[aria-disabled='true']"))

    expect(volume?.width).toBe(899)
    expect(volume?.rules).toMatch(/display:\s*none/)
    expect(comingModes?.rules).toMatch(/display:\s*none/)
    expect(comingModes?.width).toBeGreaterThanOrEqual(899)
  })
})
