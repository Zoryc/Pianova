// @vitest-environment jsdom
/**
 * The glue between the song modules and the screen (src/ui/useSongs.ts), with
 * the app's real player, library and settings: adding songs from files,
 * loading a song, and keeping what the player plays up to date.
 */
import { act, cleanup, renderHook } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { bus } from '../app/pianoApp'
import { player, songLibrary } from '../app/songsApp'
import type { PianoRange } from '../core/layout'
import type { Song } from '../songs/song'
import { SongStorageError } from '../songs/songLibrary'
import { STARTER_SONGS } from '../songs/starterSongs'
import { settingsStore } from '../state/settings'
import {
  FULL_PIANO,
  NOTE_SECONDS,
  SMALL_PIANO,
  addSong,
  damagedMidiBytes,
  fakeFile,
  hugeFile,
  midiBytes,
  resetSongs,
  showPiano,
  songFile,
  unreadableFile,
  unsupportedMidiBytes,
} from './songsTestKit'
import {
  LEAD_IN_SECONDS,
  UNREADABLE_SONG_MESSAGE,
  changeSongOptions,
  closeSong,
  closeSongOptions,
  forgetKeysBeforeSong,
  importSongFiles,
  openSongOptions,
  playSong,
  useLoadedSong,
  usePlayerState,
  useSongMessages,
  useSongOptionsOpen,
  useSongSession,
} from './useSongs'
import type { LoadedSong, SongMessage } from './useSongs'

const NOT_MIDI = 'That file is not a MIDI file. MIDI files usually end in .mid or .midi.'
const TOO_BIG = 'That file is too big. The limit is 5 MB.'
const NO_NOTES = 'That MIDI file has no notes in it.'
const UNSUPPORTED = 'That kind of MIDI file is not supported yet.'
const DAMAGED = 'That MIDI file seems to be damaged and could not be read.'
const FULL = 'There is no room left to save songs. Delete a song and try again.'
const CANNOT_BE_READ =
  'That could not be read. If it is a folder, open it and drop the MIDI files that are in it.'

const TWINKLE = 'starter:twinkle-twinkle-little-star'

/** How long every song of these tests waits before its first note, on the fake clock. */
const LEAD_IN_MS = LEAD_IN_SECONDS * 1000

/** The message line as text: one string per line, problems marked with "!". */
function messageLines(): string[] {
  const { result, unmount } = renderHook(() => useSongMessages())
  const lines = result.current.map(lineOf)
  unmount()
  return lines
}

function lineOf(message: SongMessage): string {
  return message.isProblem ? `! ${message.text}` : message.text
}

async function importFiles(...files: File[]): Promise<void> {
  await act(() => importSongFiles(files))
}

function loadedSong(): LoadedSong {
  const { result, unmount } = renderHook(() => useLoadedSong())
  const loaded = result.current
  unmount()
  if (loaded === null) throw new Error('No song is loaded.')
  return loaded
}

function play(id: string): boolean {
  let started = false
  act(() => {
    started = playSong(id)
  })
  return started
}

function titles(): string[] {
  return songLibrary.list().map((song) => song.title)
}

function pitchesPlayed(): number[] {
  return loadedSong().arrangement.notes.map((note) => note.midi)
}

/** When each note that is played starts, in seconds from the start of the player line. */
function startTimes(): number[] {
  return loadedSong().arrangement.notes.map((note) => note.time)
}

/** One part of a song made in code: it starts when the test says, and plays a note every half second. */
interface TimedPart {
  startsAt: number
  notes: readonly number[]
  drums?: boolean
}

/**
 * Puts a song made in code into the library and returns its id. Unlike a file,
 * it may start with any amount of silence, and each part may start when it likes.
 */
function addSongOfParts(title: string, ...parts: readonly TimedPart[]): string {
  const tracks = parts.map((part, index) => ({
    id: index + 1,
    name: '',
    isPercussion: part.drums === true,
    program: null,
    notes: part.notes.map((midi, step) => ({
      midi,
      time: part.startsAt + step * NOTE_SECONDS,
      duration: NOTE_SECONDS,
      velocity: 0.8,
    })),
  }))
  const ends = parts.map((part) => part.startsAt + part.notes.length * NOTE_SECONDS)
  const song: Song = { id: `made:${title}`, title, duration: Math.max(...ends), tracks, createdAt: 1 }
  act(() => songLibrary.add(song))
  return song.id
}

function useFakeClock(): void {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'performance'] })
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

