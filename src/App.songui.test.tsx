// @vitest-environment jsdom
/**
 * Songs in the whole app (src/App.tsx with the Songs panel, the player line,
 * the drop overlay and the song glue behind them): what a player can do to a
 * song while everything else on the screen is there too, in any order.
 *
 * The sound engine and the sky are replaced by stand-ins; each has tests of
 * its own. There is no layout here.
 */
import {
  act,
  cleanup,
  createEvent,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SkyProps } from './ui/sky/Sky'

const audio = vi.hoisted(() => {
  const listeners = new Set<() => void>()
  const state = { status: 'idle' }
  const engine = {
    start(): Promise<void> {
      state.status = 'ready'
      for (const listener of [...listeners]) listener()
      return Promise.resolve()
    },
    getStatus: () => state.status,
    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    noteOn(): void {},
    noteOff(): void {},
    setSustain(): void {},
    setVolume(): void {},
    setTranspose(): void {},
    setReverb(): void {},
    setRelease(): void {},
    allNotesOff(): void {},
    dispose(): void {},
  }
  return { engine, state }
})

/** What the stand-in sky was last given. */
const sky = vi.hoisted(() => ({ props: null as unknown }))

vi.mock('./audio/audioEngine', async (importOriginal) => {
  const original = await importOriginal<typeof import('./audio/audioEngine')>()
  return { ...original, createAudioEngine: () => audio.engine }
})

vi.mock('./ui/sky/Sky', async () => {
  const { createElement } = await import('react')
  return {
    Sky(props: unknown) {
      sky.props = props
      return createElement('canvas', { className: 'sky' })
    },
  }
})

import { App } from './App'
import { bus } from './app/pianoApp'
import { player, songLibrary } from './app/songsApp'
import type { PianoSizeSetting } from './core/layout'
import type { NoteEvent } from './core/types'
import { KEY_PRESETS } from './input/keymap'
import { arrange } from './songs/arrange'
import type { Song } from './songs/song'
import { STARTER_SONGS } from './songs/starterSongs'
import { settingsStore } from './state/settings'
import { addSong, midiBytes, resetSongs, songFile } from './ui/songsTestKit'
import { AUTO_HIDE_DELAY_MS } from './ui/useAutoHide'
import { LEAD_IN_SECONDS, playSong } from './ui/useSongs'

const START_TEXT = 'Click or press any key to start'
const TWINKLE = 'starter:twinkle-twinkle-little-star'
const MARY = 'starter:mary-had-a-little-lamb'

/**
 * How long after "Play" the first note of a song sounds, in milliseconds. The
 * songs of these tests all have their first note at their very start, so the
 * player gives them the whole lead-in: the note is seen falling first.
 */
const LEAD_IN_MS = LEAD_IN_SECONDS * 1000

function skyProps(): SkyProps {
  return sky.props as SkyProps
}

beforeEach(async () => {
  await resetSongs()
  bus.allOff()
  audio.state.status = 'idle'
  sky.props = null
})

afterEach(async () => {
  for (const stop of stopListening.splice(0)) stop()
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  setPageHidden(false)
  bus.allOff()
  await resetSongs()
})

/** A key of the computer keyboard goes down or up, on whatever has the keyboard focus. */
function key(type: 'keydown' | 'keyup', code: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent(type, { code, bubbles: true, cancelable: true, ...init })
  const target = document.activeElement ?? document.body
  act(() => {
    target.dispatchEvent(event)
  })
  return event
}

function tap(code: string, init: KeyboardEventInit = {}): void {
  key('keydown', code, init)
  key('keyup', code, init)
}

/** A click with the mouse: the control has the focus when the click arrives. */
function clickWithMouse(target: HTMLElement): void {
  target.focus()
  fireEvent.click(target, { detail: 1 })
}

/** Enter on a focused control: the browser sends a click that no mouse button made. */
function pressEnterOn(target: HTMLElement): void {
  target.focus()
  fireEvent.click(target, { detail: 0 })
}

/** Draws the app and gets past the start overlay. */
function startApp(): void {
  render(<App />)
  tap('Enter')
}

function menu(): HTMLElement {
  return document.querySelector('.menu') as HTMLElement
}

function menuIsHidden(): boolean {
  return menu().classList.contains('menu--hidden')
}

function button(name: string | RegExp): HTMLElement {
  return screen.getByRole('button', { name })
}

function panel(name: 'Settings' | 'Songs'): HTMLElement | null {
  return screen.queryByRole('dialog', { name })
}

function openPanel(name: 'Settings' | 'Songs'): HTMLElement {
  if (!panel(name)) clickWithMouse(button(name))
  return screen.getByRole('dialog', { name })
}

/** Presses "Play" for a song in the Songs panel, which is opened first if it is not. */
function playFromList(title: string | RegExp): void {
  const songs = openPanel('Songs')
  const name = typeof title === 'string' ? `Play ${title}` : title
  clickWithMouse(within(songs).getByRole('button', { name }))
}

function playerLine(): HTMLElement | null {
  return screen.queryByRole('region', { name: 'Song player' })
}

function songOptions(): HTMLElement | null {
  return screen.queryByRole('group', { name: 'Song options' })
}

function slider(name: string): HTMLInputElement {
  return screen.getByRole<HTMLInputElement>('slider', { name })
}

function messageLine(): HTMLElement {
  return document.querySelector('.songs__messages') as HTMLElement
}

function heldNotes(): number[] {
  return [...bus.getActiveNotes()].sort((a, b) => a - b)
}

/** The piano keys that are drawn lit. */
function litKeys(): number[] {
  const keys = screen.getByRole('group', { name: 'Piano' }).querySelectorAll('[aria-pressed="true"]')
  return [...keys].map((pianoKey) => Number((pianoKey as HTMLElement).dataset.midi))
}

function wait(milliseconds: number): void {
  act(() => {
    vi.advanceTimersByTime(milliseconds)
  })
}

/** Files let go over the page, as after a drag from a folder of the computer. */
async function dropFiles(...files: File[]): Promise<void> {
  const dataTransfer = { types: ['Files'], files, dropEffect: 'none' }
  await act(async () => {
    fireEvent(document.body, createEvent.drop(document.body, { dataTransfer }))
    await Promise.resolve()
  })
}

function setPageHidden(hidden: boolean): void {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => (hidden ? 'hidden' : 'visible'),
  })
}

