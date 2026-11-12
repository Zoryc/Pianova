// @vitest-environment jsdom
/**
 * The About tab of the Settings panel: what the app is, the credit the piano
 * recordings ask for, what happens to the player's data, and "Reset all
 * settings".
 */
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { APP_NAME } from '../../app/appInfo'
import { player } from '../../app/songsApp'
import { DEFAULT_BINDINGS, assignBinding } from '../../input/keymap'
import { STARTER_SONGS } from '../../songs/starterSongs'
import { DEFAULT_SETTINGS, settingsStore } from '../../state/settings'
import type { Settings } from '../../state/settings'
import { closeSong, playSong } from '../useSongs'
import { AboutTab } from './AboutTab'
import { expectSettings, startEachTestFromDefaults } from './testSupport'

/** A song that comes with the app. Its notes are around the middle of the piano. */
const SONG = STARTER_SONGS[0]?.id ?? ''

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

  it('says what is lost when the data of the browser is cleared', () => {
    render(<AboutTab />)
    expect(
      screen.getByText(
        "Clearing the browser's data for this page removes your settings and songs.",
      ),
    ).toBeTruthy()
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

  describe('while a song is loaded', () => {
    // Whatever the test did, no song is left in the player for the next one.
    afterEach(() => act(() => closeSong()))

    it('leaves the songs alone, and is not undone when the song is closed', async () => {
      const user = userEvent.setup()
      settingsStore.set(CHANGED)
      // The song takes the computer keys from where the player had them to the
      // middle, which is also where they are at the start.
      act(() => {
        playSong(SONG)
      })
      expect(settingsStore.get().baseOctave).toBe(DEFAULT_SETTINGS.baseOctave)
      render(<AboutTab />)

      await user.click(screen.getByRole('button', { name: 'Reset all settings' }))
      await user.click(screen.getByRole('button', { name: 'Yes' }))
      expectSettings({})
      expect(player.getState()).toMatchObject({ status: 'playing', songId: SONG })

      // Closing a song puts the keys back where they were before it. Not here:
      // that place is from before the reset.
      act(() => closeSong())
      expectSettings({})
    })
  })
})

describe('what "Reset all settings" says once it is done', () => {
  /** The line that reports the reset. Screen readers say its text when it appears. */
  function report(): HTMLElement {
    return screen.getByRole('status')
  }

  it('is one line, after Yes', async () => {
    const user = userEvent.setup()
    settingsStore.set(CHANGED)
    render(<AboutTab />)

    await user.click(screen.getByRole('button', { name: 'Reset all settings' }))
    await user.click(screen.getByRole('button', { name: 'Yes' }))

    expect(report().textContent).toBe('Everything is back to how it was at the start.')
  })

  it('is said also when nothing had been changed: the answer is the same', async () => {
    const user = userEvent.setup()
    render(<AboutTab />)

    await user.click(screen.getByRole('button', { name: 'Reset all settings' }))
    await user.click(screen.getByRole('button', { name: 'Yes' }))

    expect(report().textContent).toBe('Everything is back to how it was at the start.')
  })

  it('is not said before the reset, while the question is asked, or after No', async () => {
    const user = userEvent.setup()
    settingsStore.set(CHANGED)
    render(<AboutTab />)
    expect(report().textContent).toBe('')

    await user.click(screen.getByRole('button', { name: 'Reset all settings' }))
    expect(report().textContent).toBe('')

    await user.click(screen.getByRole('button', { name: 'No' }))
    expect(report().textContent).toBe('')
  })

  it('appears in a line that was already on the page, so that screen readers announce it', async () => {
    const user = userEvent.setup()
    render(<AboutTab />)
    const line = report()

    await user.click(screen.getByRole('button', { name: 'Reset all settings' }))
    await user.click(screen.getByRole('button', { name: 'Yes' }))

    expect(report()).toBe(line)
    expect(line.textContent).not.toBe('')
  })

  it('is forgotten when the tab is left and come back to', async () => {
    const user = userEvent.setup()
    const view = render(<AboutTab />)
    await user.click(screen.getByRole('button', { name: 'Reset all settings' }))
    await user.click(screen.getByRole('button', { name: 'Yes' }))

    view.unmount()
    render(<AboutTab />)

    expect(report().textContent).toBe('')
  })
})

/*
 * A browser counts the clicks of a double-click in `detail`: 1 for the first,
 * 2 for the second, wherever the second one lands. The button and its answers
 * take each other's place, so the second click lands on whatever has just
 * appeared there.
 */
describe('a double-click on "Reset all settings" or on one of its answers', () => {
  function resetButton(): HTMLElement {
    return screen.getByRole('button', { name: 'Reset all settings' })
  }

  function answer(name: 'Yes' | 'No'): HTMLElement {
    return screen.getByRole('button', { name })
  }

  it.each(['Yes', 'No'] as const)(
    'asks the question and takes the second click for no answer when it lands on "%s"',
    (name) => {
      settingsStore.set(CHANGED)
      render(<AboutTab />)

      fireEvent.click(resetButton(), { detail: 1 })
      fireEvent.click(answer(name), { detail: 2 })

      expectSettings(CHANGED)
      expect(screen.getByText('Really reset?')).toBeTruthy()
    },
  )

  it('still takes a click of its own on either answer', () => {
    settingsStore.set(CHANGED)
    render(<AboutTab />)

    fireEvent.click(resetButton(), { detail: 1 })
    fireEvent.click(answer('No'), { detail: 1 })
    expect(screen.queryByText('Really reset?')).toBeNull()
    expectSettings(CHANGED)

    fireEvent.click(resetButton(), { detail: 1 })
    fireEvent.click(answer('Yes'), { detail: 1 })
    expect(screen.queryByText('Really reset?')).toBeNull()
    expectSettings({})
  })

  it.each(['Yes', 'No'] as const)(
    'does not ask again when the second click of a double-click on "%s" lands on the button',
    (name) => {
      render(<AboutTab />)
      fireEvent.click(resetButton(), { detail: 1 })

      fireEvent.click(answer(name), { detail: 1 })
      fireEvent.click(resetButton(), { detail: 2 })

      expect(screen.queryByText('Really reset?')).toBeNull()
      expect(resetButton()).toBeTruthy()
    },
  )
})