describe('importSongFiles', () => {
  it('adds a MIDI file to the library under the name of the file, and says so', async () => {
    await importFiles(songFile('Moonlight.mid'))
    expect(titles()).toEqual(['Moonlight'])
    expect(songLibrary.list()[0]?.duration).toBeCloseTo(4 * NOTE_SECONDS)
    expect(messageLines()).toEqual(['"Moonlight" was added.'])
  })

  it.each([
    ['a file that is not a MIDI file', fakeFile('notes.txt', new TextEncoder().encode('hello')), NOT_MIDI],
    ['a file over the limit', hugeFile('huge.mid'), TOO_BIG],
    ['a MIDI file without notes', fakeFile('empty.mid', midiBytes()), NO_NOTES],
    ['a kind of MIDI file the app does not read', fakeFile('two.mid', unsupportedMidiBytes()), UNSUPPORTED],
    ['a damaged MIDI file', fakeFile('cut.mid', damagedMidiBytes()), DAMAGED],
    ['a file the browser cannot read', unreadableFile('gone.mid'), CANNOT_BE_READ],
    ['a folder, which the browser cannot read either', unreadableFile('My songs'), CANNOT_BE_READ],
  ])('says what is wrong with %s, and adds nothing', async (_what, file, sentence) => {
    await importFiles(file)
    expect(messageLines()).toEqual([`! ${sentence}`])
    expect(titles()).toEqual([])
  })

  it('never reads a file that is over the limit', async () => {
    const file = hugeFile('huge.mid')
    await importFiles(file)
    expect(file.arrayBuffer).not.toHaveBeenCalled()
  })

  it('says so when the browser has no room left for the song', async () => {
    vi.spyOn(songLibrary, 'add').mockImplementation(() => {
      throw new SongStorageError('full')
    })
    await importFiles(songFile('Moonlight.mid'))
    expect(messageLines()).toEqual([`! ${FULL}`])
  })

  it('counts the songs when several files are added at once', async () => {
    await importFiles(songFile('One.mid'), songFile('Two.mid'), songFile('Three.mid'))
    expect(titles().sort()).toEqual(['One', 'Three', 'Two'])
    expect(messageLines()).toEqual(['3 songs were added.'])
  })

  it('adds the good files of several and names each file that could not be added', async () => {
    await importFiles(
      songFile('One.mid'),
      fakeFile('holiday.jpg', new Uint8Array([1, 2, 3])),
      songFile('Two.mid'),
      hugeFile('huge.mid'),
    )
    expect(titles().sort()).toEqual(['One', 'Two'])
    expect(messageLines()).toEqual([
      '2 songs were added.',
      `! holiday.jpg: ${NOT_MIDI}`,
      `! huge.mid: ${TOO_BIG}`,
    ])
  })

  it('names the one song that was added when the other files could not be', async () => {
    await importFiles(fakeFile('cut.mid', damagedMidiBytes()), songFile('One.mid'))
    expect(messageLines()).toEqual(['"One" was added.', `! cut.mid: ${DAMAGED}`])
  })

  it('names every file when none of several could be added', async () => {
    await importFiles(fakeFile('a.txt', new Uint8Array(8)), fakeFile('b.mid', midiBytes()))
    expect(messageLines()).toEqual([`! a.txt: ${NOT_MIDI}`, `! b.mid: ${NO_NOTES}`])
  })

  it('adds the same file twice as two songs', async () => {
    const bytes = midiBytes({ notes: [60, 64] })
    await importFiles(fakeFile('Again.mid', bytes))
    await importFiles(fakeFile('Again.mid', bytes))
    expect(titles()).toEqual(['Again', 'Again'])
    expect(new Set(songLibrary.list().map((song) => song.id)).size).toBe(2)
  })

  it('changes nothing, not even the message, when there is no file', async () => {
    await importFiles(songFile('One.mid'))
    await importFiles()
    expect(messageLines()).toEqual(['"One" was added.'])
  })

  it('never fails, whatever the files are', async () => {
    const broken = { name: 'odd.mid', size: 10 } as unknown as File
    await expect(importSongFiles([broken])).resolves.toBeUndefined()
    expect(messageLines()).toEqual([`! ${CANNOT_BE_READ}`])
  })

  describe('while other files are still being read', () => {
    /** A file whose bytes arrive only when the test says so, like a big file on a slow disk. */
    function slowFile(name: string, bytes: Uint8Array): { file: File; arrive(): void } {
      let arrive: () => void = () => {}
      const arrayBuffer = (): Promise<ArrayBuffer> =>
        new Promise((resolve) => {
          arrive = () => resolve(Uint8Array.from(bytes).buffer)
        })
      const file = { name, size: bytes.byteLength, arrayBuffer } as unknown as File
      return { file, arrive: () => arrive() }
    }

    it('joins the same report, which says how every file of both lots went', async () => {
      const slow = slowFile('notes.txt', new TextEncoder().encode('not a song'))
      let first: Promise<void> = Promise.resolve()
      act(() => {
        first = importSongFiles([slow.file])
      })
      await importFiles(songFile('Quick.mid'))
      // The second lot is done first: its news is shown without waiting for the slow file.
      expect(messageLines()).toEqual(['"Quick" was added.'])

      await act(async () => {
        slow.arrive()
        await first
      })
      expect(messageLines()).toEqual(['"Quick" was added.', `! notes.txt: ${NOT_MIDI}`])
    })

    it('starts a new report once all of them have been read', async () => {
      const slow = slowFile('Slow.mid', midiBytes({ notes: [60] }))
      let first: Promise<void> = Promise.resolve()
      act(() => {
        first = importSongFiles([slow.file])
      })
      await importFiles(songFile('Quick.mid'))
      await act(async () => {
        slow.arrive()
        await first
      })
      expect(messageLines()).toEqual(['2 songs were added.'])

      await importFiles(songFile('Later.mid'))
      expect(messageLines()).toEqual(['"Later" was added.'])
    })
  })
})

describe('the message line', () => {
  it('is forgotten once the panel that shows it has gone', async () => {
    await importFiles(songFile('One.mid'))
    const panel = renderHook(() => useSongMessages())
    expect(panel.result.current).toHaveLength(1)

    panel.unmount()
    await Promise.resolve()
    expect(messageLines()).toEqual([])
  })

  it('keeps a message that was there before the panel opened, also the way React opens it in development', async () => {
    await importFiles(songFile('One.mid'))
    const panel = renderHook(() => useSongMessages(), { wrapper: StrictMode })
    await Promise.resolve()
    expect(panel.result.current.map(lineOf)).toEqual(['"One" was added.'])
  })
})