/** What ends the listening of each `listenToBus`: called after the test that asked for it. */
const stopListening: (() => void)[] = []

/** Every note event on the bus from now on, until the end of the test. */
function listenToBus(): NoteEvent[] {
  const events: NoteEvent[] = []
  stopListening.push(bus.subscribe((event) => events.push(event)))
  return events
}

/** The song as the player has it: its notes later by what is missing of the lead-in. */
function withLeadIn(song: Song): Song {
  const starts = song.tracks
    .filter((track) => !track.isPercussion)
    .flatMap((track) => track.notes.map((note) => note.time))
  const leadIn = Math.max(0, LEAD_IN_SECONDS - Math.min(...starts))
  const tracks = song.tracks.map((track) => ({
    ...track,
    notes: track.notes.map((note) => ({ ...note, time: note.time + leadIn })),
  }))
  return { ...song, tracks }
}

describe('files dropped on the page', () => {
  it('before the first click start the app, and the sound waits for a key or a click', async () => {
    render(<App />)
    expect(screen.getByText(START_TEXT)).toBeTruthy()
    await dropFiles(songFile('Early.mid'))
    await screen.findByText('"Early" was added.')

    // The drop took the start overlay away: the Songs panel is there to say how it went.
    expect(screen.queryByText(START_TEXT)).toBeNull()
    expect(document.querySelector('.app__screen')?.hasAttribute('inert')).toBe(false)
    expect(panel('Songs')).not.toBeNull()
    expect(messageLine().textContent).toBe('"Early" was added.')
    expect(songLibrary.list().map((song) => song.title)).toEqual(['Early'])
    // A drop is not a click or a key press: the browser would not start the sound for it.
    expect(audio.state.status).toBe('idle')

    // The first key press asks for the sound, and plays its note like any other.
    key('keydown', 'KeyA')
    expect(audio.state.status).toBe('ready')
    expect(heldNotes()).toEqual([60])
    key('keyup', 'KeyA')
    expect(heldNotes()).toEqual([])
  })

  it('open Songs in place of Settings, and no piano key is left waiting for a computer key', async () => {
    startApp()
    const settings = openPanel('Settings')
    clickWithMouse(within(settings).getByRole('tab', { name: 'Keys' }))
    const piano = screen.getByRole('group', { name: 'Piano' })
    clickWithMouse(piano.querySelector('.piano-key[data-midi="60"]') as HTMLElement)
    expect(piano.classList.contains('piano--editing')).toBe(true)

    await dropFiles(songFile('Dropped.mid'))
    await screen.findByText('"Dropped" was added.')

    expect(panel('Settings')).toBeNull()
    expect(panel('Songs')).not.toBeNull()
    expect(piano.classList.contains('piano--editing')).toBe(false)
    // The computer keys are the same as before, and they play again.
    key('keydown', 'KeyA')
    expect(heldNotes()).toEqual([60])
    key('keyup', 'KeyA')
  })

  it('do not interrupt the song that is playing, and the menu stays for the panel', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'performance'] })
    startApp()
    act(() => {
      playSong(TWINKLE)
    })
    wait(AUTO_HIDE_DELAY_MS)
    expect(menuIsHidden()).toBe(true)
    const before = player.getPosition()

    await dropFiles(songFile('Dropped.mid'))
    expect(panel('Songs')).not.toBeNull()
    expect(menuIsHidden()).toBe(false)
    expect(player.getState().status).toBe('playing')
    expect(player.getState().songId).toBe(TWINKLE)

    wait(1000)
    expect(player.getPosition()).toBeGreaterThan(before + 0.9)
    wait(AUTO_HIDE_DELAY_MS * 2)
    expect(menuIsHidden()).toBe(false)
  })

  it('close the song options, which would otherwise hang over the Songs panel that opens', async () => {
    startApp()
    act(() => {
      playSong(TWINKLE)
    })
    clickWithMouse(button('Song options'))
    expect(songOptions()).not.toBeNull()

    await dropFiles(songFile('Dropped.mid'))
    await screen.findByText('"Dropped" was added.')

    expect(panel('Songs')).not.toBeNull()
    expect(songOptions()).toBeNull()
  })
})

describe('a file chosen with the "Import a MIDI file" button', () => {
  it('is added, played, renamed while it plays and deleted, from start to finish', async () => {
    startApp()
    const songs = openPanel('Songs')
    const field = songs.querySelector<HTMLInputElement>('input[type="file"]')
    if (!field) throw new Error('The panel has no file field.')
    expect(field.multiple).toBe(true)
    expect(field.hidden).toBe(true)

    const bytes = Uint8Array.from(midiBytes({ notes: [60, 62, 64, 65], name: 'Right hand' }))
    fireEvent.change(field, { target: { files: [new File([bytes], 'my_first_tune.mid')] } })
    expect(await screen.findByText('"my_first_tune" was added.')).toBeTruthy()

    clickWithMouse(within(songs).getByRole('button', { name: 'Play my_first_tune' }))
    expect(panel('Songs')).toBeNull()
    expect(player.getState()).toMatchObject({ status: 'playing', title: 'my_first_tune' })
    expect(skyProps().falling?.getNotes().map((note) => note.midi)).toEqual([60, 62, 64, 65])

    // A moment passes before the next click, as it always does for a person.
    await act(() => Promise.resolve())
    const again = openPanel('Songs')
    clickWithMouse(within(again).getByRole('button', { name: 'Rename my_first_tune' }))
    const name = within(again).getByRole('textbox', { name: 'Song name' })
    fireEvent.change(name, { target: { value: 'My first tune' } })
    fireEvent.keyDown(name, { key: 'Enter', code: 'Enter' })
    expect(within(playerLine() as HTMLElement).getByText('My first tune')).toBeTruthy()
    expect(player.getState().status).toBe('playing')

    clickWithMouse(within(again).getByRole('button', { name: 'Delete My first tune' }))
    clickWithMouse(within(again).getByRole('button', { name: 'Yes' }))
    expect(playerLine()).toBeNull()
    expect(heldNotes()).toEqual([])
    expect(songLibrary.list()).toEqual([])
    expect(within(again).getByText('No songs of your own yet. Import a MIDI file to add one.')).toBeTruthy()
  })

  it('types into the name of a song without playing the piano, and plays again once the name is saved', async () => {
    await addSong('Tune.mid')
    startApp()
    const songs = openPanel('Songs')
    clickWithMouse(within(songs).getByRole('button', { name: 'Rename Tune' }))
    const name = within(songs).getByRole('textbox', { name: 'Song name' })
    expect(document.activeElement).toBe(name)

    // "a" is a letter of the name here, not middle C; Space is a space, not sustain.
    const letter = key('keydown', 'KeyA', { key: 'a' })
    key('keyup', 'KeyA', { key: 'a' })
    const space = key('keydown', 'Space', { key: ' ' })
    key('keyup', 'Space', { key: ' ' })
    expect(letter.defaultPrevented).toBe(false)
    expect(space.defaultPrevented).toBe(false)
    expect(heldNotes()).toEqual([])
    expect(settingsStore.get().sustain).toBe(false)

    fireEvent.keyDown(name, { key: 'Enter', code: 'Enter' })
    expect(within(songs).queryByRole('textbox', { name: 'Song name' })).toBeNull()
    key('keydown', 'KeyA', { key: 'a' })
    expect(heldNotes()).toEqual([60])
    key('keyup', 'KeyA', { key: 'a' })
  })
})

