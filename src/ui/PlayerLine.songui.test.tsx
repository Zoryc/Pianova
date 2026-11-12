// @vitest-environment jsdom
/**
 * The player line (src/ui/PlayerLine.tsx) in the corners: the position
 * dragged to the very end, a stopped song that is moved, options and names
 * that change in the middle of a long note, and the way through the line for
 * someone with the keyboard alone.
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { writeMidi } from 'midi-file'
import type { MidiEvent } from 'midi-file'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { bus } from '../app/pianoApp'
import { player, songLibrary } from '../app/songsApp'
import type { NoteEvent } from '../core/types'
import { PlayerLine, SongProgressLine } from './PlayerLine'
import { FULL_PIANO, SMALL_PIANO, addSong, fakeFile, resetSongs, showPiano } from './songsTestKit'
import type { PartSpec } from './songsTestKit'
import { LEAD_IN_SECONDS, closeSongOptions, importSongFiles, playSong } from './useSongs'

/** Ticks in one beat. A beat lasts half a second in a file that sets no speed. */
const BEAT = 480

/**
 * Every song of these tests has its first note at its very start, so the
 * player gives it the whole lead-in: the first note sounds this long after
 * "Play", and the song in the player is that much longer than its notes.
 */
const LEAD_IN_MS = LEAD_IN_SECONDS * 1000

/** One note of a hand-made file: which one, when it starts and how long it lasts, in beats. */
interface LongNote {
  midi: number
  start: number
  beats: number
}

/** The bytes of a MIDI file with one part, whose notes may overlap and last as long as they like. */
function fileOfNotes(notes: readonly LongNote[]): Uint8Array {
  const changes = notes
    .flatMap((note) => [
      { tick: note.start * BEAT, on: true, midi: note.midi },
      { tick: (note.start + note.beats) * BEAT, on: false, midi: note.midi },
    ])
    .sort((a, b) => a.tick - b.tick || Number(a.on) - Number(b.on))
  const events: MidiEvent[] = []
  let tick = 0
  for (const change of changes) {
    const deltaTime = change.tick - tick
    tick = change.tick
    events.push(
      change.on
        ? { deltaTime, type: 'noteOn', channel: 0, noteNumber: change.midi, velocity: 100 }
        : { deltaTime, type: 'noteOff', channel: 0, noteNumber: change.midi, velocity: 0 },
    )
  }
  const end: MidiEvent = { deltaTime: 0, meta: true, type: 'endOfTrack' }
  const header = { format: 1 as const, numTracks: 2, ticksPerBeat: BEAT }
  return Uint8Array.from(writeMidi({ header, tracks: [[end], [...events, end]] }))
}

function drawLines(): void {
  render(
    <>
      <SongProgressLine />
      <PlayerLine />
    </>,
  )
}

/** Adds a song made of the kit's half-second notes, draws the lines and plays it. */
async function playOnScreen(name: string, ...parts: PartSpec[]): Promise<string> {
  const song = await addSong(name, ...parts)
  drawLines()
  act(() => {
    playSong(song.id)
  })
  return song.id
}

/**
 * A chord of two notes held for eight seconds, with a short note in the
 * middle of it (after three seconds) and one after it.
 */