describe('playSong', () => {
  it('loads the song into the player at its own speed and starts it', async () => {
    const song = await addSong('Scale.mid', { notes: [60, 62, 64] })
    expect(play(song.id)).toBe(true)

    expect(player.getState()).toMatchObject({
      status: 'playing',
      songId: song.id,
      title: 'Scale',
      position: 0,
      speed: 1,
    })
    expect(player.getState().duration).toBeCloseTo(LEAD_IN_SECONDS + 3 * NOTE_SECONDS)
    expect(pitchesPlayed()).toEqual([60, 62, 64])
  })

  it('plays the starter songs, which are not in the library', () => {
    expect(play(TWINKLE)).toBe(true)
    expect(player.getState()).toMatchObject({
      status: 'playing',
      songId: TWINKLE,
      title: 'Twinkle, Twinkle, Little Star',
    })
  })

  it('starts the song again from the top when it is played again', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'performance'] })
    const song = await addSong('Scale.mid', { notes: [60, 62, 64, 65] })
    play(song.id)
    act(() => vi.advanceTimersByTime(700))
    expect(player.getPosition()).toBeCloseTo(0.7, 1)

    play(song.id)
    expect(player.getState()).toMatchObject({ status: 'playing', position: 0 })
  })

  it('says why, and plays nothing, when the saved notes of a song are gone', async () => {
    const song = await addSong('Scale.mid')
    window.localStorage.removeItem(`pianoapp.song.v1.${song.id}`)

    expect(play(song.id)).toBe(false)
    expect(player.getState().status).toBe('empty')
    expect(messageLines()).toEqual([`! ${UNREADABLE_SONG_MESSAGE}`])
  })

  it('plays nothing for a song that does not exist', () => {
    expect(play('no-such-song')).toBe(false)
    expect(player.getState().status).toBe('empty')
  })

  it('falls back to every part when the saved choice of parts leaves nothing to play', async () => {
    const song = await addSong('Duet.mid', { notes: [60] }, { notes: [72] })
    songLibrary.setOptions(song.id, { trackIds: [99] })
    play(song.id)
    expect(pitchesPlayed()).toEqual([60, 72])
    expect(songLibrary.getOptions(song.id).trackIds).toBe('auto')
  })
})

describe('the lead-in', () => {
  it('lets two seconds pass before the first note, so that it is seen falling', async () => {
    useFakeClock()
    const song = await addSong('Scale.mid', { notes: [60, 62, 64] })
    play(song.id)
    expect(startTimes()).toEqual([2, 2.5, 3])
    expect(player.getState().position).toBe(0)

    act(() => vi.advanceTimersByTime(LEAD_IN_MS - 20))
    expect(heldNotes()).toEqual([])
    act(() => vi.advanceTimersByTime(40))
    expect(heldNotes()).toEqual([60])
  })

  it('makes the song in the player that much longer, and leaves its length in the list alone', async () => {
    const song = await addSong('Scale.mid', { notes: [60, 62, 64] })
    play(song.id)
    expect(loadedSong().arrangement.duration).toBeCloseTo(LEAD_IN_SECONDS + 3 * NOTE_SECONDS)
    expect(player.getState().duration).toBe(loadedSong().arrangement.duration)
    expect(songLibrary.list()[0]?.duration).toBeCloseTo(3 * NOTE_SECONDS)
    expect(loadedSong().song.duration).toBeCloseTo(3 * NOTE_SECONDS)
  })

  it('is given to every starter song, whose first note is written at the very start', () => {
    for (const song of STARTER_SONGS) {
      play(song.id)
      expect(startTimes()[0], song.title).toBe(LEAD_IN_SECONDS)
      expect(player.getState().duration, song.title).toBeCloseTo(song.duration + LEAD_IN_SECONDS)
    }
  })

  it('only adds what is missing when the song starts with some silence of its own', () => {
    play(addSongOfParts('Half a second in', { startsAt: 0.5, notes: [60, 62] }))
    expect(startTimes()).toEqual([2, 2.5])
    expect(player.getState().duration).toBeCloseTo(3)
  })

  it('adds nothing to a song whose first note already comes after two seconds or more', () => {
    play(addSongOfParts('Slow start', { startsAt: 2, notes: [60, 62] }))
    expect(startTimes()).toEqual([2, 2.5])
    play(addSongOfParts('Slower start', { startsAt: 3.5, notes: [60, 62] }))
    expect(startTimes()).toEqual([3.5, 4])
    expect(player.getState().duration).toBeCloseTo(4.5)
  })

  it('does not count the drums, which the piano never plays', () => {
    const id = addSongOfParts(
      'Drums first',
      { startsAt: 0, notes: [36, 38, 36, 38], drums: true },
      { startsAt: 1, notes: [60, 62] },
    )
    play(id)
    expect(startTimes()).toEqual([2, 2.5])
  })

  it('is worked out from the whole song: the notes do not jump when parts are switched', () => {
    const id = addSongOfParts(
      'Two hands',
      { startsAt: 0, notes: [60, 62, 64, 65] },
      { startsAt: 1, notes: [72, 74] },
    )
    play(id)
    expect(startTimes()).toEqual([2, 2.5, 3, 3, 3.5, 3.5])
    const whole = loadedSong().arrangement.duration

    // The part that starts later still starts a second after where the other one would.
    act(() => changeSongOptions({ trackIds: [2] }))
    expect(startTimes()).toEqual([3, 3.5])
    expect(loadedSong().arrangement.duration).toBeCloseTo(whole)
    act(() => changeSongOptions({ melodyOnly: true, trackIds: 'auto' }))
    expect(startTimes()).toEqual([2, 2.5, 3, 3.5])
  })

  it('stays when the piano on screen changes', async () => {
    const song = await addSong('Wide.mid', { notes: [30, 60] })
    songLibrary.setOptions(song.id, { fitToPiano: true })
    play(song.id)
    showPiano(SMALL_PIANO)
    expect(pitchesPlayed()).toEqual([54, 60])
    expect(startTimes()).toEqual([2, 2.5])
  })

  it('is part of the song for the slider: the song can be put back into it, and it is waited out again', async () => {
    useFakeClock()
    const song = await addSong('Scale.mid', { notes: [60, 62, 64] })
    play(song.id)
    act(() => vi.advanceTimersByTime(LEAD_IN_MS + 700))
    expect(heldNotes()).toEqual([62])

    act(() => player.seek(1.5))
    expect(heldNotes()).toEqual([])
    act(() => vi.advanceTimersByTime(400))
    expect(heldNotes()).toEqual([])
    act(() => vi.advanceTimersByTime(200))
    expect(heldNotes()).toEqual([60])
  })

  it('is waited out again when the song has played to its end and is started once more', async () => {
    useFakeClock()
    const song = await addSong('Short.mid', { notes: [60, 62] })
    play(song.id)
    act(() => vi.advanceTimersByTime(LEAD_IN_MS + 2 * NOTE_SECONDS * 1000 + 50))
    expect(player.getState()).toMatchObject({ status: 'stopped', position: 0 })
    expect(heldNotes()).toEqual([])

    act(() => player.play())
    act(() => vi.advanceTimersByTime(LEAD_IN_MS - 20))
    expect(heldNotes()).toEqual([])
    act(() => vi.advanceTimersByTime(40))
    expect(heldNotes()).toEqual([60])
  })

  it('never leaves two notes of one pitch sounding at once', () => {
    // Times that cannot be written exactly as numbers: the notes follow each other without a gap.
    const id = addSongOfParts('Repeats', { startsAt: 0.1, notes: [60, 60, 60, 60, 60, 60, 60] })
    play(id)
    const notes = loadedSong().arrangement.notes
    for (let index = 1; index < notes.length; index += 1) {
      const before = notes[index - 1]
      const note = notes[index]
      if (!before || !note) throw new Error('A note is missing.')
      expect(before.time + before.duration).toBeLessThanOrEqual(note.time)
    }
  })
})