describe('a song started from the list', () => {
  it('shows the player line, and the menu stays for as long as the song is not playing', () => {
    vi.useFakeTimers()
    startApp()
    playFromList(/^Play Twinkle/)

    expect(panel('Songs')).toBeNull()
    expect(playerLine()).not.toBeNull()
    expect(menu().contains(playerLine())).toBe(true)

    clickWithMouse(button('Pause'))
    wait(AUTO_HIDE_DELAY_MS * 4)
    expect(menuIsHidden()).toBe(false)

    clickWithMouse(button('Play'))
    wait(AUTO_HIDE_DELAY_MS)
    expect(menuIsHidden()).toBe(true)
    // The line of progress along the top edge is not part of the menu: it stays.
    expect(document.querySelector('.song-progress')).not.toBeNull()
  })

  it('starts again from the top when "Play" is pressed in the list for the song that is paused', () => {
    vi.useFakeTimers()
    startApp()
    playFromList(/^Play Twinkle/)
    wait(3000)
    clickWithMouse(button('Pause'))
    expect(player.getState().position).toBeGreaterThan(2.5)

    playFromList(/^Play Twinkle/)
    expect(player.getState().status).toBe('playing')
    expect(player.getPosition()).toBeLessThan(0.1)
    expect(screen.getAllByRole('region', { name: 'Song player' })).toHaveLength(1)
  })

  it('takes over from the song that was playing: none of its notes stays, and its options are closed', () => {
    vi.useFakeTimers()
    startApp()
    playFromList(/^Play Twinkle/)
    wait(LEAD_IN_MS + 200)
    expect(heldNotes()).toEqual([60])
    clickWithMouse(button('Song options'))
    expect(songOptions()).not.toBeNull()

    playFromList(/^Play Mary/)
    expect(player.getState().songId).toBe(MARY)
    expect(within(playerLine() as HTMLElement).getByText('Mary Had a Little Lamb')).toBeTruthy()
    expect(songOptions()).toBeNull()
    // The first song's C is let go at once. The second song's E is two seconds away.
    expect(heldNotes()).toEqual([])
    expect(litKeys()).toEqual([])
    wait(LEAD_IN_MS - 100)
    expect(heldNotes()).toEqual([])
    wait(150)
    expect(heldNotes()).toEqual([64])
    expect(litKeys()).toEqual([64])
  })

  it('writes the time played next to the slider and fills the line at the top as the song goes on', () => {
    vi.useFakeTimers()
    startApp()
    playFromList(/^Play Twinkle/)
    wait(10_000)

    const position = slider('Position in the song')
    expect(Number(position.value)).toBeGreaterThan(9.5)
    // Twinkle lasts 28 seconds and a bit: 30 and a bit with the two before its first note.
    expect(position.getAttribute('aria-valuetext')).toMatch(/^0:(09|10) of 0:30$/)
    const progress = document.querySelector<HTMLElement>('.song-progress')
    expect(Number(progress?.style.getPropertyValue('--song-progress'))).toBeGreaterThan(0.3)
  })
})

describe('the two seconds before the first note of a song', () => {
  it('show the note falling before it sounds: no key is lit and nothing is heard until then', () => {
    vi.useFakeTimers()
    startApp()
    playFromList(/^Play Twinkle/)

    // In the sky the first note is two seconds up, and every other note as much later.
    const falling = skyProps().falling?.getNotes() ?? []
    const written = STARTER_SONGS.find((song) => song.id === TWINKLE)?.tracks[0]?.notes ?? []
    expect(written.length).toBeGreaterThan(10)
    expect(falling.map((note) => note.midi)).toEqual(written.map((note) => note.midi))
    expect(falling.map((note) => note.time)).toEqual(
      written.map((note) => note.time + LEAD_IN_SECONDS),
    )

    wait(LEAD_IN_MS - 100)
    expect(player.getState().status).toBe('playing')
    expect(heldNotes()).toEqual([])
    expect(litKeys()).toEqual([])
    wait(200)
    expect(heldNotes()).toEqual([60])
    expect(litKeys()).toEqual([60])
  })

  it('are in the length the player line shows, and not in the length the list shows', () => {
    startApp()
    playFromList(/^Play Twinkle/)
    expect(slider('Position in the song').getAttribute('aria-valuetext')).toBe('0:00 of 0:30')

    const songs = openPanel('Songs')
    const row = within(songs).getByRole('button', { name: /^Play Twinkle/ }).closest('li')
    expect(row?.querySelector('.song-row__length')?.textContent).toBe('0:28')
  })

  it('come again after "Restart", and when the song is taken back to its start', () => {
    vi.useFakeTimers()
    startApp()
    playFromList(/^Play Twinkle/)
    wait(LEAD_IN_MS + 200)
    expect(heldNotes()).toEqual([60])

    clickWithMouse(button('Restart'))
    clickWithMouse(button('Play'))
    wait(LEAD_IN_MS - 100)
    expect(heldNotes()).toEqual([])
    wait(200)
    expect(heldNotes()).toEqual([60])

    fireEvent.change(slider('Position in the song'), { target: { value: '0' } })
    expect(heldNotes()).toEqual([])
    wait(LEAD_IN_MS - 100)
    expect(heldNotes()).toEqual([])
    wait(200)
    expect(heldNotes()).toEqual([60])
  })
})

