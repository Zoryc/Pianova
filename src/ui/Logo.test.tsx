import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { APP_NAME, APP_NAME_LIGHT_FROM } from '../app/appInfo'
import { ACCENT_COLOURS } from '../core/colour'
import { LOGO_SHAPES, LogoMark, TAB_ICON_SHAPES, Wordmark } from './Logo'

// Loaded this way because the project has no Node type definitions.
const fileSystemModule = 'node:fs'
const files = (await import(/* @vite-ignore */ fileSystemModule)) as {
  readFileSync(path: URL, encoding: 'utf8'): string
}

/** The browser tab's icon, which draws the piano, made simpler, in the default light. */
const favicon = files.readFileSync(new URL('../../public/favicon.svg', import.meta.url), 'utf8')

function pathsOf(svg: string): string[] {
  return [...svg.matchAll(/<path[^>]*\sd="([^"]+)"/g)].map((match) => match[1] ?? '').sort()
}

describe('the logo', () => {
  it('draws every shape of its list, and nothing else', () => {
    const inApp = renderToStaticMarkup(createElement(LogoMark))
    // The case four times (filled, its line's glow, the edge the keys are cut to, its line), the line over the keys twice.
    const listed = [
      ...Array<string>(4).fill(LOGO_SHAPES.case),
      ...Array<string>(2).fill(LOGO_SHAPES.fallboard),
      LOGO_SHAPES.keys,
      LOGO_SHAPES.seams,
      ...LOGO_SHAPES.blackKeys,
    ]
    expect(pathsOf(inApp)).toEqual([...listed].sort())
  })

  it('draws the same piano, made simpler, in the browser tab', () => {
    // The case twice (filled, then its line), the line over the keys once.
    const listed = [
      ...Array<string>(2).fill(TAB_ICON_SHAPES.case),
      TAB_ICON_SHAPES.fallboard,
      TAB_ICON_SHAPES.keys,
      ...TAB_ICON_SHAPES.blackKeys,
    ]
    expect(pathsOf(favicon)).toEqual([...listed].sort())
    // In the app's default light.
    expect(favicon).toContain(`stroke="${ACCENT_COLOURS.red}"`)
  })

  it('is a picture only, which a screen reader passes over', () => {
    expect(renderToStaticMarkup(createElement(LogoMark))).toMatch(/^<svg class="logo-mark"[^>]* aria-hidden="true"/)
  })

  it('gives each copy ids of its own, so that two marks never share a gradient', () => {
    const two = renderToStaticMarkup(createElement('div', null, createElement(LogoMark), createElement(LogoMark)))
    const ids = [...two.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1])
    expect(ids).toHaveLength(6)
    expect(new Set(ids).size).toBe(6)
    // Each id is one a url(#…) can name without escaping anything.
    expect(ids.every((id) => /^[A-Za-z0-9_-]+$/.test(id ?? ''))).toBe(true)
    // And every url(#…) names one of them.
    const named = [...two.matchAll(/url\(#([^)]+)\)/g)].map((match) => match[1])
    expect(named.length).toBeGreaterThan(0)
    expect(named.every((id) => ids.includes(id))).toBe(true)
  })

  it('writes the name in two parts, the second in the light, and reads as one word', () => {
    const html = renderToStaticMarkup(createElement(Wordmark))
    const plain = APP_NAME.slice(0, APP_NAME_LIGHT_FROM)
    const lit = APP_NAME.slice(APP_NAME_LIGHT_FROM)
    expect(html).toBe(`<span class="wordmark">${plain}<span class="wordmark__lit">${lit}</span></span>`)
    expect(html.replace(/<[^>]+>/g, '')).toBe(APP_NAME)
  })
})