describe('the computer keys', () => {
  function keysAt(): number {
    return settingsStore.get().baseOctave
  }

  it('stay where they are for every starter song', () => {
    for (const song of STARTER_SONGS) {
      play(song.id)
      expect(keysAt(), song.title).toBe(3)
    }
  })

  it('move to where they can play the most of the song', async () => {
    const low = await addSong('Low.mid', { notes: [36, 38, 40, 41] })
    play(low.id)
    expect(keysAt()).toBe(1)

    const high = await addSong('High.mid', { notes: [96, 98, 100] })
    play(high.id)
    expect(keysAt()).toBe(5)
  })

  it('count only the piano keys that have a computer key', async () => {
    const song = await addSong('Middle.mid', { notes: [60, 60, 60] })
    act(() => settingsStore.set({ bindings: { KeyA: 0 } }))
    play(song.id)
    // The only key is on the first note of the zone, so the zone starts at middle C.
    expect(keysAt()).toBe(4)
  })

  it('go where the notes that are played are when "Melody only" is on', async () => {
    const song = await addSong(
      'Tune over chords.mid',
      { notes: [84, 86, 88, 89] },
      { notes: [36, 36, 36, 36] },
      { notes: [40, 40, 40, 40] },
      { notes: [43, 43, 43, 43] },
    )
    play(song.id)
    // Every part: most of the notes are low.
    expect(keysAt()).toBe(1)

    act(() => changeSongOptions({ melodyOnly: true }))
    play(song.id)
    // Only the top note of each chord is played, and that is where the keys go.
    expect(pitchesPlayed()).toEqual([84, 86, 88, 89])
    expect(keysAt()).toBe(4)
  })

  it('go back to where they were when the song is closed', async () => {
    const low = await addSong('Low.mid', { notes: [36, 38, 40, 41] })
    play(low.id)
    expect(keysAt()).toBe(1)

    act(() => closeSong())
    expect(keysAt()).toBe(3)
    expect(JSON.parse(window.localStorage.getItem('pianoapp.settings.v1') ?? '{}')).toMatchObject({
      baseOctave: 3,
    })
  })

  it('go back to where they were when the song is deleted', async () => {
    const low = await addSong('Low.mid', { notes: [36, 38, 40, 41] })
    play(low.id)
    act(() => songLibrary.remove(low.id))
    expect(player.getState().status).toBe('empty')
    expect(keysAt()).toBe(3)
  })

  it('go back to where the player had put them, which need not be the middle', () => {
    act(() => settingsStore.set({ baseOctave: 2 }))
    play(TWINKLE)
    expect(keysAt()).toBe(3)

    act(() => closeSong())
    expect(keysAt()).toBe(2)
  })

  it('stay where the player moved them while the song was loaded', async () => {
    const low = await addSong('Low.mid', { notes: [36, 38, 40, 41] })
    play(low.id)
    act(() => settingsStore.set({ baseOctave: 2 }))

    act(() => closeSong())
    expect(keysAt()).toBe(2)
  })

  it('go back to where the player had them after several songs, not to where one of the songs put them', async () => {
    const low = await addSong('Low.mid', { notes: [36, 38, 40, 41] })
    const high = await addSong('High.mid', { notes: [96, 98, 100] })
    play(low.id)
    play(high.id)
    expect(keysAt()).toBe(5)

    act(() => closeSong())
    expect(keysAt()).toBe(3)
  })

  it('go back to where the player moved them between two songs', async () => {
    const low = await addSong('Low.mid', { notes: [36, 38, 40, 41] })
    const high = await addSong('High.mid', { notes: [96, 98, 100] })
    play(low.id)
    act(() => settingsStore.set({ baseOctave: 2 }))
    play(high.id)
    expect(keysAt()).toBe(5)

    act(() => closeSong())
    expect(keysAt()).toBe(2)
  })

  it('are not moved by closing a song that had left them alone', () => {
    play(TWINKLE)
    act(() => settingsStore.set({ baseOctave: 4 }))
    act(() => closeSong())
    expect(keysAt()).toBe(4)

    // Played again, the song takes them to the middle for itself, and gives them back.
    play(TWINKLE)
    expect(keysAt()).toBe(3)
    act(() => closeSong())
    expect(keysAt()).toBe(4)
  })

  it('stay where they are once the place from before the song is forgotten, as "Reset all settings" asks', async () => {
    const low = await addSong('Low.mid', { notes: [36, 38, 40, 41] })
    act(() => settingsStore.set({ baseOctave: 4 }))
    play(TWINKLE)
    // The song took the keys to the middle, which is also where a reset puts them.
    expect(keysAt()).toBe(3)

    act(() => {
      settingsStore.reset()
      forgetKeysBeforeSong()
    })
    act(() => closeSong())
    expect(keysAt()).toBe(3)

    // The next song goes back to the middle too: nothing from before the reset is left.
    play(low.id)
    expect(keysAt()).toBe(1)
    act(() => closeSong())
    expect(keysAt()).toBe(3)
  })
})