async function playLongChord(): Promise<string> {
  const bytes = fileOfNotes([
    { midi: 48, start: 0, beats: 16 },
    { midi: 55, start: 0, beats: 16 },
    { midi: 72, start: 6, beats: 1 },
    { midi: 74, start: 16, beats: 1 },
  ])
  await act(() => importSongFiles([fakeFile('Long chord.mid', bytes)]))
  const song = songLibrary.list().find((candidate) => candidate.title === 'Long chord')
  if (!song) throw new Error('The song was not added.')
  drawLines()
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

function heldNotes(): number[] {
  return [...bus.getActiveNotes()].sort((a, b) => a - b)
}

function times(): (string | null)[] {
  return [...document.querySelectorAll('.player-line__time')].map((time) => time.textContent)
}

/** What ends the listening of each `listenToBus`: called after the test that asked for it. */
const stopListening: (() => void)[] = []

/** Every note event on the bus from now on, until the end of the test. */
function listenToBus(): NoteEvent[] {
  const events: NoteEvent[] = []
  stopListening.push(bus.subscribe((event) => events.push(event)))
  return events
}

beforeEach(resetSongs)

afterEach(async () => {
  for (const stop of stopListening.splice(0)) stop()
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  await resetSongs()
  bus.allOff()
})

describe('the position, dragged as far as it goes', () => {
  /** Four seconds of notes: six seconds in the player, with the two before the first note. */
  const EIGHT_NOTES = { notes: [60, 62, 64, 65, 67, 69, 71, 72] }

  it('to the very end while the song plays: the song is over, back at the start, with nothing held', async () => {
    useFakeClock()
    await playOnScreen('Tune.mid', EIGHT_NOTES)
    letTimePass(700)
    moveSlider('Position in the song', Number(slider('Position in the song').max))
    letTimePass(20)

    expect(player.getState()).toMatchObject({ status: 'stopped', position: 0 })
    expect(heldNotes()).toEqual([])
    expect(button('Play')).toBeTruthy()
    expect(slider('Position in the song').value).toBe('0')
    expect(times()).toEqual(['0:00', '0:06'])
  })

  it('to the very end while the song is paused: it waits there, and Play starts it from the top', async () => {
    useFakeClock()
    await playOnScreen('Tune.mid', EIGHT_NOTES)
    click(button('Pause'))
    moveSlider('Position in the song', Number(slider('Position in the song').max))

    expect(player.getState().status).toBe('paused')
    expect(times()).toEqual(['0:06', '0:06'])

    click(button('Play'))
    expect(player.getPosition()).toBeLessThan(0.01)
    letTimePass(LEAD_IN_MS + 100)
    expect(player.getState().status).toBe('playing')
    expect(heldNotes()).toEqual([60])
  })

  it('back to the very start while the song plays: the first note is played again', async () => {
    useFakeClock()
    await playOnScreen('Tune.mid', EIGHT_NOTES)
    letTimePass(LEAD_IN_MS + 1700)
    expect(heldNotes()).toEqual([65])

    moveSlider('Position in the song', 0)
    expect(heldNotes()).toEqual([])
    // It falls for two seconds again, as when the song was started, and then sounds.
    letTimePass(LEAD_IN_MS - 100)
    expect(heldNotes()).toEqual([])
    letTimePass(120)
    expect(heldNotes()).toEqual([60])
  })

  it('past either end, or to no number at all: the song stays inside itself', async () => {
    await playOnScreen('Tune.mid', EIGHT_NOTES)
    click(button('Pause'))
    act(() => player.seek(99))
    expect(player.getState().position).toBeCloseTo(LEAD_IN_SECONDS + 4, 5)
    act(() => player.seek(-5))
    expect(player.getState().position).toBe(0)
    act(() => player.seek(Number.NaN))
    expect(player.getState().position).toBe(0)
    expect(slider('Position in the song').value).toBe('0')
  })
})

describe('a song that is stopped', () => {
  it('can be moved without starting, plays on from there, and "Restart" takes it back to the start', async () => {
    useFakeClock()
    await playOnScreen('Tune.mid', { notes: [60, 62, 64, 65, 67, 69, 71, 72] })
    click(button('Restart'))
    // To a little over two seconds into the notes of the song.
    moveSlider('Position in the song', LEAD_IN_SECONDS + 2.1)

    expect(player.getState()).toMatchObject({ status: 'stopped', position: LEAD_IN_SECONDS + 2.1 })
    letTimePass(500)
    expect(heldNotes()).toEqual([])
    expect(times()).toEqual(['0:04', '0:06'])

    click(button('Play'))
    letTimePass(500)
    expect(heldNotes()).toEqual([69])

    click(button('Restart'))
    expect(player.getState()).toMatchObject({ status: 'stopped', position: 0 })
    expect(heldNotes()).toEqual([])
  })

  it('is left as it is when "Restart" is pressed again', async () => {
    await playOnScreen('Tune.mid')
    click(button('Restart'))
    const before = player.getState()
    click(button('Restart'))
    expect(player.getState()).toBe(before)
    expect(before).toMatchObject({ status: 'stopped', position: 0 })
  })
})

describe('in the middle of a long note', () => {
  it('"Melody only" takes effect at once: the low note goes, and the song carries on', async () => {
    useFakeClock()
    await playLongChord()
    letTimePass(LEAD_IN_MS + 1000)
    expect(heldNotes()).toEqual([48, 55])

    click(button('Song options'))
    click(screen.getByRole('switch', { name: 'Melody only' }))
    // The chord that was sounding is let go; from here on one note at a time is played.
    expect(heldNotes()).toEqual([])
    expect(player.getState().status).toBe('playing')
    expect(player.getPosition()).toBeCloseTo(LEAD_IN_SECONDS + 1, 1)

    letTimePass(2100)
    expect(heldNotes()).toEqual([72])
    letTimePass(5100)
    expect(heldNotes()).toEqual([74])
  })

  it('a change of speed leaves the notes that are sounding alone', async () => {
    useFakeClock()
    await playLongChord()
    letTimePass(LEAD_IN_MS + 1000)
    expect(heldNotes()).toEqual([48, 55])
    const events = listenToBus()

    moveSlider('Speed', 150)
    moveSlider('Speed', 50)
    expect(events).toEqual([])
    expect(heldNotes()).toEqual([48, 55])
  })

  it('a new name for the song does not cut off the notes that are sounding', async () => {
    useFakeClock()
    const id = await playLongChord()
    letTimePass(LEAD_IN_MS + 1000)
    expect(heldNotes()).toEqual([48, 55])
    const events = listenToBus()

    act(() => songLibrary.rename(id, 'Evening chord'))

    // The line shows the new name, and the song plays on from the same place…
    expect(within(screen.getByRole('region', { name: 'Song player' })).getByText('Evening chord')).toBeTruthy()
    expect(player.getState().status).toBe('playing')
    // …and its sound is not touched: a name is not a note.
    expect(events).toEqual([])
    expect(heldNotes()).toEqual([48, 55])
    // The chord is let go when the song says so, seven seconds later, and not before.
    letTimePass(6900)
    expect(heldNotes()).toEqual([48, 55])
    letTimePass(200)
    expect(heldNotes()).toEqual([74])
  })

  it('"Pause" lets go of the notes, and "Play" carries on with the notes that start next', async () => {
    useFakeClock()
    await playLongChord()
    letTimePass(LEAD_IN_MS + 1000)
    expect(heldNotes()).toEqual([48, 55])
    click(button('Pause'))
    expect(heldNotes()).toEqual([])

    click(button('Play'))
    letTimePass(2100)
    expect(heldNotes()).toEqual([72])
  })
})

describe('someone with the keyboard alone', () => {
  it('keeps its place in the player line when the song options open, and reaches them with Tab', async () => {
    await playOnScreen('Tune.mid')
    const user = userEvent.setup()
    const line = screen.getByRole('region', { name: 'Song player' })
    const toggle = button('Song options')
    toggle.focus()
    fireEvent.click(toggle, { detail: 0 })
    const options = screen.getByRole('group', { name: 'Song options' })

    // On the button, which now says that they are open, or on what it opened: not lost.
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(line.contains(document.activeElement)).toBe(true)

    // Tab goes on to them without ever leaving the line, which would close them.
    for (let presses = 0; !options.contains(document.activeElement); presses += 1) {
      if (presses === 10) throw new Error('Tab never reached the song options.')
      await user.tab()
      expect(line.contains(document.activeElement)).toBe(true)
    }
    expect(screen.getByRole('group', { name: 'Song options' })).toBe(options)
  })

  it('reaches every control of the line and of the options with Tab, and none twice', async () => {
    await playOnScreen('Hands.mid', { notes: [60, 62], name: 'Right' }, { notes: [48, 50], name: 'Left' })
    const user = userEvent.setup()
    const toggle = button('Song options')
    toggle.focus()
    fireEvent.click(toggle, { detail: 0 })

    button('Pause').focus()
    const visited: string[] = []
    // The line has six controls and its options four: ten stops, the first of which has the focus.
    for (let count = 0; count < 10; count += 1) {
      if (count > 0) await user.tab()
      const focused = document.activeElement as HTMLElement
      visited.push(focused.getAttribute('aria-label') ?? focused.textContent?.replace('▾', '') ?? '')
    }
    expect([...visited].sort()).toEqual(
      [
        'Pause',
        'Restart',
        'Position in the song',
        'Speed',
        'Song options',
        'Close',
        'Right · Instrument · 2 notes',
        'Left · Instrument · 2 notes',
        'Melody only',
        'Fit to the piano',
      ].sort(),
    )
    // The options are still open: Tab never left the line on the way.
    expect(screen.getByRole('group', { name: 'Song options' })).toBeTruthy()
  })

  it('skips the one part that cannot be unchecked, and gets it back when another is checked', async () => {
    await playOnScreen('Hands.mid', { notes: [60, 62], name: 'Right' }, { notes: [48, 50], name: 'Left' })
    const user = userEvent.setup()
    const toggle = button('Song options')
    toggle.focus()
    fireEvent.click(toggle, { detail: 0 })
    const [right, left] = screen.getAllByRole<HTMLButtonElement>('checkbox')
    if (!right || !left) throw new Error('The song should have two parts.')

    left.focus()
    fireEvent.click(left, { detail: 0 })
    // The focus is on the part that was just unchecked, which can be checked again.
    expect(document.activeElement).toBe(left)
    expect(left.disabled).toBe(false)
    expect(right.disabled).toBe(true)
    expect(right.getAttribute('aria-checked')).toBe('true')
    // Going back with Tab passes over the part before it, which cannot be unchecked now.
    await user.tab({ shift: true })
    expect(document.activeElement).not.toBe(right)
    expect(document.activeElement).not.toBe(left)

    left.focus()
    fireEvent.click(left, { detail: 0 })
    expect(right.disabled).toBe(false)
    expect(songLibrary.getOptions(player.getState().songId ?? '').trackIds).toBe('auto')
    // With both parts checked again, the first one is a stop like any other.
    await user.tab({ shift: true })
    expect(document.activeElement).toBe(right)
  })

  it('is put on "Song options" when the options are closed under it, as Escape does', async () => {
    await playOnScreen('Tune.mid')
    const toggle = button('Song options')
    toggle.focus()
    fireEvent.click(toggle, { detail: 0 })
    const melodyOnly = screen.getByRole('switch', { name: 'Melody only' })
    melodyOnly.focus()

    // The app shell closes them at Escape, and is told that there was something to close.
    let closed = false
    act(() => {
      closed = closeSongOptions()
    })
    expect(closed).toBe(true)
    expect(screen.queryByRole('group', { name: 'Song options' })).toBeNull()
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(toggle)

    // Nothing is left to close, and the focus stays where it is.
    act(() => {
      closed = closeSongOptions()
    })
    expect(closed).toBe(false)
    expect(document.activeElement).toBe(toggle)
  })

  it('is left where it is when the options are closed while it is somewhere else', async () => {
    await playOnScreen('Tune.mid')
    fireEvent.click(button('Song options'), { detail: 1 })
    const stop = button('Restart')
    stop.focus()

    act(() => {
      closeSongOptions()
    })
    expect(screen.queryByRole('group', { name: 'Song options' })).toBeNull()
    expect(document.activeElement).toBe(stop)
  })
})

describe('what the line shows', () => {
  it('a long name in full when the mouse rests on it', async () => {
    const name = 'A very long name for a very small song that someone typed in one evening'
    await playOnScreen(`${name}.mid`)
    const title = within(screen.getByRole('region', { name: 'Song player' })).getByText(name)
    expect(title.title).toBe(name)
    expect(title.className).toBe('player-line__title')
  })

  it('how many notes are off the piano, as the piano on screen changes under the open options', async () => {
    await playOnScreen('High.mid', { notes: [60, 96, 98] })
    click(button('Song options'))
    expect(screen.queryByText(/too low or too high to show/)).toBeNull()

    showPiano(SMALL_PIANO)
    expect(
      screen.getByText('2 notes are too low or too high to show on the piano. They still play.'),
    ).toBeTruthy()

    showPiano(FULL_PIANO)
    expect(screen.queryByText(/too low or too high to show/)).toBeNull()
  })

  it('only the parts the song really has, when the saved choice names a part that is gone', async () => {
    const id = await playOnScreen('Hands.mid', { notes: [60, 62], name: 'Right' }, { notes: [48, 50] })
    act(() => songLibrary.setOptions(id, { trackIds: [2, 99] }))
    click(button('Song options'))

    const parts = screen.getAllByRole<HTMLButtonElement>('checkbox')
    expect(parts.map((part) => part.textContent)).toEqual([
      'Right · Instrument · 2 notes',
      'Part 2 · Instrument · 2 notes',
    ])
    expect(parts.map((part) => part.getAttribute('aria-checked'))).toEqual(['false', 'true'])
    // Checking the other part as well is "every part" again, and the part that is gone is forgotten.
    click(parts[0] as HTMLElement)
    expect(songLibrary.getOptions(id).trackIds).toBe('auto')
  })
})
