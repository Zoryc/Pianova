// @vitest-environment jsdom
/**
 * The player line and the progress line (src/ui/PlayerLine.tsx) as a player
 * uses them, with the app's real player and library behind them.
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { bus } from '../app/pianoApp'
import { player, songLibrary } from '../app/songsApp'
import { PlayerLine, SongProgressLine } from './PlayerLine'
import { SMALL_PIANO, addSong, resetSongs, showPiano } from './songsTestKit'
import type { PartSpec } from './songsTestKit'
import { LEAD_IN_SECONDS, closeSong, closeSongOptions, playSong } from './useSongs'

const MELODY_HINT = 'Plays one note at a time: the highest one.'
const FIT_HINT = 'Moves notes that are too low or too high onto the piano you see.'

/** Every song waits two seconds before its first note: this long on the fake clock. */
const LEAD_IN_MS = LEAD_IN_SECONDS * 1000

/** Adds a song, puts the two lines on the page and plays the song. Returns its id. */
async function playOnScreen(name: string, ...parts: PartSpec[]): Promise<string> {
  const song = await addSong(name, ...parts)
  render(
    <>
      <SongProgressLine />
      <PlayerLine />
    </>,
  )
  act(() => {
    playSong(song.id)
  })
  return song.id
}

function useFakeClock(): void {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'performance'] })
}

function letTimePass(milliseconds: number): void {
  act(() => {
    vi.advanceTimersByTime(milliseconds)
  })
}

function button(name: string): HTMLElement {
  return screen.getByRole('button', { name })
}

function click(element: HTMLElement): void {
  fireEvent.click(element, { detail: 1 })
}

function slider(name: string): HTMLInputElement {
  return screen.getByRole<HTMLInputElement>('slider', { name })
}

function moveSlider(name: string, value: number): void {
  fireEvent.change(slider(name), { target: { value: String(value) } })
}

function openOptions(): HTMLElement {
  click(button('Song options'))
  return screen.getByRole('group', { name: 'Song options' })
}

function toggle(name: string): HTMLElement {
  return screen.getByRole('switch', { name })
}

function parts(): HTMLElement[] {
  return screen.queryAllByRole('checkbox')
}

function partStates(): string[] {
  return parts().map((part) => {
    const state = part.getAttribute('aria-checked') === 'true' ? 'checked' : 'unchecked'
    return (part as HTMLButtonElement).disabled ? `${state}, fixed` : state
  })
}

function progressLine(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.song-progress')
}

function progressShown(): number {
  return Number(progressLine()?.style.getPropertyValue('--song-progress'))
}

function pitchesPlayed(): number[] {
  const heard: number[] = []
  const stopListening = bus.subscribe((event) => {
    if (event.type === 'on') heard.push(event.midi)
  })
  act(() => player.stop())
  act(() => player.play())
  letTimePass(60_000)
  stopListening()
  return heard
}

beforeEach(resetSongs)

afterEach(async () => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  await resetSongs()
  bus.allOff()
})

describe('with no song loaded', () => {
  it('shows neither the player line nor the progress line', () => {
    const { container } = render(
      <>
        <SongProgressLine />
        <PlayerLine />
      </>,
    )
    expect(container.innerHTML).toBe('')
  })
})