describe('the song options', () => {
  function optionsOpen() {
    return renderHook(() => useSongOptionsOpen()).result
  }

  it('are closed until they are opened, and open only while a song is loaded', () => {
    const open = optionsOpen()
    act(() => openSongOptions())
    expect(open.current).toBe(false)

    play(TWINKLE)
    expect(open.current).toBe(false)
    act(() => openSongOptions())
    expect(open.current).toBe(true)
  })

  it('are closed by closeSongOptions, which says whether there was anything to close', () => {
    const open = optionsOpen()
    play(TWINKLE)
    act(() => openSongOptions())

    let closed = false
    act(() => {
      closed = closeSongOptions()
    })
    expect(closed).toBe(true)
    expect(open.current).toBe(false)
    expect(closeSongOptions()).toBe(false)
  })

  it('are closed when another song is played, and when the song is closed', async () => {
    const song = await addSong('Scale.mid')
    const open = optionsOpen()
    play(TWINKLE)
    act(() => openSongOptions())
    play(song.id)
    expect(open.current).toBe(false)

    act(() => openSongOptions())
    act(() => closeSong())
    expect(open.current).toBe(false)
    expect(closeSongOptions()).toBe(false)
  })

  it('stay open when a song that cannot be read was not played', async () => {
    const open = optionsOpen()
    play(TWINKLE)
    act(() => openSongOptions())
    expect(play('no-such-song')).toBe(false)
    expect(open.current).toBe(true)
  })

  it('stay open while the options themselves are changed', () => {
    const open = optionsOpen()
    play(TWINKLE)
    act(() => openSongOptions())
    act(() => changeSongOptions({ melodyOnly: true, speed: 0.8 }))
    expect(open.current).toBe(true)
  })
})

