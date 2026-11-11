/** What the tests of the Settings panel and of its tabs share. */
import { cleanup, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect } from 'vitest'
import { DEFAULT_SETTINGS, settingsStore } from '../../state/settings'
import type { Settings } from '../../state/settings'

/** Every test of the file starts from the default settings and leaves nothing behind. */
export function startEachTestFromDefaults(): void {
  beforeEach(() => {
    settingsStore.reset()
  })

  afterEach(() => {
    cleanup()
    settingsStore.reset()
    window.localStorage.clear()
  })
}

/**
 * The saved settings are the defaults with exactly these changes: the right
 * setting was changed, and no other.
 */
export function expectSettings(changes: Partial<Settings>): void {
  expect(settingsStore.get()).toEqual({ ...DEFAULT_SETTINGS, ...changes })
}

/** The row of one option, found by its name: it holds the control and the explanation. */
export function option(name: string): HTMLElement {
  return screen.getByRole('group', { name })
}

/** The explanation an element points screen readers to, or '' when it has none. */
export function explanationOf(element: Element): string {
  const id = element.getAttribute('aria-describedby')
  const explanation = id === null ? null : document.getElementById(id)
  return explanation?.textContent ?? ''
}

/** The names of the options of a tab and its titles, top to bottom, as a player reads them. */
export function namesInOrder(container: Element): string[] {
  const names = container.querySelectorAll('.field__label, .settings-label, h3')
  return [...names].map((name) => name.textContent ?? '')
}

/** True when the button is drawn as the chosen one of its row or group. */
export function isChosen(button: Element): boolean {
  return button.getAttribute('aria-pressed') === 'true'
}
