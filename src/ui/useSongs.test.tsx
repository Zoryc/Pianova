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
  UNREADABLE_SONG_MESSAGE,
  changeSongOptions,
  closeSong,
  importSongFiles,
  playSong,
  useLoadedSong,
  usePlayerState,
  useSongMessages,
  useSongSession,
} from './useSongs'
import type { LoadedSong, SongMessage } from './useSongs'

const NOT_MIDI = 'That file is not a MIDI file. MIDI files usually end in .mid or .midi.'
const TOO_BIG = 'That file is too big. The limit is 5 MB.'
const NO_NOTES = 'That MIDI file has no notes in it.'
const UNSUPPORTED = 'That kind of MIDI file is not supported yet.'
const DAMAGED = 'That MIDI file seems to be damaged and could not be read.'
const FULL = 'There is no room left to save songs. Delete a song and try again.'

const TWINKLE = 'starter:twinkle-twinkle-little-star'

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
    ['a file the browser cannot read', unreadableFile('gone.mid'), DAMAGED],
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
    expect(messageLines()).toEqual([`! ${DAMAGED}`])
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
    expect(player.getState().duration).toBeCloseTo(3 * NOTE_SECONDS)
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

  it('leaves the computer keys where they are for every starter song', () => {
    for (const song of STARTER_SONGS) {
      play(song.id)
      expect(settingsStore.get().baseOctave, song.title).toBe(3)
    }
  })

  it('moves the computer keys to where they can play the most of the song', async () => {
    const low = await addSong('Low.mid', { notes: [36, 38, 40, 41] })
    play(low.id)
    expect(settingsStore.get().baseOctave).toBe(1)

    const high = await addSong('High.mid', { notes: [96, 98, 100] })
    play(high.id)
    expect(settingsStore.get().baseOctave).toBe(5)
  })

  it('counts only the piano keys that have a computer key', async () => {
    const song = await addSong('Middle.mid', { notes: [60, 60, 60] })
    act(() => settingsStore.set({ bindings: { KeyA: 0 } }))
    play(song.id)
    // The only key is on the first note of the zone, so the zone starts at middle C.
    expect(settingsStore.get().baseOctave).toBe(4)
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
    act(() => vi.advanceTimersByTime(1200))

    act(() => changeSongOptions({ melodyOnly: true }))
    expect(player.getState().status).toBe('playing')
    expect(player.getPosition()).toBeCloseTo(1.2, 1)
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
    act(() => vi.advanceTimersByTime(100))
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
    act(() => vi.advanceTimersByTime(100))
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