describe('options of the loaded song', () => {
  it('saves the speed with the song and gives it back the next time the song is loaded', async () => {
    const slow = await addSong('Slow.mid')
    const other = await addSong('Other.mid')
    play(slow.id)
    act(() => changeSongOptions({ speed: 0.6 }))
    expect(player.getState().speed).toBe(0.6)
    expect(songLibrary.getOptions(slow.id).speed).toBe(0.6)

    play(other.id)
    expect(player.getState().speed).toBe(1)
    play(slow.id)
    expect(player.getState().speed).toBe(0.6)
  })

  it('remembers speed and options for a starter song too', () => {
    play(TWINKLE)
    act(() => changeSongOptions({ speed: 1.25, melodyOnly: true }))
    act(() => closeSong())

    play(TWINKLE)
    expect(player.getState().speed).toBe(1.25)
    expect(loadedSong().options).toMatchObject({ speed: 1.25, melodyOnly: true })
  })

  it('plays one note at a time with "melody only", and all of them again without', async () => {
    const song = await addSong('Chords.mid', { notes: [60, 62] }, { notes: [72, 74] })
    play(song.id)
    expect(pitchesPlayed()).toEqual([60, 72, 62, 74])

    act(() => changeSongOptions({ melodyOnly: true }))
    expect(pitchesPlayed()).toEqual([72, 74])
    expect(songLibrary.getOptions(song.id).melodyOnly).toBe(true)

    act(() => changeSongOptions({ melodyOnly: false }))
    expect(pitchesPlayed()).toEqual([60, 72, 62, 74])
  })

  it('plays only the chosen parts', async () => {
    const song = await addSong('Duet.mid', { notes: [60] }, { notes: [72] })
    play(song.id)
    act(() => changeSongOptions({ trackIds: [2] }))
    expect(pitchesPlayed()).toEqual([72])
  })

  it('keeps the place in the song, and keeps playing, when an option changes', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'performance'] })
    const song = await addSong('Long.mid', { notes: [60, 62, 64, 65, 67, 69] }, { notes: [72] })
    play(song.id)
    act(() => vi.advanceTimersByTime(LEAD_IN_MS + 1200))

    act(() => changeSongOptions({ melodyOnly: true }))
    expect(player.getState().status).toBe('playing')
    expect(player.getPosition()).toBeCloseTo(LEAD_IN_SECONDS + 1.2, 1)
    // Whatever the player was holding is let go; the song carries on with its next note.
    expect(bus.getActiveNotes().size).toBe(0)
    act(() => vi.advanceTimersByTime(400))
    expect([...bus.getActiveNotes()]).toEqual([65])
  })

  it('keeps a paused song paused, at its place, when an option changes', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'performance'] })
    const song = await addSong('Long.mid', { notes: [60, 62, 64, 65] })
    play(song.id)
    act(() => vi.advanceTimersByTime(800))
    act(() => player.pause())
    const place = player.getState().position

    act(() => changeSongOptions({ fitToPiano: true }))
    expect(player.getState()).toMatchObject({ status: 'paused', position: place })
  })

  it('does not interrupt the notes that are sounding when only the speed changes', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'performance'] })
    const song = await addSong('Long.mid', { notes: [60, 62, 64, 65] })
    play(song.id)
    act(() => vi.advanceTimersByTime(LEAD_IN_MS + 100))
    const before = loadedSong().arrangement

    act(() => changeSongOptions({ speed: 0.5 }))
    expect([...bus.getActiveNotes()]).toEqual([60])
    expect(loadedSong().arrangement).toBe(before)
  })

  it('does nothing when no song is loaded', () => {
    const before = player.getState()
    act(() => changeSongOptions({ speed: 0.75, melodyOnly: true }))
    expect(player.getState()).toBe(before)
    expect(before.status).toBe('empty')
  })
})

describe('following the library', () => {
  it('closes the song when it is deleted', async () => {
    const song = await addSong('Scale.mid')
    play(song.id)
    act(() => songLibrary.remove(song.id))
    expect(player.getState().status).toBe('empty')
    expect(renderHook(() => useLoadedSong()).result.current).toBeNull()
  })

  it('keeps playing when another song is deleted', async () => {
    const song = await addSong('Scale.mid')
    const other = await addSong('Other.mid')
    play(song.id)
    act(() => songLibrary.remove(other.id))
    expect(player.getState()).toMatchObject({ status: 'playing', songId: song.id })
  })

  it('takes over the new name of the song, without losing its place', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'performance'] })
    const song = await addSong('Scale.mid')
    play(song.id)
    act(() => vi.advanceTimersByTime(600))

    act(() => songLibrary.rename(song.id, 'Do Re Mi'))
    expect(player.getState()).toMatchObject({ status: 'playing', title: 'Do Re Mi' })
    expect(player.getPosition()).toBeCloseTo(0.6, 1)
    expect(loadedSong().song.title).toBe('Do Re Mi')
  })
})

describe('closeSong', () => {
  it('empties the player and lets go of its notes', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'performance'] })
    const song = await addSong('Scale.mid')
    play(song.id)
    act(() => vi.advanceTimersByTime(LEAD_IN_MS + 100))
    expect(bus.getActiveNotes().size).toBe(1)

    act(() => closeSong())
    expect(player.getState().status).toBe('empty')
    expect(bus.getActiveNotes().size).toBe(0)
  })
})