describe('the computer keyboard while a song plays', () => {
  it('still plays the piano, and a note that the song and the player share ends when both let go', () => {
    vi.useFakeTimers()
    startApp()
    playFromList(/^Play Twinkle/)
    const events = listenToBus()
    wait(LEAD_IN_MS + 100)
    // The song holds its first C. The player presses the same key, then another one.
    expect(heldNotes()).toEqual([60])
    key('keydown', 'KeyA')
    key('keydown', 'KeyD')
    expect(heldNotes()).toEqual([60, 64])
    expect(events.filter((event) => event.type === 'on').map((event) => event.source)).toEqual([
      'playback',
      'keyboard',
      'keyboard',
    ])

    // The song lets go of its C after 0.54 s: the player still holds it.
    wait(480)
    expect(heldNotes()).toEqual([60, 64])
    key('keyup', 'KeyA')
    expect(heldNotes()).toEqual([64])
    key('keyup', 'KeyD')
    expect(heldNotes()).toEqual([])
    expect(player.getState().status).toBe('playing')
  })

  it('keeps Space for sustain: it never pauses the song, not even with "Pause" focused', () => {
    startApp()
    act(() => {
      playSong(TWINKLE)
    })
    expect(settingsStore.get().sustain).toBe(false)

    tap('Space', { key: ' ' })
    expect(settingsStore.get().sustain).toBe(true)
    expect(player.getState().status).toBe('playing')

    button('Pause').focus()
    const down = key('keydown', 'Space', { key: ' ' })
    const up = key('keyup', 'Space', { key: ' ' })
    expect(down.defaultPrevented).toBe(true)
    expect(up.defaultPrevented).toBe(true)
    expect(settingsStore.get().sustain).toBe(false)
    expect(player.getState().status).toBe('playing')
  })

  it('says on the stage that sustain is on, for the player who pressed Space to pause', () => {
    vi.useFakeTimers()
    startApp()
    act(() => {
      playSong(TWINKLE)
    })
    wait(AUTO_HIDE_DELAY_MS)
    expect(menuIsHidden()).toBe(true)
    expect(screen.queryByText('Sustain on')).toBeNull()

    // The switch that shows sustain is in the menu, which is hidden and stays hidden.
    tap('Space', { key: ' ' })
    const badge = screen.getByText('Sustain on')
    expect(badge.className).toBe('stage__badge')
    expect(menu().contains(badge)).toBe(false)
    expect(screen.getByRole('tabpanel').contains(badge)).toBe(true)
    expect(menuIsHidden()).toBe(true)
    expect(player.getState().status).toBe('playing')

    tap('Space', { key: ' ' })
    expect(screen.queryByText('Sustain on')).toBeNull()
  })

  it('leaves Enter to the focused button: that is how "Pause" is pressed without a mouse', () => {
    startApp()
    act(() => {
      playSong(TWINKLE)
    })
    const pause = button('Pause')
    pause.focus()
    const enter = key('keydown', 'Enter', { key: 'Enter' })
    expect(enter.defaultPrevented).toBe(false)
    pressEnterOn(pause)
    expect(player.getState().status).toBe('paused')
    // The same button is now "Play", and it kept the focus.
    expect(document.activeElement).toBe(button('Play'))
  })

  it('plays notes, and moves no slider, when a letter is pressed with a slider of the player line focused', () => {
    startApp()
    act(() => {
      playSong(TWINKLE)
    })
    act(() => player.pause())
    const speed = slider('Speed')
    speed.focus()
    const letter = key('keydown', 'KeyA', { key: 'a' })
    expect(heldNotes()).toEqual([60])
    expect(letter.defaultPrevented).toBe(true)
    key('keyup', 'KeyA', { key: 'a' })
    expect(speed.value).toBe('100')
    // The arrow keys are the slider's own.
    expect(key('keydown', 'ArrowRight', { key: 'ArrowRight' }).defaultPrevented).toBe(false)
  })

  it('does not close or stop the song at Escape', () => {
    startApp()
    act(() => {
      playSong(TWINKLE)
    })
    tap('Escape', { key: 'Escape' })
    expect(player.getState().status).toBe('playing')
    expect(playerLine()).not.toBeNull()
  })
})

/*
 * Escape takes back one thing at a time, in this order: the piano key that is
 * waiting for a computer key, the open song options, the open panel, the
 * keyboard focus in the menu. With none of them it is the browser's key.
 */
