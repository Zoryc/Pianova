// @vitest-environment jsdom
/**
 * The About tab of the Settings panel: what the app is, the credit the piano
 * recordings ask for, what happens to the player's data, and "Reset all
 * settings".
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { APP_NAME } from '../../app/appInfo'
import { DEFAULT_BINDINGS, assignBinding } from '../../input/keymap'
import { settingsStore } from '../../state/settings'
import type { Settings } from '../../state/settings'
import { AboutTab } from './AboutTab'
import { expectSettings, startEachTestFromDefaults } from './testSupport'

/** Settings a player has made their own, in every part of the app. */
const CHANGED: Partial<Settings> = {
  bindings: assignBinding(DEFAULT_BINDINGS, 'KeyZ', 0).bindings,
  customLabels: { KeyZ: 'W' },
  baseOctave: 4,
  volume: 0.3,
  sustain: true,
  noteNaming: 'solfege',
  pianoSize: 61,
  keyStyle: 'glass',
  keyboardType: 'azerty',
  accent: 'custom',
  customColour: '#00c2a8',
  glow: 0.2,
  autoHideMenu: false,
}

startEachTestFromDefaults()

describe('the About tab', () => {
  it('says what the app is, under its name', () => {
    render(<AboutTab />)
    expect(screen.getByRole('heading', { name: APP_NAME })).toBeTruthy()
    expect(screen.getByText('A piano you play with your computer keyboard.')).toBeTruthy()
  })

  it('credits the piano recordings, with a link to their licence', () => {
    const { container } = render(<AboutTab />)
    expect(container.textContent).toContain(
      'Piano sound: Salamander Grand Piano by Alexander Holm (CC BY 3.0)',
    )

    const licence = screen.getByRole<HTMLAnchorElement>('link', { name: 'CC BY 3.0' })
    expect(licence.href).toBe('https://creativecommons.org/licenses/by/3.0/')
    // Opens in a new tab, which is not told where the click came from.
    expect(licence.target).toBe('_blank')
    expect(licence.rel).toBe('noreferrer')
  })

  it('says that nothing leaves the browser', () => {
    render(<AboutTab />)
    expect(screen.getByText('Everything stays in your browser. Nothing is uploaded.')).toBeTruthy()
  })

  it('says what "Reset all settings" does', () => {
    render(<AboutTab />)
    expect(screen.getByRole('button', { name: 'Reset all settings' })).toBeTruthy()
    expect(
      screen.getByText('Puts every setting and every key back to how it was at the start.'),
    ).toBeTruthy()
  })

  it('asks before it resets anything', async () => {
    const user = userEvent.setup()
    settingsStore.set(CHANGED)
    render(<AboutTab />)

    await user.click(screen.getByRole('button', { name: 'Reset all settings' }))
    expect(screen.getByText('Really reset?')).toBeTruthy()
    expectSettings(CHANGED)

    await user.click(screen.getByRole('button', { name: 'No' }))
    expectSettings(CHANGED)
    expect(screen.getByRole('button', { name: 'Reset all settings' })).toBeTruthy()
  })

  it('puts every setting and every key back on Yes', async () => {
    const user = userEvent.setup()
    settingsStore.set(CHANGED)
    render(<AboutTab />)

    await user.click(screen.getByRole('button', { name: 'Reset all settings' }))
    await user.click(screen.getByRole('button', { name: 'Yes' }))

    expectSettings({})
  })
})