describe('useSongSession', () => {
  function session(range: PianoRange = FULL_PIANO) {
    return renderHook((piano: PianoRange) => useSongSession(piano), { initialProps: range })
  }

  it('says that nothing is loaded while the player is empty', () => {
    const { result } = session()
    expect(result.current).toEqual({ falling: null, loaded: false, playing: false })
  })

  it('says when a song is loaded and whether it is playing', async () => {
    const song = await addSong('Scale.mid')
    const { result } = session()

    play(song.id)
    expect(result.current).toMatchObject({ loaded: true, playing: true })
    act(() => player.pause())
    expect(result.current).toMatchObject({ loaded: true, playing: false })
    act(() => player.stop())
    expect(result.current).toMatchObject({ loaded: true, playing: false })
    act(() => closeSong())
    expect(result.current).toEqual({ falling: null, loaded: false, playing: false })
  })

  it('hands the sky the notes, the place and the state of the song', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'performance'] })
    const song = await addSong('Scale.mid', { notes: [60, 62, 64] })
    const { result } = session()
    play(song.id)

    const falling = result.current.falling
    expect(falling?.getNotes().map((note) => note.midi)).toEqual([60, 62, 64])
    // The very notes the player plays, lead-in included: a bar lands when its note sounds.
    expect(falling?.getNotes()).toBe(loadedSong().arrangement.notes)
    expect(falling?.getNotes()[0]?.time).toBe(LEAD_IN_SECONDS)
    expect(falling?.isPlaying()).toBe(true)
    expect(falling?.getPosition()).toBe(0)

    act(() => vi.advanceTimersByTime(730))
    expect(falling?.getPosition()).toBeCloseTo(0.73, 2)
    act(() => player.pause())
    expect(falling?.isPlaying()).toBe(false)
  })

  it('does not draw the app again for every step of the song, only when something changes', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'performance'] })
    const song = await addSong('Scale.mid')
    let renders = 0
    const { result } = renderHook(() => {
      renders += 1
      return useSongSession(FULL_PIANO)
    })
    play(song.id)
    const { falling } = result.current
    const rendersOnceLoaded = renders

    act(() => vi.advanceTimersByTime(1000))
    expect(renders).toBe(rendersOnceLoaded)
    expect(result.current.falling).toBe(falling)
    expect(falling?.getNotes()).toBe(falling?.getNotes())

    // Nor when a playing song is put somewhere else: the sky draws that by itself, frame by frame.
    act(() => player.seek(0.3))
    expect(renders).toBe(rendersOnceLoaded)
  })

  it('draws the app again when a song that stands still is moved, so that the sky shows the new place at once', async () => {
    const song = await addSong('Scale.mid')
    let renders = 0
    const { result } = renderHook(() => {
      renders += 1
      return useSongSession(FULL_PIANO)
    })
    play(song.id)
    act(() => player.pause())
    const { falling } = result.current

    const rendersOncePaused = renders

    act(() => player.seek(1.5))
    expect(renders).toBe(rendersOncePaused + 1)
    expect(falling?.getPosition()).toBe(1.5)
    act(() => player.seek(0.25))
    expect(renders).toBe(rendersOncePaused + 2)
    // The notes are the same ones, so the sky keeps what it has worked out about them.
    expect(result.current.falling).toBe(falling)

    // Put where it already is, nothing is drawn; "Restart" takes it back to the start.
    act(() => player.seek(0.25))
    expect(renders).toBe(rendersOncePaused + 2)
    act(() => player.stop())
    expect(renders).toBe(rendersOncePaused + 3)
  })

  it('gives the sky a new source with new notes when the options change', async () => {
    const song = await addSong('Duet.mid', { notes: [60, 62] }, { notes: [72, 74] })
    const { result } = session()
    play(song.id)
    const before = result.current.falling

    act(() => changeSongOptions({ melodyOnly: true }))
    expect(result.current.falling).not.toBe(before)
    expect(result.current.falling?.getNotes().map((note) => note.midi)).toEqual([72, 74])
    // The old source still gives the notes it was made with.
    expect(before?.getNotes()).toHaveLength(4)
  })

  it('counts the notes that are off the piano on screen', async () => {
    const song = await addSong('Wide.mid', { notes: [30, 60, 100, 101] })
    const { rerender } = session(FULL_PIANO)
    play(song.id)
    expect(loadedSong().arrangement.offPianoCount).toBe(0)

    rerender(SMALL_PIANO)
    expect(loadedSong().arrangement.offPianoCount).toBe(3)
  })

  it('fits the notes to the piano on screen, and again when that piano changes', async () => {
    const song = await addSong('Wide.mid', { notes: [30, 60, 100] })
    songLibrary.setOptions(song.id, { fitToPiano: true })
    const { rerender } = session(SMALL_PIANO)
    play(song.id)
    expect(pitchesPlayed()).toEqual([54, 60, 76])
    expect(loadedSong().arrangement.offPianoCount).toBe(0)

    rerender({ first: 36, last: 96 })
    expect(pitchesPlayed()).toEqual([42, 60, 88])
  })

  it('keeps the place in the song when the piano on screen changes', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'performance'] })
    const song = await addSong('Long.mid', { notes: [60, 62, 64, 65] })
    const { rerender } = session(FULL_PIANO)
    play(song.id)
    act(() => vi.advanceTimersByTime(900))

    rerender(SMALL_PIANO)
    expect(player.getState().status).toBe('playing')
    expect(player.getPosition()).toBeCloseTo(0.9, 1)
  })

  it('does not load the song again when the app is drawn again with the same piano', async () => {
    const song = await addSong('Scale.mid')
    const { rerender } = session(SMALL_PIANO)
    play(song.id)
    const load = vi.spyOn(player, 'load')

    rerender({ ...SMALL_PIANO })
    expect(load).not.toHaveBeenCalled()
  })

  it('does not load the song again when the app comes back with the same piano', async () => {
    const song = await addSong('Scale.mid')
    session(SMALL_PIANO).unmount()
    play(song.id)
    const load = vi.spyOn(player, 'load')

    session(SMALL_PIANO)
    expect(load).not.toHaveBeenCalled()
  })

  it('arranges a song for the piano that was on screen before the song was loaded', async () => {
    const song = await addSong('Wide.mid', { notes: [30, 60] })
    showPiano(SMALL_PIANO)
    play(song.id)
    expect(loadedSong().arrangement.offPianoCount).toBe(1)
  })

  describe('when the page is hidden', () => {
    function setVisibility(state: 'hidden' | 'visible'): void {
      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(state)
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'))
      })
    }

    it('pauses the song, and leaves it paused when the page is shown again', async () => {
      const song = await addSong('Scale.mid')
      session()
      play(song.id)

      setVisibility('hidden')
      expect(player.getState().status).toBe('paused')
      setVisibility('visible')
      expect(player.getState().status).toBe('paused')
    })

    it('stops watching the page once the app has gone', async () => {
      const song = await addSong('Scale.mid')
      const { unmount } = session()
      unmount()
      play(song.id)

      setVisibility('hidden')
      expect(player.getState().status).toBe('playing')
      act(() => {
        window.dispatchEvent(new Event('pagehide'))
      })
      expect(player.getState().status).toBe('playing')
    })
  })

  describe('when the page is left', () => {
    it('pauses the song, also when the browser does not say that the page is hidden', async () => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'performance'] })
      const song = await addSong('Scale.mid')
      session()
      play(song.id)
      act(() => vi.advanceTimersByTime(LEAD_IN_MS + 100))
      expect(heldNotes()).toEqual([60])

      act(() => {
        window.dispatchEvent(new Event('pagehide'))
      })
      expect(player.getState().status).toBe('paused')
      expect(heldNotes()).toEqual([])
      // The song waits: no note of it starts on the page that was left.
      act(() => vi.advanceTimersByTime(2000))
      expect(heldNotes()).toEqual([])
    })

    function leavePage(): void {
      act(() => {
        window.dispatchEvent(new Event('pagehide'))
      })
    }

    /** What the browser does with a page it kept: it shows it again, as it was left. */
    function comeBackToPage(): void {
      act(() => {
        window.dispatchEvent(new Event('pageshow'))
      })
    }

    function keysAt(): number {
      return settingsStore.get().baseOctave
    }

    /** Where the next visit finds the keys: what is saved in the browser. */
    function savedKeys(): unknown {
      const saved: unknown = JSON.parse(window.localStorage.getItem('pianoapp.settings.v1') ?? '{}')
      return (saved as { baseOctave?: unknown }).baseOctave
    }

    it('gives the computer keys back, so that the next visit, which has no song, finds them where the player had them', async () => {
      const low = await addSong('Low.mid', { notes: [36, 38, 40, 41] })
      session()
      play(low.id)
      expect(savedKeys()).toBe(1)

      leavePage()
      expect(keysAt()).toBe(3)
      expect(savedKeys()).toBe(3)
    })

    it('leaves the keys where the player moved them while the song was loaded', async () => {
      const low = await addSong('Low.mid', { notes: [36, 38, 40, 41] })
      session()
      play(low.id)
      act(() => settingsStore.set({ baseOctave: 2 }))

      leavePage()
      expect(savedKeys()).toBe(2)
    })

    it('takes the keys to the song again when the browser shows the page again, with its song', async () => {
      const low = await addSong('Low.mid', { notes: [36, 38, 40, 41] })
      session()
      play(low.id)

      leavePage()
      comeBackToPage()
      expect(player.getState()).toMatchObject({ status: 'paused', songId: low.id })
      expect(keysAt()).toBe(1)

      // And closing the song still gives them back.
      act(() => closeSong())
      expect(keysAt()).toBe(3)
    })

    it('does not move the keys of a page that comes back when they were not given back', async () => {
      const low = await addSong('Low.mid', { notes: [36, 38, 40, 41] })
      session()
      play(low.id)
      act(() => settingsStore.set({ baseOctave: 2 }))

      leavePage()
      comeBackToPage()
      expect(keysAt()).toBe(2)
    })

    it('stops giving the keys back once the app has gone', async () => {
      const low = await addSong('Low.mid', { notes: [36, 38, 40, 41] })
      const { unmount } = session()
      unmount()
      play(low.id)

      leavePage()
      expect(keysAt()).toBe(1)
    })
  })

  describe('when the app goes away', () => {
    it('pauses the song, which starts no more notes with no screen left to stop it from', async () => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'performance'] })
      const song = await addSong('Scale.mid')
      const { unmount } = session()
      play(song.id)
      act(() => vi.advanceTimersByTime(LEAD_IN_MS + 100))
      expect(heldNotes()).toEqual([60])

      unmount()
      expect(player.getState()).toMatchObject({ status: 'paused', songId: song.id })
      act(() => vi.advanceTimersByTime(2000))
      expect(heldNotes()).toEqual([])
    })

    it('leaves a song alone that is paused or stopped: it stays where it is', async () => {
      const song = await addSong('Scale.mid')
      const { unmount } = session()
      play(song.id)
      act(() => player.pause())
      act(() => player.seek(1))
      const before = player.getState()

      unmount()
      expect(player.getState()).toBe(before)
    })
  })

  it('works the way React draws the app in development', async () => {
    const song = await addSong('Wide.mid', { notes: [30, 60] })
    const { result } = renderHook(() => useSongSession(SMALL_PIANO), { wrapper: StrictMode })
    play(song.id)
    expect(result.current).toMatchObject({ loaded: true, playing: true })
    expect(loadedSong().arrangement.offPianoCount).toBe(1)
  })
})

describe('usePlayerState', () => {
  it('follows the player', async () => {
    const song = await addSong('Scale.mid')
    const { result } = renderHook(() => usePlayerState())
    expect(result.current.status).toBe('empty')

    play(song.id)
    expect(result.current).toMatchObject({ status: 'playing', title: 'Scale' })
    act(() => player.seek(1))
    expect(result.current.position).toBe(1)
  })
})