describe('Escape, with a song in the player', () => {
  function escape(init: KeyboardEventInit = {}): KeyboardEvent {
    const down = key('keydown', 'Escape', { key: 'Escape', ...init })
    if (!init.repeat) key('keyup', 'Escape', { key: 'Escape' })
    return down
  }

  it('closes the song options, however they were opened, and leaves the song alone', () => {
    startApp()
    act(() => {
      playSong(TWINKLE)
    })
    // Opened with the mouse: the keyboard focus is nowhere.
    clickWithMouse(button('Song options'))
    expect(songOptions()).not.toBeNull()
    expect(escape().defaultPrevented).toBe(true)
    expect(songOptions()).toBeNull()
    expect(button('Song options').getAttribute('aria-expanded')).toBe('false')

    // Opened with Enter, and the focus moved into them.
    pressEnterOn(button('Song options'))
    const melodyOnly = screen.getByRole('switch', { name: 'Melody only' })
    melodyOnly.focus()
    expect(escape().defaultPrevented).toBe(true)
    expect(songOptions()).toBeNull()
    // The focus is not lost with the switch it was on: it is on the button that opens them.
    expect(document.activeElement).toBe(button('Song options'))

    expect(player.getState().status).toBe('playing')
    expect(playerLine()).not.toBeNull()
  })

  it('closes the song options first and the panel at the next press', () => {
    startApp()
    act(() => {
      playSong(TWINKLE)
    })
    openPanel('Songs')
    clickWithMouse(button('Song options'))
    expect(songOptions()).not.toBeNull()

    escape()
    expect(songOptions()).toBeNull()
    expect(panel('Songs')).not.toBeNull()

    escape()
    expect(panel('Songs')).toBeNull()
    expect(player.getState().status).toBe('playing')
  })

  it('does one thing only while it is held down', () => {
    startApp()
    act(() => {
      playSong(TWINKLE)
    })
    openPanel('Settings')
    clickWithMouse(button('Song options'))

    // The key goes down, and stays down: the keyboard sends the press again and again.
    key('keydown', 'Escape', { key: 'Escape' })
    for (let count = 0; count < 5; count += 1) {
      expect(escape({ repeat: true }).defaultPrevented).toBe(true)
    }
    key('keyup', 'Escape', { key: 'Escape' })
    expect(songOptions()).toBeNull()
    expect(panel('Settings')).not.toBeNull()

    // The next press is a new one.
    escape()
    expect(panel('Settings')).toBeNull()
  })

  it('takes the piano key that is waiting for a computer key before anything else', () => {
    startApp()
    act(() => {
      playSong(TWINKLE)
    })
    const settings = openPanel('Settings')
    clickWithMouse(within(settings).getByRole('tab', { name: 'Keys' }))
    clickWithMouse(button('Song options'))
    const piano = screen.getByRole('group', { name: 'Piano' })
    clickWithMouse(piano.querySelector('.piano-key[data-midi="60"]') as HTMLElement)
    /** A piano key is marked as the one whose computer key is being chosen. */
    const waiting = (): boolean => piano.querySelector('.piano-key.is-selected') !== null
    expect(waiting()).toBe(true)
    expect(songOptions()).not.toBeNull()

    escape()
    expect(waiting()).toBe(false)
    expect(songOptions()).not.toBeNull()
    expect(panel('Settings')).not.toBeNull()

    escape()
    expect(songOptions()).toBeNull()
    expect(panel('Settings')).not.toBeNull()

    escape()
    expect(panel('Settings')).toBeNull()
    expect(playerLine()).not.toBeNull()
  })

  it('lets go of the menu when the focus is in it, and is the browser\'s key after that', () => {
    vi.useFakeTimers()
    startApp()
    act(() => {
      playSong(TWINKLE)
    })
    const stop = button('Restart')
    stop.focus()
    wait(AUTO_HIDE_DELAY_MS * 2)
    // The menu stays for as long as the keyboard is in it.
    expect(menuIsHidden()).toBe(false)

    expect(escape().defaultPrevented).toBe(true)
    expect(menu().contains(document.activeElement)).toBe(false)
    expect(player.getState().status).toBe('playing')
    wait(AUTO_HIDE_DELAY_MS)
    expect(menuIsHidden()).toBe(true)

    // Nothing is left to take back: the key is not used up, and the song plays on.
    expect(escape().defaultPrevented).toBe(false)
    expect(player.getState().status).toBe('playing')
    expect(playerLine()).not.toBeNull()
  })
})

describe('where the computer keys sit, and a song', () => {
  it('are left alone by Play in the player line, by the options and by the end of the song', async () => {
    await addSong('Low.mid', { notes: [36, 38, 40, 41] }, { notes: [43, 45] })
    vi.useFakeTimers()
    startApp()
    playFromList('Low')
    expect(settingsStore.get().baseOctave).toBe(1)

    // The player moves the keys back up while the song is loaded.
    act(() => settingsStore.set({ baseOctave: 2 }))
    clickWithMouse(button('Restart'))
    clickWithMouse(button('Play'))
    expect(settingsStore.get().baseOctave).toBe(2)

    clickWithMouse(button('Song options'))
    clickWithMouse(screen.getByRole('switch', { name: 'Melody only' }))
    clickWithMouse(screen.getAllByRole('checkbox')[1] as HTMLElement)
    expect(settingsStore.get().baseOctave).toBe(2)

    wait(60_000)
    expect(player.getState().status).toBe('stopped')
    expect(settingsStore.get().baseOctave).toBe(2)

    // Nor by "Close": the player moved them after the song did, and that is where they stay.
    clickWithMouse(button('Close'))
    expect(settingsStore.get().baseOctave).toBe(2)
  })

  it('go back to where the player had them when the song is closed', async () => {
    await addSong('Low.mid', { notes: [36, 38, 40, 41] })
    startApp()
    playFromList('Low')
    // The keys went down two octaves for the song: the A key plays its first note, a low C.
    expect(settingsStore.get().baseOctave).toBe(1)
    expect(skyProps().hints.get(36)).toBe('A')

    clickWithMouse(button('Close'))
    expect(settingsStore.get().baseOctave).toBe(3)
    // In free play the A key is middle C again, as before the song.
    key('keydown', 'KeyA')
    expect(heldNotes()).toEqual([60])
    expect(litKeys()).toEqual([60])
    key('keyup', 'KeyA')
  })

  it('go back to where the player had them when the song that is loaded is deleted', async () => {
    await addSong('Low.mid', { notes: [36, 38, 40, 41] })
    act(() => settingsStore.set({ baseOctave: 2 }))
    startApp()
    playFromList('Low')
    expect(settingsStore.get().baseOctave).toBe(1)

    const songs = openPanel('Songs')
    clickWithMouse(within(songs).getByRole('button', { name: 'Delete Low' }))
    clickWithMouse(within(songs).getByRole('button', { name: 'Yes' }))
    expect(playerLine()).toBeNull()
    expect(settingsStore.get().baseOctave).toBe(2)
  })

  it('go back only once the last of several songs is closed, to where they were before the first', async () => {
    await addSong('Low.mid', { notes: [36, 38, 40, 41] })
    await addSong('High.mid', { notes: [84, 86, 88, 89] })
    startApp()
    playFromList('Low')
    expect(settingsStore.get().baseOctave).toBe(1)
    playFromList('High')
    expect(settingsStore.get().baseOctave).toBe(4)

    clickWithMouse(button('Close'))
    expect(settingsStore.get().baseOctave).toBe(3)
  })

  it('write the letter of a computer key only on the falling notes that a key can play', async () => {
    // One note far below the keys, two on them, one far above.
    await addSong('Wide.mid', { notes: [30, 60, 62, 100] })
    act(() => settingsStore.set({ pianoSize: 88 }))
    startApp()
    playFromList('Wide')

    const { hints, falling, range } = skyProps()
    expect(range).toEqual({ first: 21, last: 108 })
    expect(falling?.getNotes().map((note) => note.midi)).toEqual([30, 60, 62, 100])
    expect(settingsStore.get().baseOctave).toBe(3)
    expect(hints.get(60)).toBe('A')
    expect(hints.get(62)).toBe('S')
    expect(hints.has(30)).toBe(false)
    expect(hints.has(100)).toBe(false)
  })

  it.each(STARTER_SONGS.map((song) => [song.title, song.id] as const))(
    'stay where they are for "%s", and every one of its notes has the letter of a key',
    (title, id) => {
      startApp()
      playFromList(`${title}`)

      expect(player.getState().songId).toBe(id)
      expect(settingsStore.get().baseOctave).toBe(3)
      const notes = skyProps().falling?.getNotes() ?? []
      expect(notes.length).toBeGreaterThan(10)
      expect(notes.filter((note) => !skyProps().hints.has(note.midi))).toEqual([])
      // And none of them is off the small piano this page draws.
      clickWithMouse(button('Song options'))
      expect(screen.queryByText(/too low or too high to show/)).toBeNull()
    },
  )

  it('give the letters of the keys that play the notes after "Fit to the piano" moved them', async () => {
    await addSong('High.mid', { notes: [96, 98] })
    act(() => settingsStore.set({ pianoSize: 37, bindings: twoOctaves() }))
    startApp()
    playFromList('High')
    // The keys went as high as they go, and the small piano with them: C5 to C8.
    expect(settingsStore.get().baseOctave).toBe(5)
    expect(skyProps().range).toEqual({ first: 72, last: 108 })

    act(() => settingsStore.set({ baseOctave: 3 }))
    expect(skyProps().range).toEqual({ first: 48, last: 84 })
    clickWithMouse(button('Song options'))
    expect(screen.getByText(/^2 notes are too low or too high to show/)).toBeTruthy()

    clickWithMouse(screen.getByRole('switch', { name: 'Fit to the piano' }))
    const midis = skyProps().falling?.getNotes().map((note) => note.midi)
    expect(midis).toEqual([84, 74])
    expect(screen.queryByText(/too low or too high to show/)).toBeNull()
    // "Two octaves" has a key for that D (the "O" key) and none for the top C of the keys.
    expect(skyProps().hints.get(74)).toBe('O')
    expect(skyProps().hints.has(84)).toBe(false)
  })
})

