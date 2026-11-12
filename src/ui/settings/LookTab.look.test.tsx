// @vitest-environment jsdom
/**
 * The Look tab, tried the way a player uses it over an evening: a colour of
 * their own, then a theme "just to see", then back; the theme card that is
 * already marked; colours that are very dark or very pale; and the saved
 * value changing under the tab.
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import type { JSX } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { inkOn, paletteFor } from '../../core/colour'
import { DEFAULT_SETTINGS, settingsStore, useSettings } from '../../state/settings'
import { LOOK_THEMES, matchingTheme } from '../../state/themes'
import { LookTab } from './LookTab'
import { expectSettings, option, startEachTestFromDefaults } from './testSupport'

/** A colour no theme and no swatch has: the player's own. */
const MY_PINK = '#ff66cc'

/** The tab as the panel shows it: drawn again whenever a setting changes. */
function LiveTab(): JSX.Element {
  return <LookTab settings={useSettings()} />
}

function themeCard(name: string): HTMLElement {
  return within(option('Theme')).getByRole('button', { name })
}

function chosenThemes(): string[] {
  return within(option('Theme'))
    .getAllByRole('button')
    .filter((card) => card.getAttribute('aria-pressed') === 'true')
    .map((card) => card.querySelector('.choice-card__name')?.textContent ?? '')
}

function saysCustom(): boolean {
  return option('Theme').querySelector('.choice-group__custom') !== null
}

function swatch(name: string): HTMLElement {
  return screen.getByRole('radio', { name })
}

function checkedSwatches(): string[] {
  return screen
    .getAllByRole('radio')
    .filter((radio) => radio.getAttribute('aria-checked') === 'true')
    .map((radio) => radio.getAttribute('aria-label') ?? radio.textContent ?? '')
}

function colourPicker(): HTMLInputElement {
  return document.querySelector('input[type="color"]') as HTMLInputElement
}

function pickOwnColour(colour: string): void {
  fireEvent.click(swatch('Your colour'))
  fireEvent.change(colourPicker(), { target: { value: colour } })
}

function ownSwatchColour(): string {
  const dot = swatch('Your colour').querySelector('.swatch__dot') as HTMLElement
  return dot.style.getPropertyValue('--swatch')
}

startEachTestFromDefaults()

describe("the player's own colour and the themes", () => {
  it('is still there after a theme was tried: "Your colour" brings it back', () => {
    render(<LiveTab />)
    pickOwnColour(MY_PINK)

    // "Just to see what Midnight looks like."
    fireEvent.click(themeCard('Midnight'))
    expect(settingsStore.get().accent).toBe('blue')
    // The swatch called "Your colour" still shows the colour the player made.
    expect(ownSwatchColour()).toBe(MY_PINK)
    expect(colourPicker().value).toBe(MY_PINK)

    fireEvent.click(swatch('Your colour'))

    // And that colour is the one that comes back, not the blue of the theme.
    expect(settingsStore.get().accent).toBe('custom')
    expect(settingsStore.get().customColour).toBe(MY_PINK)
  })

  it('is not changed by a click on the theme card that is already marked', () => {
    render(<LiveTab />)
    pickOwnColour(MY_PINK)
    // Back to red with the swatch: everything matches Ember again, and its card is marked.
    fireEvent.click(swatch('Red'))
    expect(chosenThemes()).toEqual(['Ember'])
    const before = settingsStore.get()
    const heard = vi.fn()
    const stop = settingsStore.subscribe(heard)

    fireEvent.click(themeCard('Ember'))
    stop()

    // The card was already the chosen one: clicking it changes nothing at all.
    expect(heard).not.toHaveBeenCalled()
    expect(settingsStore.get()).toBe(before)
    expect(settingsStore.get().customColour).toBe(MY_PINK)
  })
})

