// @vitest-environment jsdom
/**
 * The song glue (src/ui/useSongs.ts) in the corners: files added while other
 * files are still being read, options that leave less of a song than has
 * already been played, a piano that changes while the song waits, and what
 * is said when things go wrong.
 */
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { bus } from '../app/pianoApp'
import { player, songLibrary } from '../app/songsApp'
import { settingsStore } from '../state/settings'
import {
  FULL_PIANO,
  SMALL_PIANO,
  addSong,
  midiBytes,
  resetSongs,
  showPiano,
  songFile,
  unreadableFile,
} from './songsTestKit'
import {
  changeSongOptions,
  closeSong,
  importSongFiles,
  playSong,
  useLoadedSong,
  useSongMessages,
} from './useSongs'
import type { LoadedSong } from './useSongs'

const NOT_MIDI = 'That file is not a MIDI file. MIDI files usually end in .mid or .midi.'
const TWINKLE = 'starter:twinkle-twinkle-little-star'

/** A Songs panel that is open for the whole test: its message line, as text. */
function watchMessages(): () => string[] {
  const { result } = renderHook(() => useSongMessages())
  return () => result.current.map((message) => (message.isProblem ? `! ${message.text}` : message.text))
}

/** A file whose bytes arrive only when the test says so, like a big file on a slow disk. */
function slowFile(name: string, bytes: Uint8Array): { file: File; arrive(): void } {
  let arrive: () => void = () => {}
  const arrayBuffer = (): Promise<ArrayBuffer> =>
    new Promise((resolve) => {
      arrive = () => resolve(Uint8Array.from(bytes).buffer)
    })
  return { file: { name, size: bytes.byteLength, arrayBuffer } as unknown as File, arrive: () => arrive() }
}

function loadedSong(): LoadedSong {
  const { result, unmount } = renderHook(() => useLoadedSong())
  const loaded = result.current
  unmount()
  if (loaded === null) throw new Error('No song is loaded.')
  return loaded
}

function play(id: string): void {
  act(() => {
    playSong(id)
  })
}

function titles(): string[] {
  return songLibrary.list().map((song) => song.title)
}

function useFakeClock(): void {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'performance'] })
}

function letTimePass(milliseconds: number): void {
  act(() => {
    vi.advanceTimersByTime(milliseconds)
  })
}

function heldNotes(): number[] {
  return [...bus.getActiveNotes()].sort((a, b) => a - b)
}

beforeEach(resetSongs)

afterEach(async () => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  await resetSongs()
  bus.allOff()
})

describe('files added while other files are still being read', () => {
  it('all end up in the list', async () => {
    const slow = slowFile('Slow.mid', midiBytes({ notes: [60, 62] }))
    let first: Promise<void> = Promise.resolve()
    act(() => {
      first = importSongFiles([slow.file])
    })
    await act(() => importSongFiles([songFile('Quick.mid')]))
    expect(titles()).toEqual(['Quick'])

    await act(async () => {
      slow.arrive()
      await first
    })
    expect([...titles()].sort()).toEqual(['Quick', 'Slow'])
  })

  it('are all reported: the news of the second lot does not wipe out the news of the first', async () => {
    const lines = watchMessages()
    // The first file takes a while to read, and turns out not to be a song.
    const slow = slowFile('notes.txt', new TextEncoder().encode('not a song'))
    let first: Promise<void> = Promise.resolve()
    act(() => {
      first = importSongFiles([slow.file])
    })
    // Meanwhile the player drops a second file, which is read at once.
    await act(() => importSongFiles([songFile('Quick.mid')]))
    await act(async () => {
      slow.arrive()
      await first
    })

    // Both have been dealt with: the player is told about the song that was
    // added and about the file that was not.
    const report = lines().join('\n')
    expect(report).toContain('"Quick" was added.')
    expect(report).toContain(NOT_MIDI)
  })
})

describe('the message line', () => {
  it('names each file that could not be read at all among files that could', async () => {
    const lines = watchMessages()
    await act(() =>
      importSongFiles([songFile('One.mid'), unreadableFile('My tunes'), songFile('Two.mid')]),
    )
    // What exactly is said about it is not the point here: that it is named, as a problem, is.
    expect(lines()).toHaveLength(2)
    expect(lines()[0]).toBe('2 songs were added.')
    expect(lines()[1]).toMatch(/^! My tunes: \S/)
    expect(titles()).toEqual(['Two', 'One'])
  })

  it('makes way for the next news: a song that cannot be read, then a file that is added', async () => {
    const lines = watchMessages()
    const song = await addSong('Lost.mid')
    window.localStorage.removeItem(`pianoapp.song.v1.${song.id}`)
    // A second song is read, so that the library no longer has the first one at hand.
    const other = await addSong('Other.mid')
    expect(songLibrary.get(other.id)).not.toBeNull()

    let started = true
    act(() => {
      started = playSong(song.id)
    })
    expect(started).toBe(false)
    expect(lines()).toEqual(['! That song could not be read. Delete it and import the MIDI file again.'])
    expect(player.getState().status).toBe('empty')

    await act(() => importSongFiles([songFile('Next.mid')]))
    expect(lines()).toEqual(['"Next" was added.'])
  })
})