function twoOctaves() {
  const preset = KEY_PRESETS.find((candidate) => candidate.id === 'two-octaves')
  if (!preset) throw new Error('There is no "Two octaves" preset.')
  return preset.bindings
}

describe('nothing is left playing or lit', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  /** A song is playing and holds its first note, which is lit on the piano. */
  function playUntilANoteSounds(title: string | RegExp): void {
    playFromList(title)
    wait(LEAD_IN_MS + 200)
    expect(heldNotes()).not.toEqual([])
    expect(litKeys()).toEqual(heldNotes())
  }

  function expectSilenceFromNowOn(): void {
    const events = listenToBus()
    wait(10_000)
    expect(events).toEqual([])
    expect(heldNotes()).toEqual([])
    expect(litKeys()).toEqual([])
  }

  it('after "Close"', () => {
    startApp()
    playUntilANoteSounds(/^Play Twinkle/)
    clickWithMouse(button('Close'))

    expect(playerLine()).toBeNull()
    expect(skyProps().falling).toBeNull()
    expect(document.querySelector('.song-progress')).toBeNull()
    expect(player.getState().status).toBe('empty')
    expectSilenceFromNowOn()
  })

  it('after the song that is playing is deleted from the list', async () => {
    vi.useRealTimers()
    await addSong('Mine.mid', { notes: [60, 62, 64, 65] })
    vi.useFakeTimers()
    startApp()
    playUntilANoteSounds('Mine')

    const songs = openPanel('Songs')
    clickWithMouse(within(songs).getByRole('button', { name: 'Delete Mine' }))
    // Asked, and not yet answered: the song plays on.
    expect(player.getState().status).toBe('playing')
    clickWithMouse(within(songs).getByRole('button', { name: 'No' }))
    expect(player.getState().status).toBe('playing')
    expect(playerLine()).not.toBeNull()

    clickWithMouse(within(songs).getByRole('button', { name: 'Delete Mine' }))
    clickWithMouse(within(songs).getByRole('button', { name: 'Yes' }))
    expect(songLibrary.list()).toEqual([])
    expect(playerLine()).toBeNull()
    expect(skyProps().falling).toBeNull()
    expect(panel('Songs')).not.toBeNull()
    expectSilenceFromNowOn()
  })

  it('after the song has played to its end, and it can be played again', () => {
    startApp()
    playFromList(/^Play Mary/)
    wait(60_000)

    expect(player.getState().status).toBe('stopped')
    expect(player.getState().position).toBe(0)
    expect(heldNotes()).toEqual([])
    expect(litKeys()).toEqual([])
    expect(button('Play')).toBeTruthy()
    expect(menuIsHidden()).toBe(false)

    clickWithMouse(button('Play'))
    wait(LEAD_IN_MS + 100)
    expect(heldNotes()).toEqual([64])
  })

  it('after "Restart", after "Pause", and after the position was dragged in the middle of a note', () => {
    startApp()
    playUntilANoteSounds(/^Play Twinkle/)
    clickWithMouse(button('Pause'))
    expect(heldNotes()).toEqual([])
    expect(litKeys()).toEqual([])

    clickWithMouse(button('Play'))
    wait(700)
    expect(heldNotes()).not.toEqual([])
    fireEvent.change(slider('Position in the song'), { target: { value: '10.1' } })
    expect(heldNotes()).toEqual([])
    expect(player.getState().status).toBe('playing')

    wait(700)
    expect(heldNotes()).not.toEqual([])
    clickWithMouse(button('Restart'))
    expect(player.getState().position).toBe(0)
    expectSilenceFromNowOn()
  })

  it('from the song when the page is hidden, and the song waits there, paused', () => {
    startApp()
    playUntilANoteSounds(/^Play Twinkle/)
    wait(AUTO_HIDE_DELAY_MS)
    expect(menuIsHidden()).toBe(true)

    setPageHidden(true)
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(heldNotes()).toEqual([])
    expect(player.getState().status).toBe('paused')

    setPageHidden(false)
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(player.getState().status).toBe('paused')
    // The menu is back, with "Play" in it, for when the player returns.
    expect(menuIsHidden()).toBe(false)
    expect(button('Play')).toBeTruthy()
  })

  it('from the song when the page is being left, and the song waits there, paused', () => {
    startApp()
    playUntilANoteSounds(/^Play Twinkle/)
    const before = player.getPosition()

    act(() => {
      window.dispatchEvent(new Event('pagehide'))
    })
    expect(heldNotes()).toEqual([])
    expect(litKeys()).toEqual([])
    expect(player.getState().status).toBe('paused')
    expect(player.getState().position).toBeCloseTo(before, 2)
    expectSilenceFromNowOn()
  })

  it('but a key the player is holding stays down through "Close"', () => {
    startApp()
    playFromList(/^Play Twinkle/)
    wait(LEAD_IN_MS + 100)
    key('keydown', 'KeyD')
    expect(heldNotes()).toEqual([60, 64])

    clickWithMouse(button('Close'))
    expect(heldNotes()).toEqual([64])
    expect(litKeys()).toEqual([64])
    key('keyup', 'KeyD')
    expect(heldNotes()).toEqual([])
  })
})

