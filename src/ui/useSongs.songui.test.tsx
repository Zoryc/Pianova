// @vitest-environment jsdom
/**
 * The song glue (src/ui/useSongs.ts) in the corners: files added while other
 * files are still being read, the time a song gives before its first note,
 * options that leave less of a song than has already been played, a piano
 * that changes while the song waits, where the computer keys go for a song
 * and where they go afterwards, and what is said when things go wrong.
 */
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { bus } from '../app/pianoApp'
import { player, songLibrary } from '../app/songsApp'
import type { Song } from '../songs/song'
import { STORAGE_KEY, settingsStore } from '../state/settings'
import {
  FULL_PIANO,
  SMALL_PIANO,
  addSong,
  damagedMidiBytes,
  fakeFile,
  midiBytes,
  resetSongs,
  showPiano,
  songFile,
  unreadableFile,
} from './songsTestKit'
import {
  LEAD_IN_SECONDS,
  UNREADABLE_SONG_MESSAGE,
  changeSongOptions,
  closeSong,
  closeSongOptions,
  importSongFiles,
  openSongOptions,
  playSong,
  useLoadedSong,
  useSongMessages,
  useSongOptionsOpen,
  useSongSession,
} from './useSongs'
import type { LoadedSong } from './useSongs'

const NOT_MIDI = 'That file is not a MIDI file. MIDI files usually end in .mid or .midi.'
const DAMAGED = 'That MIDI file seems to be damaged and could not be read.'
const COULD_NOT_BE_READ =
  'That could not be read. If it is a folder, open it and drop the MIDI files that are in it.'
const TWINKLE = 'starter:twinkle-twinkle-little-star'
const MARY = 'starter:mary-had-a-little-lamb'

/** The lead-in in milliseconds: how long after "Play" a song that starts at once is first heard. */
const LEAD_IN_MS = LEAD_IN_SECONDS * 1000

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

/** The notes the player has, as [pitch, start], with the start in whole milliseconds. */
function notesInPlayer(): [midi: number, milliseconds: number][] {
  return loadedSong().arrangement.notes.map((note) => [note.midi, Math.round(note.time * 1000)])
}

function play(id: string): void {
  act(() => {
    playSong(id)
  })
}

function titles(): string[] {
  return songLibrary.list().map((song) => song.title)
}

function keysPosition(): number {
  return settingsStore.get().baseOctave
}

/** Where the keys are in the settings the browser keeps for the next visit. */
function savedKeysPosition(): unknown {
  const text = window.localStorage.getItem(STORAGE_KEY) ?? '{}'
  return (JSON.parse(text) as Record<string, unknown>).baseOctave
}

/** One part of a song made by hand: its notes as [pitch, start in seconds], half a second each. */
interface HandMadePart {
  notes: readonly (readonly [midi: number, time: number])[]
  drums?: boolean
}

/**
 * Puts a song in the library whose notes start exactly where the test wants
 * them (the files of the test kit all start at once). Its parts get the ids
 * 0, 1, 2… Returns the id of the song.
 */
function addHandMadeSong(title: string, ...parts: readonly HandMadePart[]): string {
  const tracks = parts.map((part, index) => ({
    id: index,
    name: '',
    isPercussion: part.drums === true,
    program: null,
    notes: part.notes.map(([midi, time]) => ({ midi, time, duration: 0.5, velocity: 0.8 })),
  }))
  const ends = tracks.flatMap((track) => track.notes.map((note) => note.time + note.duration))
  const song: Song = {
    id: `hand-made-${title}`,
    title,
    duration: Math.max(...ends),
    tracks,
    createdAt: 1_700_000_000_000,
  }
  act(() => songLibrary.add(song))
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
    let second: Promise<void> = Promise.resolve()
    act(() => {
      first = importSongFiles([slow.file])
      // The first file is still on its way when the player adds another one.
      second = importSongFiles([songFile('Quick.mid')])
    })
    await act(async () => {
      slow.arrive()
      await Promise.all([first, second])
    })
    expect([...titles()].sort()).toEqual(['Quick', 'Slow'])
  })

  it('are all reported: the news of the second lot does not wipe out the news of the first', async () => {
    const lines = watchMessages()
    // The first file takes a while to read, and turns out not to be a song.
    const slow = slowFile('notes.txt', new TextEncoder().encode('not a song'))
    let first: Promise<void> = Promise.resolve()
    let second: Promise<void> = Promise.resolve()
    act(() => {
      first = importSongFiles([slow.file])
      // Meanwhile the player drops a second file.
      second = importSongFiles([songFile('Quick.mid')])
    })
    await act(async () => {
      slow.arrive()
      await Promise.all([first, second])
    })

    // Both have been dealt with: the player is told about the song that was
    // added and about the file that was not.
    const report = lines().join('\n')
    expect(report).toContain('"Quick" was added.')
    expect(report).toContain(NOT_MIDI)
    expect(titles()).toEqual(['Quick'])
  })

  it('start a new report once the others have all been read', async () => {
    const lines = watchMessages()
    await act(() => importSongFiles([new File(['hello'], 'notes.txt')]))
    expect(lines()).toEqual([`! ${NOT_MIDI}`])

    await act(() => importSongFiles([songFile('Later.mid')]))
    expect(lines()).toEqual(['"Later" was added.'])
  })
})