describe('options that leave less of the song than was already played', () => {
  /** A long part of eight notes (4 s) and a short one of two (1 s). */
  async function playLongAndShort(): Promise<string> {
    const song = await addSong(
      'Long and short.mid',
      { notes: [60, 62, 64, 65, 67, 69, 71, 72], name: 'Long' },
      { notes: [48, 50], name: 'Short' },
    )
    useFakeClock()
    play(song.id)
    return song.id
  }

  it('end the song there: it stops at the start, with no note held, and can be played again', async () => {
    const id = await playLongAndShort()
    letTimePass(2600)
    expect(player.getState().status).toBe('playing')
    expect(heldNotes()).toEqual([69])

    // Only the short part is left, and the song is already past its end.
    act(() => changeSongOptions({ trackIds: [2] }))
    expect(heldNotes()).toEqual([])
    expect(loadedSong().arrangement.duration).toBeCloseTo(1, 3)
    letTimePass(20)
    expect(player.getState().status).toBe('stopped')
    expect(player.getState().position).toBe(0)
    expect(player.getState().songId).toBe(id)

    act(() => player.play())
    letTimePass(100)
    expect(heldNotes()).toEqual([48])
  })

  it('keep a paused song paused, at the new end, and Play then starts it from the top', async () => {
    await playLongAndShort()
    letTimePass(2600)
    act(() => player.pause())
    act(() => changeSongOptions({ trackIds: [2] }))

    expect(player.getState().status).toBe('paused')
    expect(player.getState().position).toBeCloseTo(1, 3)
    expect(player.getState().duration).toBeCloseTo(1, 3)

    act(() => player.play())
    expect(player.getPosition()).toBeLessThan(0.01)
    letTimePass(100)
    expect(heldNotes()).toEqual([48])
  })
})

describe('the piano on screen changing while a song waits', () => {
  it('keeps a paused song paused at its place, with the notes fitted to the new piano', async () => {
    const song = await addSong('High.mid', { notes: [60, 96, 62, 98] })
    useFakeClock()
    play(song.id)
    act(() => changeSongOptions({ fitToPiano: true }))
    letTimePass(700)
    act(() => player.pause())
    const position = player.getState().position

    showPiano(SMALL_PIANO)
    expect(player.getState().status).toBe('paused')
    expect(player.getState().position).toBe(position)
    expect(loadedSong().arrangement.notes.map((note) => note.midi)).toEqual([60, 84, 62, 74])
    expect(loadedSong().arrangement.offPianoCount).toBe(0)

    // Back on the big piano the notes are where the song has them.
    showPiano(FULL_PIANO)
    expect(loadedSong().arrangement.notes.map((note) => note.midi)).toEqual([60, 96, 62, 98])
    expect(player.getState().position).toBe(position)
    expect(heldNotes()).toEqual([])
  })

  it('arranges the next song for the piano that was shown last, also while no song was loaded', async () => {
    const song = await addSong('High.mid', { notes: [60, 96] })
    showPiano(SMALL_PIANO)
    play(song.id)
    expect(loadedSong().arrangement.offPianoCount).toBe(1)
    act(() => closeSong())

    showPiano(FULL_PIANO)
    play(song.id)
    expect(loadedSong().arrangement.offPianoCount).toBe(0)
  })
})

describe('the speed', () => {
  it('stays between 50% and 150%, and a number that is none is ignored', () => {
    play(TWINKLE)
    act(() => changeSongOptions({ speed: 9 }))
    expect(player.getState().speed).toBe(1.5)
    expect(songLibrary.getOptions(TWINKLE).speed).toBe(1.5)

    act(() => changeSongOptions({ speed: 0 }))
    expect(player.getState().speed).toBe(0.5)

    act(() => changeSongOptions({ speed: Number.NaN }))
    expect(player.getState().speed).toBe(0.5)
    expect(songLibrary.getOptions(TWINKLE).speed).toBe(0.5)
  })

  it('of one song is not carried over to the next song, nor back', async () => {
    const song = await addSong('Mine.mid')
    play(TWINKLE)
    act(() => changeSongOptions({ speed: 0.5 }))

    play(song.id)
    expect(player.getState().speed).toBe(1)
    play(TWINKLE)
    expect(player.getState().speed).toBe(0.5)
  })
})

describe('the computer keys', () => {
  it('move for the parts that are chosen, not for the parts that are switched off', async () => {
    const song = await addSong('Hands.mid', { notes: [84, 86, 88, 89] }, { notes: [36, 38, 40, 41, 43] })
    play(song.id)
    // Both parts: more notes are low than high.
    expect(settingsStore.get().baseOctave).toBe(1)

    act(() => changeSongOptions({ trackIds: [1] }))
    // Changing the options of a loaded song leaves the keys where they are…
    expect(settingsStore.get().baseOctave).toBe(1)
    // …and the next time the song is played from the list they go to the part that is left:
    // the highest of its notes are within reach one step lower than the keys can go.
    play(song.id)
    expect(settingsStore.get().baseOctave).toBe(4)
  })
})