describe('someone with the keyboard alone', () => {
  it('goes from "Songs" through the list to a playing song, and on to its player line', () => {
    startApp()
    pressEnterOn(button('Songs'))
    const songs = screen.getByRole('dialog', { name: 'Songs' })
    // The focus is on the first thing to do in the panel.
    expect(document.activeElement).toBe(within(songs).getByRole('button', { name: 'Import a MIDI file' }))

    pressEnterOn(within(songs).getByRole('button', { name: /^Play Twinkle/ }))
    expect(panel('Songs')).toBeNull()
    // Back on the button that opened the panel, in the menu, which therefore stays.
    expect(document.activeElement).toBe(button('Songs'))
    expect(menuIsHidden()).toBe(false)

    // Every control of the player line can be reached with Tab, in the order they are drawn.
    const stops = [...(playerLine() as HTMLElement).querySelectorAll<HTMLElement>('button, input')]
    expect(stops.every((stop) => stop.tabIndex >= 0 && !stop.matches(':disabled'))).toBe(true)
    expect(stops.map((stop) => stop.getAttribute('aria-label') ?? stop.textContent?.replace('▾', ''))).toEqual([
      'Pause',
      'Restart',
      'Position in the song',
      'Speed',
      'Song options',
      'Close',
    ])
  })

  it('does not lose the focus when it opens the song options, which belong to the player line', () => {
    startApp()
    act(() => {
      playSong(TWINKLE)
    })
    const toggle = button('Song options')
    pressEnterOn(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    const options = songOptions() as HTMLElement
    expect(toggle.getAttribute('aria-controls')).toBe(options.id)
    expect(playerLine()?.contains(options)).toBe(true)
    // On the button, or on what it opened: never nowhere.
    expect(playerLine()?.contains(document.activeElement)).toBe(true)

    pressEnterOn(within(options).getByRole('switch', { name: 'Melody only' }))
    expect(songLibrary.getOptions(TWINKLE).melodyOnly).toBe(true)
    expect(document.activeElement).toBe(within(options).getByRole('switch', { name: 'Melody only' }))
  })

  it('is not left without the focus when the song is deleted while it is among the song options', async () => {
    const song = await addSong('Mine.mid', { notes: [60, 62] }, { notes: [64, 65] })
    startApp()
    act(() => {
      playSong(song.id)
    })
    pressEnterOn(button('Song options'))
    const part = screen.getAllByRole('checkbox')[0] as HTMLElement
    pressEnterOn(part)
    expect(document.activeElement).toBe(part)

    pressEnterOn(button('Songs'))
    const songs = screen.getByRole('dialog', { name: 'Songs' })
    pressEnterOn(within(songs).getByRole('button', { name: 'Delete Mine' }))
    expect(document.activeElement).toBe(within(songs).getByRole('button', { name: 'No' }))
    pressEnterOn(within(songs).getByRole('button', { name: 'Yes' }))

    expect(playerLine()).toBeNull()
    expect(document.activeElement).toBe(within(songs).getByRole('button', { name: 'Import a MIDI file' }))
  })
})

describe('what is said out loud', () => {
  it('the result of adding songs is in an element screen readers follow, empty until there is news', async () => {
    startApp()
    openPanel('Songs')
    const line = messageLine()
    expect(line.getAttribute('role')).toBe('status')
    expect(line.textContent).toBe('')

    await dropFiles(songFile('One.mid'), songFile('Two.mid'), new File(['hello'], 'notes.txt'))
    await screen.findByText('2 songs were added.')
    // The same element, filled in: that is what makes a screen reader speak.
    expect(messageLine()).toBe(line)
    expect([...line.children].map((child) => child.textContent)).toEqual([
      '2 songs were added.',
      'notes.txt: That file is not a MIDI file. MIDI files usually end in .mid or .midi.',
    ])
  })

  it('the player line and its controls have names, and the progress line is for the eye only', () => {
    startApp()
    act(() => {
      playSong(TWINKLE)
    })
    const line = playerLine() as HTMLElement
    for (const control of line.querySelectorAll<HTMLElement>('button, input')) {
      const name = control.getAttribute('aria-label') ?? control.textContent ?? ''
      expect(name.trim()).not.toBe('')
    }
    expect(slider('Speed').getAttribute('aria-valuetext')).toBe('100%')
    expect(document.querySelector('.song-progress')?.getAttribute('aria-hidden')).toBe('true')
  })
})

describe('a long session with songs, in any order', () => {
  /** A small generator of numbers that gives the same run for the same seed. */
  function randomFrom(seed: number): () => number {
    let state = seed >>> 0
    return () => {
      state = (state + 0x6d2b79f5) >>> 0
      let mixed = Math.imul(state ^ (state >>> 15), 1 | state)
      mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed
      return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296
    }
  }

  const HOME_ROW = ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK']
  const SIZES: PianoSizeSetting[] = [88, 61, 49, 37, 'auto']

  function findSong(id: string): Song | null {
    return STARTER_SONGS.find((song) => song.id === id) ?? songLibrary.get(id)
  }

  it.each([1, 2, 3, 4, 5, 6, 7, 8])(
    'keeps the screen, the player and the notes in step (run %i)',
    async (seed) => {
      await addSong('Two hands.mid', { notes: [60, 64, 67, 72], name: 'Right' }, { notes: [36, 43, 48, 43] })
      await addSong('Low.mid', { notes: [28, 31, 35, 40] })
      await addSong('Wide.mid', { notes: [24, 60, 96, 105, 62] }, { notes: [35, 38], drums: true })
      const complaints = vi.spyOn(console, 'error').mockImplementation(() => {})
      const warnings = vi.spyOn(console, 'warn').mockImplementation(() => {})
      vi.useFakeTimers()
      const random = randomFrom(seed)
      const pick = <Item,>(items: readonly Item[]): Item =>
        items[Math.floor(random() * items.length)] as Item
      /** The computer keys the test is holding down. */
      const down = new Set<string>()
      let renames = 0
      startApp()

      const steps: Record<string, () => void> = {
        wait: () => wait(Math.floor(random() * 1500)),
        pressKey() {
          const code = pick(HOME_ROW)
          if (down.has(code)) return
          down.add(code)
          key('keydown', code)
        },
        releaseKey() {
          if (down.size === 0) return
          const code = pick([...down])
          down.delete(code)
          key('keyup', code)
        },
        playFromList() {
          const songs = openPanel('Songs')
          clickWithMouse(pick(within(songs).getAllByRole('button', { name: /^Play / })))
        },
        playOrPause() {
          const toggle = screen.queryByRole('button', { name: /^(Play|Pause)$/ })
          if (toggle) clickWithMouse(toggle)
        },
        stop() {
          const stop = screen.queryByRole('button', { name: 'Restart' })
          if (stop) clickWithMouse(stop)
        },
        close() {
          const close = screen.queryByRole('button', { name: 'Close' })
          if (close) clickWithMouse(close)
        },
        seek() {
          if (!playerLine()) return
          const position = slider('Position in the song')
          const value = random() < 0.2 ? Number(position.max) : random() * Number(position.max)
          fireEvent.change(position, { target: { value: String(value) } })
        },
        speed() {
          if (!playerLine()) return
          const value = 50 + 5 * Math.floor(random() * 21)
          fireEvent.change(slider('Speed'), { target: { value: String(value) } })
        },
        option() {
          if (!playerLine()) return
          if (!songOptions()) clickWithMouse(button('Song options'))
          const options = songOptions() as HTMLElement
          const choices = [...options.querySelectorAll<HTMLButtonElement>('button')].filter(
            (choice) => !choice.disabled,
          )
          clickWithMouse(pick(choices))
        },
        pianoSize: () => act(() => settingsStore.set({ pianoSize: pick(SIZES) })),
        moveKeys() {
          const baseOctave = settingsStore.get().baseOctave + (random() < 0.5 ? -1 : 1)
          act(() => settingsStore.set({ baseOctave: Math.min(5, Math.max(1, baseOctave)) }))
        },
        deleteSong() {
          const songs = songLibrary.list()
          // Not too often, or the list is soon empty.
          if (songs.length === 0 || random() < 0.6) return
          const title = pick(songs).title
          const panelOfSongs = openPanel('Songs')
          clickWithMouse(within(panelOfSongs).getByRole('button', { name: `Delete ${title}` }))
          clickWithMouse(within(panelOfSongs).getByRole('button', { name: 'Yes' }))
        },
        rename() {
          const songs = songLibrary.list()
          if (songs.length === 0) return
          renames += 1
          act(() => songLibrary.rename(pick(songs).id, `Tune number ${renames}`))
        },
        hidePage() {
          setPageHidden(true)
          act(() => {
            document.dispatchEvent(new Event('visibilitychange'))
          })
          // The browser sends no key up to a page that is not in front.
          down.clear()
          setPageHidden(false)
          act(() => {
            document.dispatchEvent(new Event('visibilitychange'))
          })
        },
        settingsPanel() {
          if (panel('Settings')) {
            tap('Escape', { key: 'Escape' })
            return
          }
          const settings = openPanel('Settings')
          clickWithMouse(within(settings).getByRole('tab', { name: 'Sound' }))
        },
        closePanel() {
          if (panel('Songs') || panel('Settings')) tap('Escape', { key: 'Escape' })
        },
      }
      const names = Object.keys(steps)

      for (let count = 0; count < 150; count += 1) {
        const name = pick(names)
        steps[name]?.()
        const where = `run ${seed}, step ${count} (${name})`

        const state = player.getState()
        const loaded = state.status !== 'empty'
        expect(playerLine() !== null, where).toBe(loaded)
        expect(skyProps().falling !== null, where).toBe(loaded)
        expect(document.querySelector('.song-progress') !== null, where).toBe(loaded)
        expect(complaints.mock.calls, where).toEqual([])
        expect(warnings.mock.calls, where).toEqual([])

        if (loaded) {
          const song = findSong(state.songId ?? '')
          expect(song, where).not.toBeNull()
          if (song === null) continue
          const options = songLibrary.getOptions(song.id)
          const expected = arrange(withLeadIn(song), options, skyProps().range)
          // The notes in the sky are the song's, with its options, for the piano that is
          // drawn, after the two seconds the player gets before the first of them.
          expect(skyProps().falling?.getNotes(), where).toEqual(expected.notes)
          expect(state.duration, where).toBeCloseTo(expected.duration, 9)
          expect(state.speed, where).toBe(options.speed)
          expect(state.title, where).toBe(song.title)
          expect(state.position, where).toBeGreaterThanOrEqual(0)
          expect(state.position, where).toBeLessThanOrEqual(state.duration)
          expect(skyProps().falling?.isPlaying(), where).toBe(state.status === 'playing')
          expect(screen.queryByRole('button', { name: 'Pause' }) !== null, where).toBe(
            state.status === 'playing',
          )
        }
        // With no key held and no song playing, the piano is silent and dark.
        if (down.size === 0 && state.status !== 'playing') {
          expect(heldNotes(), where).toEqual([])
          expect(litKeys(), where).toEqual([])
        }
        // What is lit is what is held, always.
        expect(litKeys().sort((a, b) => a - b), where).toEqual(
          heldNotes().filter((midi) => midi >= skyProps().range.first && midi <= skyProps().range.last),
        )
      }

      for (const code of [...down]) key('keyup', code)
      const close = screen.queryByRole('button', { name: 'Close' })
      if (close) clickWithMouse(close)
      const events = listenToBus()
      wait(20_000)
      expect(events).toEqual([])
      expect(heldNotes()).toEqual([])
      expect(player.getState().status).toBe('empty')
    },
  )
})