describe('the message line', () => {
  it('names what could not be read at all among files that could, and says what to do', async () => {
    const lines = watchMessages()
    await act(() =>
      importSongFiles([songFile('One.mid'), unreadableFile('My tunes'), songFile('Two.mid')]),
    )
    expect(lines()).toEqual(['2 songs were added.', `! My tunes: ${COULD_NOT_BE_READ}`])
    expect(titles()).toEqual(['Two', 'One'])
  })

  it('does not call a folder a damaged MIDI file, nor a damaged MIDI file a folder', async () => {
    const lines = watchMessages()
    // A folder that is dropped comes as something the browser cannot read.
    await act(() => importSongFiles([unreadableFile('My tunes')]))
    expect(lines()).toEqual([`! ${COULD_NOT_BE_READ}`])

    await act(() => importSongFiles([fakeFile('Broken.mid', damagedMidiBytes())]))
    expect(lines()).toEqual([`! ${DAMAGED}`])
    expect(titles()).toEqual([])
  })

  it('makes way for the next news: a song that cannot be read, then a file that is added', async () => {
    const lines = watchMessages()
    const song = await addSong('Lost.mid')
    window.localStorage.removeItem(`pianoapp.song.v1.${song.id}`)
    // The library may still have the notes at hand from adding the song. Reading
    // another song makes it let go of them: from here on they are really gone.
    const other = await addSong('Other.mid')
    expect(songLibrary.get(other.id)).not.toBeNull()
    expect(songLibrary.get(song.id)).toBeNull()

    let started = true
    act(() => {
      started = playSong(song.id)
    })
    expect(started).toBe(false)
    expect(lines()).toEqual([`! ${UNREADABLE_SONG_MESSAGE}`])
    expect(player.getState().status).toBe('empty')

    await act(() => importSongFiles([songFile('Next.mid')]))
    expect(lines()).toEqual(['"Next" was added.'])
  })
})

/*
 * A song whose first note comes at once would give the player nothing to see
 * before it sounds. So the song is played a little later than it is written:
 * its first note (drums do not count) comes two seconds after the start.
 */