describe('the player line', () => {
  it('appears when a song is loaded, with its controls in order', async () => {
    await playOnScreen('Moonlight.mid')
    const line = screen.getByRole('region', { name: 'Song player' })

    const controls = [...line.querySelectorAll('button, input')].map(
      (control) => control.getAttribute('aria-label') ?? control.textContent,
    )
    expect(controls).toEqual([
      'Pause',
      'Stop',
      'Position in the song',
      'Speed',
      'Song options▾',
      'Close',
    ])
    expect(within(line).getByText('Moonlight').title).toBe('Moonlight')
  })

  it('has one button that pauses a playing song and plays a paused one', async () => {
    await playOnScreen('Moonlight.mid')
    expect(screen.queryByRole('button', { name: 'Play' })).toBeNull()

    click(button('Pause'))
    expect(player.getState().status).toBe('paused')
    expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull()

    click(button('Play'))
    expect(player.getState().status).toBe('playing')
    expect(button('Pause')).toBeTruthy()
  })

  it('stops the song and goes back to the start', async () => {
    useFakeClock()
    await playOnScreen('Moonlight.mid')
    letTimePass(900)

    click(button('Stop'))
    expect(player.getState()).toMatchObject({ status: 'stopped', position: 0 })
    expect(bus.getActiveNotes().size).toBe(0)
    expect(button('Play')).toBeTruthy()
    expect(slider('Position in the song').value).toBe('0')
  })

  it('shows the Play button again when the song has reached its end', async () => {
    useFakeClock()
    await playOnScreen('Short.mid', { notes: [60, 62] })
    letTimePass(LEAD_IN_MS + 1100)

    expect(player.getState()).toMatchObject({ status: 'stopped', position: 0 })
    expect(button('Play')).toBeTruthy()
    click(button('Play'))
    expect(player.getState().status).toBe('playing')
  })

  it('closes the song and goes away', async () => {
    await playOnScreen('Moonlight.mid')
    click(button('Close'))

    expect(player.getState()).toMatchObject({ status: 'empty', songId: null })
    expect(screen.queryByRole('region', { name: 'Song player' })).toBeNull()
    expect(progressLine()).toBeNull()
  })

  it('shows the song that is loaded next', async () => {
    await playOnScreen('Moonlight.mid')
    act(() => {
      playSong('starter:jingle-bells')
    })
    expect(screen.getByText('Jingle Bells')).toBeTruthy()
    expect(screen.queryByText('Moonlight')).toBeNull()
  })

  it('works the way React draws the app in development', async () => {
    const song = await addSong('Moonlight.mid')
    render(
      <StrictMode>
        <PlayerLine />
      </StrictMode>,
    )
    act(() => {
      playSong(song.id)
    })
    click(button('Pause'))
    expect(player.getState().status).toBe('paused')
  })
})

describe('the position in the song', () => {
  it('is a slider from the start to the end of the song, with the time played and the length', async () => {
    await playOnScreen('Moonlight.mid', { notes: [60, 62, 64, 65, 67, 69, 71, 72] })
    const position = slider('Position in the song')

    // Four seconds of notes after the two seconds in which the first one falls.
    expect(position.min).toBe('0')
    expect(Number(position.max)).toBeCloseTo(6)
    expect(position.value).toBe('0')
    expect(position.getAttribute('aria-valuetext')).toBe('0:00 of 0:06')
    const times = [...document.querySelectorAll('.player-line__time')].map((time) => time.textContent)
    expect(times).toEqual(['0:00', '0:06'])
  })

  it('moves the song when it is dragged', async () => {
    await playOnScreen('Moonlight.mid', { notes: [60, 62, 64, 65, 67, 69, 71, 72] })
    click(button('Pause'))
    moveSlider('Position in the song', 2.5)

    expect(player.getState()).toMatchObject({ status: 'paused', position: 2.5 })
    expect(slider('Position in the song').value).toBe('2.5')
    expect(slider('Position in the song').getAttribute('aria-valuetext')).toBe('0:02 of 0:06')
  })

  it('carries on from the new place when the song is playing, with no note left held', async () => {
    useFakeClock()
    await playOnScreen('Moonlight.mid', { notes: [60, 62, 64, 65, 67, 69, 71, 72] })
    letTimePass(LEAD_IN_MS + 200)
    expect([...bus.getActiveNotes()]).toEqual([60])

    moveSlider('Position in the song', LEAD_IN_SECONDS + 3.1)
    expect(bus.getActiveNotes().size).toBe(0)
    letTimePass(500)
    expect(player.getState().status).toBe('playing')
    expect([...bus.getActiveNotes()]).toEqual([72])
  })

  it('can be dragged back to before the first note, which then falls and is played again', async () => {
    useFakeClock()
    await playOnScreen('Moonlight.mid', { notes: [60, 62, 64, 65, 67, 69, 71, 72] })
    letTimePass(LEAD_IN_MS + 1200)
    expect([...bus.getActiveNotes()]).toEqual([64])

    moveSlider('Position in the song', 1)
    letTimePass(900)
    expect(bus.getActiveNotes().size).toBe(0)
    letTimePass(200)
    expect([...bus.getActiveNotes()]).toEqual([60])
  })

  it('follows the song as it plays', async () => {
    useFakeClock()
    await playOnScreen('Moonlight.mid', { notes: [60, 62, 64, 65, 67, 69, 71, 72] })
    letTimePass(2300)

    // The player reports its place about ten times a second.
    const shown = Number(slider('Position in the song').value)
    expect(shown).toBeGreaterThan(2.15)
    expect(shown).toBeLessThanOrEqual(2.3)
    expect(document.querySelector('.player-line__time')?.textContent).toBe('0:02')
  })
})

