/**
 * A code review of songs.css written down as checks: where its colours come
 * from, and the few declarations the song screen depends on. There is no
 * layout engine here: how it looks can only be seen in a browser.
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

const songsCss = readStyles('./songs.css')
const themeCss = readStyles('../styles/theme.css')

/**
 * The declarations of every rule of `styles` whose selector is exactly
 * `selector`, one after the other. In the whole stylesheet, the rules that
 * apply to every window come before those for narrow or wide windows only.
 */
function rule(selector: string, styles: string): string {
  const found = [...styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((match) => (match[1] ?? '').split(',').some((part) => part.trim() === selector))
    .map((match) => match[2] ?? '')
  if (found.length === 0) throw new Error(`songs.css has no rule for "${selector}"`)
  return found.join(';')
}

/**
 * The value of one property in a rule: value('.song-progress', 'height') gives
 * "2px". With `styles`, the rule is looked for in that part of the stylesheet.
 */
function value(selector: string, property: string, styles = songsCss): string {
  const found = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`).exec(rule(selector, styles))
  if (!found?.[1]) throw new Error(`"${selector}" does not set ${property}`)
  return found[1].trim().replace(/\s+/g, ' ')
}

/** The rules that apply only in windows of some width: inWindows('min-width: 960px'). */
function inWindows(condition: string): string {
  const blocks = [...songsCss.matchAll(/@media \(([^)]+)\)\s*\{((?:[^{}]*\{[^{}]*\})*)\s*\}/g)]
    .filter((match) => match[1] === condition)
    .map((match) => match[2] ?? '')
  if (blocks.length === 0) throw new Error(`songs.css has no "@media (${condition})"`)
  return blocks.join('\n')
}

const NARROW = inWindows('max-width: 959px')
const WIDE = inWindows('min-width: 960px')

/** The variables the stylesheet reads that it does not get from theme.css. */
const SET_BY_THE_COMPONENTS = ['--song-progress']

describe('songs.css', () => {
  it('takes every colour from the theme: none is written out here', () => {
    expect(songsCss.match(/#[0-9a-f]{3,8}\b/gi)).toBeNull()
    expect(songsCss.match(/\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/gi)).toBeNull()
  })

  it('reads only variables that the theme defines', () => {
    const used = new Set([...songsCss.matchAll(/var\((--[\w-]+)/g)].map((match) => match[1] ?? ''))
    const missing = [...used].filter(
      (name) => !SET_BY_THE_COMPONENTS.includes(name) && !themeCss.includes(`${name}:`),
    )
    expect(used.size).toBeGreaterThan(8)
    expect(missing).toEqual([])
  })

  it('gives every control of its own the height the rest of the app has', () => {
    expect(value('.song-part', 'min-height')).toBe('36px')
    expect(value('.song-row__name', 'min-height')).toBe('36px')
  })

  it('cuts long titles and long part names with "…" instead of letting them push things about', () => {
    for (const selector of ['.song-row__title', '.player-line__title', '.song-part__label']) {
      expect(value(selector, 'text-overflow'), selector).toBe('ellipsis')
      expect(value(selector, 'white-space'), selector).toBe('nowrap')
      expect(value(selector, 'overflow'), selector).toBe('hidden')
    }
  })
})

describe('the player line', () => {
  it('knows two kinds of window, narrow and wide, and one ends where the other begins', () => {
    const widths = [...songsCss.matchAll(/@media \(((?:min|max)-width: [^)]+)\)/g)].map(
      (match) => match[1],
    )
    expect([...new Set(widths)].sort()).toEqual(['max-width: 959px', 'min-width: 960px'])
  })

  it('gives the title of a wide window its own width, so that a title that fits is not cut', () => {
    expect(value('.player-line__title', 'flex', WIDE)).toBe('0 1 auto')
    expect(value('.player-line__title', 'max-width')).toBe('320px')
    // The position takes the width that the title leaves.
    expect(value('.player-line__position', 'flex')).toBe('3 1 0')
  })

  it('keeps a wide window to one row: a title that is too long is cut, it does not push a control down', () => {
    expect(value('.player-line__controls', 'flex-wrap', WIDE)).toBe('nowrap')
    expect(value('.player-line__title', 'min-width')).toBe('64px')
  })

  it('still lets a narrow window have two rows, with the position on the second', () => {
    expect(value('.player-line__controls', 'flex-wrap')).toBe('wrap')
    expect(value('.player-line__title', 'flex')).toBe('2 1 0')
    expect(value('.player-line__position', 'flex-basis', NARROW)).toBe('100%')
    expect(value('.player-line__position', 'order', NARROW)).toBe('1')
  })
})

describe('the progress line', () => {
  it('is two pixels along the very top edge of the window', () => {
    expect(value('.song-progress', 'position')).toBe('fixed')
    expect(value('.song-progress', 'top')).toBe('0')
    expect(value('.song-progress', 'left')).toBe('0')
    expect(value('.song-progress', 'width')).toBe('100%')
    expect(value('.song-progress', 'height')).toBe('2px')
  })

  it('fills from the left as far as the song has got', () => {
    expect(value('.song-progress', 'transform')).toBe('scaleX(var(--song-progress, 0))')
    expect(value('.song-progress', 'transform-origin')).toBe('left')
  })

  it('is in the colour of the light, above the menu, and never in the way of the mouse', () => {
    expect(value('.song-progress', 'background')).toBe('var(--light)')
    expect(value('.song-progress', 'z-index')).toBe('calc(var(--layer-menu) + 1)')
    expect(value('.song-progress', 'pointer-events')).toBe('none')
  })
})

describe('the drop overlay', () => {
  it('covers the whole window, above everything else', () => {
    expect(value('.drop-overlay', 'position')).toBe('fixed')
    expect(value('.drop-overlay', 'inset')).toBe('0')
    expect(value('.drop-overlay', 'z-index')).toBe('var(--layer-overlay)')
  })

  it('never catches the mouse, so the page under it stays the target of the drop', () => {
    expect(value('.drop-overlay', 'pointer-events')).toBe('none')
  })
})

describe('the song options', () => {
  it('hang under the player line without moving anything, and scroll inside when they are too high', () => {
    expect(value('.player-line', 'position')).toBe('relative')
    expect(value('.song-options', 'position')).toBe('absolute')
    expect(value('.song-options', 'overflow')).toBe('hidden auto')
    expect(value('.song-options', 'max-height')).toMatch(/vh/)
  })

  it('end above the piano, whose top edge is never higher than 64% of the way down the window', () => {
    // From the top of the window: the top bar, the player line (50px), a gap of 8px, the
    // options, and 8px that stay free above the piano.
    expect(value('.song-options', 'top')).toBe('calc(100% + 8px)')
    expect(value('.song-options', 'max-height')).toBe(
      'min(340px, 64dvh - var(--top-bar-height) - 66px)',
    )
  })

  it('start 40px lower in a narrow window, where the player line has two rows, and end as high', () => {
    expect(value('.song-options', 'max-height', NARROW)).toBe(
      'min(340px, 64dvh - var(--top-bar-height) - 106px)',
    )
  })

  it('count on a piano that takes 34% of the height at most, and 2% under it', () => {
    const pianoCss = readStyles('./piano.css')
    const stageCss = readStyles('./stage.css')
    expect(value('.piano', 'max-height', pianoCss)).toBe('34dvh')
    expect(value('.stage__piano', 'padding-bottom', stageCss)).toBe('max(8px, 2dvh)')
  })

  it('let a long list of parts scroll by itself, up and down only', () => {
    expect(value('.song-parts', 'overflow')).toBe('hidden auto')
    expect(value('.song-parts', 'max-height')).toBe('158px')
    // One column that cannot grow wider than the list: a long name is cut, not scrolled to.
    expect(value('.song-parts', 'grid-template-columns')).toBe('minmax(0, 1fr)')
  })
})