describe('the time a song gives before its first note', () => {
  it('is two seconds for a song that starts at once: every note is that much later', async () => {
    const song = await addSong('Four.mid', { notes: [60, 62, 64, 65] })
    play(song.id)

    expect(LEAD_IN_SECONDS).toBe(2)
    expect(notesInPlayer()).toEqual([
      [60, 2000],
      [62, 2500],
      [64, 3000],
      [65, 3500],
    ])
    // Two seconds of notes: four seconds in the player.
    expect(loadedSong().arrangement.duration).toBeCloseTo(4, 3)
    expect(player.getState().duration).toBeCloseTo(4, 3)
  })

  it('leaves the song itself as it is: the list still shows its own length', async () => {
    const song = await addSong('Four.mid', { notes: [60, 62, 64, 65] })
    play(song.id)

    expect(songLibrary.list().map((listed) => listed.duration)).toEqual([song.duration])
    expect(song.duration).toBeCloseTo(2, 3)
    expect(loadedSong().song.duration).toBeCloseTo(2, 3)
    expect(songLibrary.get(song.id)?.tracks[0]?.notes[0]?.time).toBe(0)
  })

  it('lets nothing sound until it is over, and then the first note', async () => {
    const song = await addSong('Four.mid', { notes: [60, 62, 64, 65] })
    useFakeClock()
    play(song.id)
    expect(player.getState()).toMatchObject({ status: 'playing', position: 0 })

    letTimePass(LEAD_IN_MS - 100)
    expect(heldNotes()).toEqual([])
    expect(player.getState().status).toBe('playing')
    letTimePass(200)
    expect(heldNotes()).toEqual([60])
  })

  it('comes again each time the song starts from the top', async () => {
    const song = await addSong('Four.mid', { notes: [60, 62, 64, 65] })
    useFakeClock()
    play(song.id)
    letTimePass(LEAD_IN_MS + 700)
    expect(heldNotes()).toEqual([62])

    act(() => player.stop())
    expect(player.getState().position).toBe(0)
    act(() => player.play())
    letTimePass(LEAD_IN_MS - 100)
    expect(heldNotes()).toEqual([])
    letTimePass(200)
    expect(heldNotes()).toEqual([60])
  })

  it('never puts the song before its start: its place goes from nothing to the longer length', async () => {
    const song = await addSong('Four.mid', { notes: [60, 62, 64, 65] })
    play(song.id)
    act(() => player.pause())

    act(() => player.seek(-3))
    expect(player.getState().position).toBe(0)
    act(() => player.seek(99))
    expect(player.getState().position).toBeCloseTo(4, 3)
    expect(notesInPlayer().every(([, milliseconds]) => milliseconds >= LEAD_IN_MS)).toBe(true)
  })

  it('is only what is missing when the song has some silence of its own', () => {
    const id = addHandMadeSong('Half a second in', { notes: [[60, 0.5], [62, 1]] })
    play(id)
    expect(notesInPlayer()).toEqual([
      [60, 2000],
      [62, 2500],
    ])
    // A second and a half of song, and a second and a half more before it.
    expect(loadedSong().arrangement.duration).toBeCloseTo(3, 3)
  })

  it('is nothing when the first note comes after two seconds or more anyway', () => {
    const id = addHandMadeSong('A long wait', { notes: [[60, 2.5], [62, 3]] })
    play(id)
    expect(notesInPlayer()).toEqual([
      [60, 2500],
      [62, 3000],
    ])
    expect(loadedSong().arrangement.duration).toBeCloseTo(3.5, 3)
    expect(player.getState().duration).toBeCloseTo(3.5, 3)
  })

  it('does not count drums, which the piano never plays', () => {
    const drums = { notes: [[36, 0], [36, 0.5]] as const, drums: true }
    const id = addHandMadeSong('Drums first', drums, { notes: [[60, 1], [62, 1.5]] })
    play(id)
    // The first note of the piano was a second in: it is one second later now.
    expect(notesInPlayer()).toEqual([
      [60, 2000],
      [62, 2500],
    ])
  })

  it('is worked out from the whole song: no note jumps when parts are switched off and on', () => {
    const early = { notes: [[60, 0], [62, 0.5]] as const }
    const late = { notes: [[72, 1.5], [74, 2]] as const }
    const id = addHandMadeSong('Two parts', early, late)
    play(id)
    expect(notesInPlayer()).toEqual([
      [60, 2000],
      [62, 2500],
      [72, 3500],
      [74, 4000],
    ])
    expect(loadedSong().arrangement.duration).toBeCloseTo(4.5, 3)

    // Only the part that comes in later: its notes stay where they were, and so does the end.
    act(() => changeSongOptions({ trackIds: [1] }))
    expect(notesInPlayer()).toEqual([
      [72, 3500],
      [74, 4000],
    ])
    expect(loadedSong().arrangement.duration).toBeCloseTo(4.5, 3)
    expect(player.getState().duration).toBeCloseTo(4.5, 3)

    // The same when the song is played from the list with that choice saved.
    play(id)
    expect(notesInPlayer()).toEqual([
      [72, 3500],
      [74, 4000],
    ])

    act(() => changeSongOptions({ trackIds: 'auto' }))
    expect(notesInPlayer()).toEqual([
      [60, 2000],
      [62, 2500],
      [72, 3500],
      [74, 4000],
    ])
  })

  it('is the same on every piano, and with the notes fitted to it', async () => {
    const song = await addSong('High.mid', { notes: [60, 96] })
    play(song.id)
    act(() => changeSongOptions({ fitToPiano: true }))
    showPiano(SMALL_PIANO)
    expect(notesInPlayer()).toEqual([
      [60, 2000],
      [84, 2500],
    ])
    showPiano(FULL_PIANO)
    expect(notesInPlayer()).toEqual([
      [60, 2000],
      [96, 2500],
    ])
  })
})