describe('the speed', () => {
  it('is a slider from 50% to 150% in steps of 5 that shows its value', async () => {
    await playOnScreen('Moonlight.mid')
    const speed = slider('Speed')

    expect([speed.min, speed.max, speed.step, speed.value]).toEqual(['50', '150', '5', '100'])
    expect(speed.getAttribute('aria-valuetext')).toBe('100%')
    expect(screen.getByText('100%')).toBeTruthy()
    expect(screen.getByText('Speed')).toBeTruthy()
  })

  it('changes how fast the song goes, at once', async () => {
    useFakeClock()
    await playOnScreen('Moonlight.mid', { notes: [60, 62, 64, 65, 67, 69, 71, 72] })
    moveSlider('Speed', 50)
    expect(player.getState().speed).toBe(0.5)
    expect(screen.getByText('50%')).toBeTruthy()

    letTimePass(1000)
    expect(player.getPosition()).toBeCloseTo(0.5, 1)
    moveSlider('Speed', 150)
    letTimePass(1000)
    expect(player.getPosition()).toBeCloseTo(2, 1)
  })

  it('is saved with the song, and each song has its own', async () => {
    const moonlight = await playOnScreen('Moonlight.mid')
    moveSlider('Speed', 65)
    expect(songLibrary.getOptions(moonlight).speed).toBe(0.65)

    act(() => {
      playSong('starter:ode-to-joy')
    })
    expect(slider('Speed').value).toBe('100')
    moveSlider('Speed', 120)

    act(() => {
      playSong(moonlight)
    })
    expect(slider('Speed').value).toBe('65')
    expect(screen.getByText('65%')).toBeTruthy()
    act(() => {
      playSong('starter:ode-to-joy')
    })
    expect(slider('Speed').value).toBe('120')
  })
})