describe('which theme card is marked', () => {
  it('is none, with "Custom", while the light is the colour of the player', () => {
    render(<LiveTab />)

    pickOwnColour(MY_PINK)

    expect(chosenThemes()).toEqual([])
    expect(saysCustom()).toBe(true)
    expect(checkedSwatches()).toEqual(['Your colour'])
  })

  it('is none even when the colour of the player is exactly the red of Ember', () => {
    render(<LiveTab />)

    fireEvent.click(swatch('Your colour'))

    expectSettings({ accent: 'custom' })
    expect(settingsStore.get().customColour).toBe('#ff2a2a')
    expect(chosenThemes()).toEqual([])
    expect(saysCustom()).toBe(true)
  })

  it('is exactly one, without "Custom", after each theme is clicked in turn', () => {
    render(<LiveTab />)

    for (const theme of [...LOOK_THEMES, ...LOOK_THEMES].reverse()) {
      fireEvent.click(themeCard(theme.name))
      expect(chosenThemes()).toEqual([theme.name])
      expect(saysCustom()).toBe(false)
      expect(matchingTheme(settingsStore.get())).toBe(theme.id)
    }
  })

  it('comes back when the one thing that was fine-tuned is put back', () => {
    render(<LiveTab />)
    fireEvent.click(themeCard('Gold'))
    const glow = within(option('Glow')).getByRole('slider')

    fireEvent.change(glow, { target: { value: '61' } })
    expect(chosenThemes()).toEqual([])
    expect(saysCustom()).toBe(true)

    fireEvent.change(glow, { target: { value: '60' } })
    expect(chosenThemes()).toEqual(['Gold'])
    expect(saysCustom()).toBe(false)
  })

  it('does not depend on what a theme does not set', () => {
    render(<LiveTab />)
    fireEvent.click(themeCard('Aurora'))

    act(() =>
      settingsStore.set({
        showTrails: false,
        showKeyHints: false,
        showNoteNames: false,
        autoHideMenu: false,
        volume: 0.1,
        pianoSize: 49,
      }),
    )

    expect(chosenThemes()).toEqual(['Aurora'])
  })

  it('follows the saved settings when they change under the tab', () => {
    render(<LiveTab />)
    const mono = LOOK_THEMES.find((theme) => theme.id === 'mono')

    act(() => settingsStore.set({ ...mono?.values }))
    expect(chosenThemes()).toEqual(['Mono'])
    expect(checkedSwatches()).toEqual(['White'])

    act(() => settingsStore.reset())
    expect(chosenThemes()).toEqual(['Ember'])
    expect(checkedSwatches()).toEqual(['Red'])
  })
})

describe('colours at the edges', () => {
  it.each([
    ['black', '#000000'],
    ['white', '#ffffff'],
    ['the darkest blue', '#000001'],
    ['a pale yellow', '#ffffe0'],
    ['in capital letters', '#AABBCC'],
  ])('takes %s from the colour picker as it is', (_name, colour) => {
    render(<LiveTab />)

    fireEvent.change(colourPicker(), { target: { value: colour } })

    expect(settingsStore.get().accent).toBe('custom')
    expect(settingsStore.get().customColour.toLowerCase()).toBe(colour.toLowerCase())
    // The swatch shows the light as it is on the stage: never darker than the stage can show.
    const shown = ownSwatchColour()
    expect(shown).toBe(paletteFor('custom', settingsStore.get().customColour).light)
    expect(shown).toMatch(/^#[0-9a-f]{6}$/)
    expect(['#000000', '#ffffff']).toContain(inkOn(shown))
  })

  it('falls back on the red of the start when it is handed something that is no colour', () => {
    render(<LiveTab />)
    fireEvent.change(colourPicker(), { target: { value: MY_PINK } })

    // Not possible with a real colour picker; a saved value could still be damaged.
    act(() => settingsStore.set({ customColour: 'pink' }))

    // The pink is not kept: anything that is not a colour becomes the default one.
    expect(settingsStore.get().customColour).toBe(DEFAULT_SETTINGS.customColour)
    expect(settingsStore.get().accent).toBe('custom')
    expect(ownSwatchColour()).toBe('#ff2a2a')
    expect(colourPicker().value).toBe('#ff2a2a')
    expect(checkedSwatches()).toEqual(['Your colour'])
  })

  it('shows one chosen swatch whatever the saved colour is', () => {
    render(<LiveTab />)
    const accents = ['red', 'amber', 'blue', 'green', 'purple', 'white', 'rainbow', 'custom']

    for (const accent of accents) {
      act(() => settingsStore.set({ accent: accent as typeof DEFAULT_SETTINGS.accent }))
      expect(checkedSwatches(), accent).toHaveLength(1)
      // One stop for the Tab key: the chosen colour.
      const stops = screen.getAllByRole('radio').filter((radio) => radio.tabIndex === 0)
      expect(stops, accent).toHaveLength(1)
      expect(stops[0]?.getAttribute('aria-checked')).toBe('true')
    }
  })
})