describe('options that leave less of the song than was already played', () => {
  /** A long part of eight notes (4 s) and a short one of two (1 s), after the two seconds before them. */
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
    letTimePass(LEAD_IN_MS + 2600)
    expect(player.getState().status).toBe('playing')
    expect(heldNotes()).toEqual([69])

    // Only the short part is left, and the song is already past its end.
    act(() => changeSongOptions({ trackIds: [2] }))
    expect(heldNotes()).toEqual([])
    expect(loadedSong().arrangement.duration).toBeCloseTo(LEAD_IN_SECONDS + 1, 3)
    letTimePass(20)
    expect(player.getState().status).toBe('stopped')
    expect(player.getState().position).toBe(0)
    expect(player.getState().songId).toBe(id)

    act(() => player.play())
    letTimePass(LEAD_IN_MS + 100)
    expect(heldNotes()).toEqual([48])
  })

  it('keep a paused song paused, at the new end, and Play then starts it from the top', async () => {
    await playLongAndShort()
    letTimePass(LEAD_IN_MS + 2600)
    act(() => player.pause())
    act(() => changeSongOptions({ trackIds: [2] }))

    expect(player.getState().status).toBe('paused')
    expect(player.getState().position).toBeCloseTo(LEAD_IN_SECONDS + 1, 3)
    expect(player.getState().duration).toBeCloseTo(LEAD_IN_SECONDS + 1, 3)

    act(() => player.play())
    expect(player.getPosition()).toBeLessThan(0.01)
    letTimePass(LEAD_IN_MS + 100)
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
  const LOW = { notes: [36, 38, 40, 41] }
  const HIGH = { notes: [84, 86, 88, 89] }

  it('move for the parts that are chosen, not for the parts that are switched off', async () => {
    const song = await addSong('Hands.mid', HIGH, { notes: [36, 38, 40, 41, 43] })
    play(song.id)
    // Both parts: more notes are low than high.
    expect(keysPosition()).toBe(1)

    act(() => changeSongOptions({ trackIds: [1] }))
    // Changing the options of a loaded song leaves the keys where they are…
    expect(keysPosition()).toBe(1)
    // …and the next time the song is played from the list they go to the part that is left.
    // Two places reach all of its notes; the keys take the one nearer to where they start out.
    play(song.id)
    expect(keysPosition()).toBe(4)
  })

  it('go back to where the player had them when the song is closed', async () => {
    const song = await addSong('Low.mid', LOW)
    play(song.id)
    expect(keysPosition()).toBe(1)

    // Where the song put them is saved, as it always was…
    expect(savedKeysPosition()).toBe(1)

    act(() => closeSong())
    expect(keysPosition()).toBe(3)
    // …and so is the way back: a later visit finds the keys where the player had them.
    expect(savedKeysPosition()).toBe(3)
  })

  it('go back when the song that is loaded is deleted', async () => {
    const song = await addSong('Low.mid', LOW)
    play(song.id)
    expect(keysPosition()).toBe(1)

    act(() => songLibrary.remove(song.id))
    expect(player.getState().status).toBe('empty')
    expect(keysPosition()).toBe(3)
  })

  it('go back to a place of the player\'s own, not to the place they start out in', async () => {
    act(() => settingsStore.set({ baseOctave: 4 }))
    // Twinkle is all below the keys there: they come down for it.
    play(TWINKLE)
    expect(keysPosition()).toBe(3)

    act(() => closeSong())
    expect(keysPosition()).toBe(4)
  })

  it('stay where the player moved them while the song was loaded', async () => {
    const song = await addSong('Low.mid', LOW)
    play(song.id)
    expect(keysPosition()).toBe(1)

    act(() => settingsStore.set({ baseOctave: 2 }))
    act(() => closeSong())
    expect(keysPosition()).toBe(2)
  })

  it('stay where the player moved them during a song that had left them alone', () => {
    play(TWINKLE)
    expect(keysPosition()).toBe(3)

    act(() => settingsStore.set({ baseOctave: 5 }))
    act(() => closeSong())
    expect(keysPosition()).toBe(5)
  })

  it('go back to where the player had them after several songs in a row, not to where a song put them', async () => {
    const low = await addSong('Low.mid', LOW)
    const high = await addSong('High.mid', HIGH)
    act(() => settingsStore.set({ baseOctave: 2 }))

    play(low.id)
    expect(keysPosition()).toBe(1)
    play(high.id)
    expect(keysPosition()).toBe(4)
    play(low.id)
    expect(keysPosition()).toBe(1)

    act(() => closeSong())
    expect(keysPosition()).toBe(2)
  })

  it('do not go back twice: a song closed long ago moves nothing', async () => {
    const song = await addSong('Low.mid', LOW)
    play(song.id)
    act(() => closeSong())
    expect(keysPosition()).toBe(3)

    // The player goes where the song had put the keys, by themself this time.
    act(() => settingsStore.set({ baseOctave: 1 }))
    act(() => closeSong())
    expect(keysPosition()).toBe(1)
  })

  it('with "Melody only", go where the notes that will be played are', async () => {
    // A high tune over three low parts that strike a chord with each of its notes.
    const song = await addSong(
      'Tune over chords.mid',
      { notes: [84, 86, 88, 89], name: 'Tune' },
      { notes: [36, 36, 36, 36] },
      { notes: [40, 40, 40, 40] },
      { notes: [43, 43, 43, 43] },
    )
    play(song.id)
    // Every note is played: twelve of them are low and four are high.
    expect(keysPosition()).toBe(1)

    // Switching it on for the song that is loaded leaves the keys alone, like every option.
    act(() => changeSongOptions({ melodyOnly: true }))
    expect(keysPosition()).toBe(1)
    act(() => closeSong())
    expect(keysPosition()).toBe(3)

    // Played from the list with "Melody only" saved, only the tune is played: the keys go to it.
    play(song.id)
    expect(loadedSong().arrangement.notes.map((note) => note.midi)).toEqual([84, 86, 88, 89])
    expect(keysPosition()).toBe(4)
  })
})

