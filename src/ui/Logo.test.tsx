import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { APP_NAME, APP_NAME_LIGHT_FROM } from '../app/appInfo'
import { LOGO_SHAPES, LogoMark, Wordmark } from './Logo'

// Loaded this way because the project has no Node type definitions.
const fileSystemModule = 'node:fs'
const files = (await import(/* @vite-ignore */ fileSystemModule)) as {
  readFileSync(path: URL, encoding: 'utf8'): string
}

/** The browser tab's icon, which draws the mark in the default light. */
const favicon = files.readFileSync(new URL('../../public/favicon.svg', import.meta.url), 'utf8')

function pathsOf(svg: string): string[] {
  return [...svg.matchAll(/<path[^>]*\sd="([^"]+)"/g)].map((match) => match[1] ?? '').sort()
}

function circlesOf(svg: string): string[] {
  return [...svg.matchAll(/<circle[^>]*\scx="([^"]+)"[^>]*\scy="([^"]+)"[^>]*\sr="([^"]+)"/g)]
    .map((match) => `${match[1]} ${match[2]} ${match[3]}`)
    .sort()
}

describe('the logo', () => {
  it('draws the same shapes in the app as in the browser tab', () => {
    const inApp = renderToStaticMarkup(createElement(LogoMark))
    expect(pathsOf(inApp)).toEqual(pathsOf(favicon))
    expect(circlesOf(inApp)).toEqual(circlesOf(favicon))
    // Every shape of the list is drawn: none is left out of either picture.
    const listed = [
      ...LOGO_SHAPES.whiteKeys,
      LOGO_SHAPES.litKey,
      LOGO_SHAPES.litKeyTop,
      ...LOGO_SHAPES.blackKeys,
      LOGO_SHAPES.line,
      LOGO_SHAPES.bar,
      LOGO_SHAPES.spark,
    ]
    expect(pathsOf(favicon)).toEqual([...listed].sort())
    expect(circlesOf(favicon)).toHaveLength(LOGO_SHAPES.sparks.length)
  })

  it('is a picture only, which a screen reader passes over', () => {
    expect(renderToStaticMarkup(createElement(LogoMark))).toMatch(/^<svg class="logo-mark"[^>]* aria-hidden="true"/)
  })

  it('gives each copy ids of its own, so that two marks never share a gradient', () => {
    const two = renderToStaticMarkup(createElement('div', null, createElement(LogoMark), createElement(LogoMark)))
    const ids = [...two.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1])
    expect(ids).toHaveLength(8)
    expect(new Set(ids).size).toBe(8)
    // Each id is one a url(#…) can name without escaping anything.
    expect(ids.every((id) => /^[A-Za-z0-9_-]+$/.test(id ?? ''))).toBe(true)
    // And every url(#…) names one of them.
    const named = [...two.matchAll(/url\(#([^)]+)\)/g)].map((match) => match[1])
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
