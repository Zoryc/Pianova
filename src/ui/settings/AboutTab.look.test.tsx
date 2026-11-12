// @vitest-environment jsdom
/**
 * "Reset all settings", tried by someone in a hurry: a double-click, a click
 * that comes back, the answer given twice. The question exists so that a slip
 * of the hand does not wipe the player's keys and settings.
 *
 * A browser counts the clicks of a double-click in `detail`: 1 for the first,
 * 2 for the second, wherever the second one lands. Enter on a focused button
 * gives 0.
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { settingsStore } from '../../state/settings'
import type { Settings } from '../../state/settings'
import { AboutTab } from './AboutTab'
import { expectSettings, startEachTestFromDefaults } from './testSupport'

/** An evening of the player's own choices. */
const MINE: Partial<Settings> = {
  bindings: { KeyQ: 0, KeyW: 2, KeyE: 4 },
  customLabels: { KeyQ: 'q' },
  baseOctave: 2,
  accent: 'custom',
  customColour: '#00c2a8',
  keyStyle: 'glass',
  volume: 0.35,
}

function resetButton(): HTMLElement {
  return screen.getByRole('button', { name: 'Reset all settings' })
}

function answer(name: 'Yes' | 'No'): HTMLElement {
  return screen.getByRole('button', { name })
}

/** What the tab says once everything has been reset ('' until then). */
function report(): string {
  return screen.getByRole('status').textContent ?? ''
}

const RESET_DONE = 'Everything is back to how it was at the start.'

startEachTestFromDefaults()

describe('"Reset all settings" and a hand that is too fast', () => {
  it('does not take the second click of a double-click for the answer "Yes"', () => {
    settingsStore.set(MINE)
    render(<AboutTab />)

    // A double-click on the button. The question takes the place of the button
    // between the two clicks, with "Yes" where the right-hand part of the
    // button was: the second click of the pair lands on it.
    fireEvent.click(resetButton(), { detail: 1 })
    fireEvent.click(answer('Yes'), { detail: 2 })

    // The player has not had the time to read the question, let alone answer it.
    expectSettings(MINE)
    expect(screen.getByText('Really reset?')).toBeTruthy()
    expect(report()).toBe('')
  })

  it('does not take the second click of a double-click for the answer "No" either', () => {
    settingsStore.set(MINE)
    render(<AboutTab />)

    // The same double-click a little to the right, where "No" appears.
    fireEvent.click(resetButton(), { detail: 1 })
    fireEvent.click(answer('No'), { detail: 2 })

    // The question does not flash by: it stays, to be read and answered.
    expectSettings(MINE)
    expect(screen.getByText('Really reset?')).toBeTruthy()
  })

  it('takes a click of its own on "Yes" for the answer, and says that it is done', () => {
    settingsStore.set(MINE)
    render(<AboutTab />)

    fireEvent.click(resetButton(), { detail: 1 })
    fireEvent.click(answer('Yes'), { detail: 1 })

    expectSettings({})
    expect(screen.queryByText('Really reset?')).toBeNull()
    expect(report()).toBe(RESET_DONE)
  })

  it('does not ask again when "Yes" itself is double-clicked', () => {
    settingsStore.set(MINE)
    render(<AboutTab />)
    fireEvent.click(resetButton(), { detail: 1 })

    // The button comes back under the pointer between the two clicks.
    fireEvent.click(answer('Yes'), { detail: 1 })
    fireEvent.click(resetButton(), { detail: 2 })

    expectSettings({})
    expect(screen.queryByText('Really reset?')).toBeNull()
    expect(report()).toBe(RESET_DONE)
  })

  it('takes Enter on "Yes" for the answer', () => {
    settingsStore.set(MINE)
    render(<AboutTab />)

    fireEvent.click(resetButton(), { detail: 0 })
    answer('Yes').focus()
    fireEvent.click(answer('Yes'), { detail: 0 })

    expectSettings({})
    expect(report()).toBe(RESET_DONE)
  })

  it('resets nothing when Enter is pressed twice: the second one lands on "No"', () => {
    settingsStore.set(MINE)
    render(<AboutTab />)
    resetButton().focus()

    fireEvent.click(resetButton(), { detail: 0 })
    // Where the focus is now is where a second Enter goes.
    fireEvent.click(document.activeElement as HTMLElement, { detail: 0 })

    expectSettings(MINE)
    expect(document.activeElement).toBe(resetButton())
    expect(report()).toBe('')
  })

  it('asks again each time: an old "Yes" does not count for the next reset', () => {
    render(<AboutTab />)
    fireEvent.click(resetButton(), { detail: 1 })
    fireEvent.click(answer('Yes'), { detail: 1 })

    settingsStore.set(MINE)
    // The page is drawn again with the button, not with the answers.
    expect(screen.queryByRole('button', { name: 'Yes' })).toBeNull()
    fireEvent.click(resetButton(), { detail: 1 })

    expectSettings(MINE)
    expect(screen.getByText('Really reset?')).toBeTruthy()
  })

  it('saves the defaults once, and tells whoever listens once', () => {
    settingsStore.set(MINE)
    render(<AboutTab />)
    let heard = 0
    const stop = settingsStore.subscribe(() => {
      heard += 1
    })

    fireEvent.click(resetButton(), { detail: 1 })
    fireEvent.click(answer('No'), { detail: 1 })
    expect(heard).toBe(0)

    fireEvent.click(resetButton(), { detail: 1 })
    fireEvent.click(answer('Yes'), { detail: 1 })
    stop()

    expect(heard).toBe(1)
  })
})