describe('song options', () => {
  it('are closed until their button is pressed, and closed by it again', async () => {
    await playOnScreen('Moonlight.mid')
    const opener = button('Song options')
    expect(opener.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('group', { name: 'Song options' })).toBeNull()

    const options = openOptions()
    expect(opener.getAttribute('aria-expanded')).toBe('true')
    expect(opener.getAttribute('aria-controls')).toBe(options.id)

    click(opener)
    expect(opener.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('group', { name: 'Song options' })).toBeNull()
  })

  it('go away at a press of the mouse anywhere else, but not at one inside the player line', async () => {
    await playOnScreen('Moonlight.mid')
    openOptions()
    fireEvent.pointerDown(toggle('Melody only'))
    fireEvent.pointerDown(slider('Speed'))
    expect(screen.queryByRole('group', { name: 'Song options' })).not.toBeNull()

    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('group', { name: 'Song options' })).toBeNull()
    expect(button('Song options').getAttribute('aria-expanded')).toBe('false')
  })

  it('go away when the keyboard focus moves on to a control outside the player line', async () => {
    await playOnScreen('Moonlight.mid')
    const elsewhere = document.body.appendChild(document.createElement('button'))
    openOptions()

    act(() => toggle('Melody only').focus())
    act(() => button('Close').focus())
    expect(screen.queryByRole('group', { name: 'Song options' })).not.toBeNull()
    // A button that lets go of the focus after a click with the mouse has not moved it anywhere.
    act(() => button('Close').blur())
    expect(screen.queryByRole('group', { name: 'Song options' })).not.toBeNull()

    act(() => toggle('Melody only').focus())
    act(() => elsewhere.focus())
    expect(screen.queryByRole('group', { name: 'Song options' })).toBeNull()
    elsewhere.remove()
  })

  it('go away when a file is dropped on the page, which opens the Songs panel under them', async () => {
    await playOnScreen('Moonlight.mid')
    openOptions()
    fireEvent.drop(document.body)
    expect(screen.queryByRole('group', { name: 'Song options' })).toBeNull()
    expect(button('Song options').getAttribute('aria-expanded')).toBe('false')
  })

  it('can be closed from outside the line, which is how the app closes them at Escape', async () => {
    await playOnScreen('Moonlight.mid')
    openOptions()

    let closed = false
    act(() => {
      closed = closeSongOptions()
    })
    expect(closed).toBe(true)
    expect(screen.queryByRole('group', { name: 'Song options' })).toBeNull()
    expect(button('Song options').getAttribute('aria-expanded')).toBe('false')
    // They open again as usual.
    expect(openOptions()).toBeTruthy()
  })

  it('give the keyboard focus to their button when they are closed with the focus on one of them', async () => {
    await playOnScreen('Moonlight.mid')
    openOptions()
    act(() => toggle('Fit to the piano').focus())

    act(() => {
      closeSongOptions()
    })
    expect(document.activeElement).toBe(button('Song options'))
  })

  it('leave the keyboard focus where it is when they are closed with the focus somewhere else', async () => {
    await playOnScreen('Moonlight.mid')
    openOptions()
    act(() => button('Stop').focus())
    act(() => {
      closeSongOptions()
    })
    expect(document.activeElement).toBe(button('Stop'))

    openOptions()
    act(() => button('Stop').blur())
    act(() => {
      closeSongOptions()
    })
    expect(document.activeElement).toBe(document.body)
  })

  it('start closed again for the next song', async () => {
    await playOnScreen('Moonlight.mid')
    openOptions()
    act(() => {
      playSong('starter:jingle-bells')
    })
    expect(button('Song options').getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('group', { name: 'Song options' })).toBeNull()
  })

  it('start closed again when the same song is closed and played once more', async () => {
    const song = await playOnScreen('Moonlight.mid')
    openOptions()
    act(() => closeSong())
    act(() => {
      playSong(song)
    })
    expect(button('Song options').getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('group', { name: 'Song options' })).toBeNull()
  })

  it('explain "Melody only" and "Fit to the piano", both off at first', async () => {
    await playOnScreen('Moonlight.mid')
    const options = openOptions()

    expect(within(options).getByText(MELODY_HINT)).toBeTruthy()
    expect(within(options).getByText(FIT_HINT)).toBeTruthy()
    expect(toggle('Melody only').getAttribute('aria-checked')).toBe('false')
    expect(toggle('Fit to the piano').getAttribute('aria-checked')).toBe('false')
  })

  it('play one note at a time with "Melody only"', async () => {
    useFakeClock()
    const song = await playOnScreen('Chords.mid', { notes: [60, 62] }, { notes: [72, 74] })
    openOptions()
    click(toggle('Melody only'))

    expect(toggle('Melody only').getAttribute('aria-checked')).toBe('true')
    expect(songLibrary.getOptions(song).melodyOnly).toBe(true)
    expect(pitchesPlayed()).toEqual([72, 74])

    click(toggle('Melody only'))
    expect(pitchesPlayed()).toEqual([60, 72, 62, 74])
  })

  it('keep the song playing at its place when one of them changes', async () => {
    useFakeClock()
    await playOnScreen('Chords.mid', { notes: [60, 62, 64, 65] }, { notes: [72, 74, 76, 77] })
    openOptions()
    letTimePass(1200)

    click(toggle('Melody only'))
    expect(player.getState().status).toBe('playing')
    expect(player.getPosition()).toBeCloseTo(1.2, 1)
    click(toggle('Fit to the piano'))
    expect(player.getState().status).toBe('playing')
    expect(player.getPosition()).toBeCloseTo(1.2, 1)
  })

  it('are saved with the song and come back the next time it is loaded', async () => {
    const song = await playOnScreen('Moonlight.mid')
    openOptions()
    click(toggle('Melody only'))
    click(toggle('Fit to the piano'))
    act(() => closeSong())

    act(() => {
      playSong('starter:jingle-bells')
    })
    openOptions()
    expect(toggle('Melody only').getAttribute('aria-checked')).toBe('false')

    act(() => {
      playSong(song)
    })
    openOptions()
    expect(toggle('Melody only').getAttribute('aria-checked')).toBe('true')
    expect(toggle('Fit to the piano').getAttribute('aria-checked')).toBe('true')
  })
})

describe('notes that are off the piano', () => {
  const OFF_PIANO = /to show on the piano/

  it('are counted in a quiet line, which goes away with "Fit to the piano"', async () => {
    showPiano(SMALL_PIANO)
    const song = await playOnScreen('Wide.mid', { notes: [30, 40, 60, 100] })
    const options = openOptions()
    expect(within(options).getByText(OFF_PIANO).textContent).toBe(
      '3 notes are too low or too high to show on the piano. They still play.',
    )

    click(toggle('Fit to the piano'))
    expect(within(options).queryByText(OFF_PIANO)).toBeNull()
    expect(songLibrary.getOptions(song).fitToPiano).toBe(true)

    click(toggle('Fit to the piano'))
    expect(within(options).getByText(OFF_PIANO)).toBeTruthy()
  })

  it('are counted as "1 note is" when there is one', async () => {
    showPiano(SMALL_PIANO)
    await playOnScreen('Wide.mid', { notes: [30, 60, 62] })
    expect(within(openOptions()).getByText(OFF_PIANO).textContent).toBe(
      '1 note is too low or too high to show on the piano. It still plays.',
    )
  })

  it('are not mentioned when every note is on the piano', async () => {
    showPiano(SMALL_PIANO)
    await playOnScreen('Narrow.mid', { notes: [48, 60, 84] })
    expect(within(openOptions()).queryByText(OFF_PIANO)).toBeNull()
  })

  it('are counted for the piano on screen, not for a full piano', async () => {
    await playOnScreen('Wide.mid', { notes: [30, 60, 100] })
    expect(within(openOptions()).queryByText(OFF_PIANO)).toBeNull()
  })
})