describe('the page being left', () => {
  function leavePage(): void {
    act(() => {
      window.dispatchEvent(new Event('pagehide'))
    })
  }

  it('pauses the song, which keeps its place, for as long as the app is on the page', () => {
    useFakeClock()
    const app = renderHook(() => useSongSession(FULL_PIANO))
    play(TWINKLE)
    letTimePass(LEAD_IN_MS + 200)
    expect(heldNotes()).toEqual([60])

    leavePage()
    expect(player.getState().status).toBe('paused')
    expect(player.getState().position).toBeCloseTo(LEAD_IN_SECONDS + 0.2, 1)
    expect(heldNotes()).toEqual([])

    // Once the app is gone, nothing of it listens to the page any more.
    app.unmount()
    act(() => player.play())
    leavePage()
    expect(player.getState().status).toBe('playing')
  })
})

describe('the song options, open or closed', () => {
  /** Follows the options like the player line does, for the whole test. */
  function watchOptions(): () => boolean {
    const { result } = renderHook(() => useSongOptionsOpen())
    return () => result.current
  }

  function open(): void {
    act(() => openSongOptions())
  }

  /** Closes them as the app shell does at Escape. True when there was something to close. */
  function close(): boolean {
    let closed = false
    act(() => {
      closed = closeSongOptions()
    })
    return closed
  }

  it('cannot be opened without a song, and there is then nothing to close', () => {
    const areOpen = watchOptions()
    open()
    expect(areOpen()).toBe(false)
    expect(close()).toBe(false)
  })

  it('say whether there was something to close', () => {
    const areOpen = watchOptions()
    play(TWINKLE)
    expect(areOpen()).toBe(false)
    expect(close()).toBe(false)

    open()
    expect(areOpen()).toBe(true)
    expect(close()).toBe(true)
    expect(areOpen()).toBe(false)
    expect(close()).toBe(false)
  })

  it('are closed again when another song is played, or the same one from the list', () => {
    const areOpen = watchOptions()
    play(TWINKLE)
    open()
    play(MARY)
    expect(areOpen()).toBe(false)

    open()
    play(MARY)
    expect(areOpen()).toBe(false)
  })

  it('are closed with the song, and stay closed for the song that is played next', async () => {
    const areOpen = watchOptions()
    const song = await addSong('Mine.mid')
    play(song.id)
    open()
    act(() => closeSong())
    expect(areOpen()).toBe(false)
    expect(close()).toBe(false)

    play(song.id)
    open()
    act(() => songLibrary.remove(song.id))
    expect(areOpen()).toBe(false)

    play(TWINKLE)
    expect(areOpen()).toBe(false)
  })

  it('stay open while the song only changes how it is played, or its name', async () => {
    const areOpen = watchOptions()
    const song = await addSong('Mine.mid', { notes: [60, 62] }, { notes: [48, 50] })
    play(song.id)
    open()

    act(() => changeSongOptions({ melodyOnly: true, speed: 0.75 }))
    act(() => changeSongOptions({ trackIds: [1] }))
    act(() => songLibrary.rename(song.id, 'Still mine'))
    showPiano(SMALL_PIANO)
    expect(areOpen()).toBe(true)
  })
})