describe('the parts of a song', () => {
  const DUET: PartSpec[] = [
    { name: 'Right hand', program: 0, notes: [72, 74, 76] },
    { program: 40, notes: [48] },
    { name: 'Kit', drums: true, notes: [36, 38] },
  ]

  it('are not offered for a song with one part', async () => {
    await playOnScreen('Solo.mid', { notes: [60, 62] })
    openOptions()
    expect(parts()).toEqual([])
    expect(screen.queryByText('Parts')).toBeNull()
  })

  it('are not offered for one part with drums, which the piano never plays', async () => {
    await playOnScreen('Band.mid', { notes: [60, 62] }, { drums: true, notes: [36, 38] })
    openOptions()
    expect(parts()).toEqual([])
  })

  it('are checkboxes named after the part, its instrument and its notes, all checked at first', async () => {
    await playOnScreen('Duet.mid', ...DUET)
    const options = openOptions()

    expect(within(options).getByRole('group', { name: 'Parts' })).toBeTruthy()
    expect(parts().map((part) => part.textContent)).toEqual([
      'Right hand · Piano · 3 notes',
      'Part 2 · Strings · 1 note',
    ])
    expect(partStates()).toEqual(['checked', 'checked'])
  })

  it('play only the parts that are checked, and remember the choice', async () => {
    useFakeClock()
    const song = await playOnScreen('Duet.mid', ...DUET)
    openOptions()
    click(parts()[0] as HTMLElement)

    expect(songLibrary.getOptions(song).trackIds).toEqual([2])
    expect(pitchesPlayed()).toEqual([48])
  })

  it('never let the last checked part be unchecked', async () => {
    const song = await playOnScreen('Duet.mid', ...DUET)
    openOptions()
    click(parts()[1] as HTMLElement)
    expect(partStates()).toEqual(['checked, fixed', 'unchecked'])

    click(parts()[0] as HTMLElement)
    expect(partStates()).toEqual(['checked, fixed', 'unchecked'])
    expect(songLibrary.getOptions(song).trackIds).toEqual([1])
  })

  it('go back to "every part" when all are checked again', async () => {
    const song = await playOnScreen('Duet.mid', ...DUET)
    openOptions()
    click(parts()[1] as HTMLElement)
    click(parts()[1] as HTMLElement)

    expect(partStates()).toEqual(['checked', 'checked'])
    expect(songLibrary.getOptions(song).trackIds).toBe('auto')
  })

  it('are buttons, so that Space stays the sustain key', async () => {
    await playOnScreen('Duet.mid', ...DUET)
    openOptions()
    expect(parts().map((part) => part.tagName)).toEqual(['BUTTON', 'BUTTON'])
  })
})

describe('the progress line', () => {
  it('is drawn for the eye only, and empty at the start of the song', async () => {
    await playOnScreen('Moonlight.mid')
    expect(progressLine()?.getAttribute('aria-hidden')).toBe('true')
    expect(progressShown()).toBe(0)
  })

  it('fills up as the song goes on, and empties when it stops', async () => {
    useFakeClock()
    await playOnScreen('Moonlight.mid', { notes: [60, 62, 64, 65, 67, 69, 71, 72] })
    // Six seconds in all: the two in which the first note falls, and four of notes.
    letTimePass(1500)
    expect(progressShown()).toBeCloseTo(0.25, 1)

    moveSlider('Position in the song', 4.5)
    expect(progressShown()).toBeCloseTo(0.75, 2)
    click(button('Stop'))
    expect(progressShown()).toBe(0)
  })

  it('is full where the last note ends, and empty again once the song is over', async () => {
    useFakeClock()
    await playOnScreen('Short.mid', { notes: [60, 62] })
    click(button('Pause'))
    moveSlider('Position in the song', Number(slider('Position in the song').max))
    expect(progressShown()).toBe(1)

    moveSlider('Position in the song', LEAD_IN_SECONDS + 0.9)
    click(button('Play'))
    letTimePass(200)
    expect(player.getState()).toMatchObject({ status: 'stopped', position: 0 })
    expect(progressShown()).toBe(0)
  })

  it('is there without the player line, which hides with the menu', async () => {
    const song = await addSong('Moonlight.mid')
    render(<SongProgressLine />)
    act(() => {
      playSong(song.id)
    })
    expect(progressLine()).not.toBeNull()
  })
})
