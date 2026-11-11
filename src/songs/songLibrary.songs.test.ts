/**
 * The library of saved songs, used the way the app uses it: real MIDI bytes
 * are imported, saved, read back at a "later visit" and arranged. The storage
 * behind it behaves like a browser's: it has a quota that counts keys and
 * values, it can be damaged, and a second tab can be writing to it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { StorageLike } from '../state/settings'
import { arrange } from './arrange'
import { parseMidiFile } from './midiImport'
import { DEFAULT_ARRANGE_OPTIONS, DEFAULT_PLAY_OPTIONS, MAX_TITLE_LENGTH, UNTITLED } from './song'
import type { Song, SongNote } from './song'
import { SongStorageError, createSongLibrary } from './songLibrary'
import type { SongLibrary } from './songLibrary'
import { STARTER_SONGS } from './starterSongs'

const INDEX_KEY = 'pianoapp.songs.v1'
const SONG_KEY_PREFIX = 'pianoapp.song.v1.'
const FULL_SENTENCE = 'There is no room left to save songs. Delete a song and try again.'

/** A stand-in for the browser's storage. Its quota counts what browsers count: keys and values. */
class BrowserStorage implements StorageLike {
  readonly items = new Map<string, string>()
  quota = Number.POSITIVE_INFINITY
  writes = 0

  getItem(key: string): string | null {
    return this.items.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.writes += 1
    const before = this.items.has(key) ? key.length + (this.items.get(key)?.length ?? 0) : 0
    if (this.used() - before + key.length + value.length > this.quota) {
      throw new DOMException('Setting the value exceeded the quota.', 'QuotaExceededError')
    }
    this.items.set(key, String(value))
  }

  removeItem(key: string): void {
    this.items.delete(key)
  }

  used(): number {
    let total = 0
    for (const [key, value] of this.items) total += key.length + value.length
    return total
  }

  snapshot(): Record<string, string> {
    return Object.fromEntries(this.items)
  }

  songKeys(): string[] {
    return [...this.items.keys()].filter((key) => key.startsWith(SONG_KEY_PREFIX)).sort()
  }

  /** The ids the saved index lists. */
  listedIds(): string[] {
    const saved = JSON.parse(
      this.items.get(INDEX_KEY) ?? '{"songs":[]}',
    ) as { songs: { id: string }[] }
    return saved.songs.map((song) => song.id)
  }
}

/* ------------------------------------------------- little MIDI files */

function text(value: string): number[] {
  return Array.from(value, (character) => character.charCodeAt(0))
}

function uint32(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]
}

function variable(value: number): number[] {
  const out = [value & 0x7f]
  for (let rest = value >>> 7; rest > 0; rest >>>= 7) out.unshift((rest & 0x7f) | 0x80)
  return out
}

function track(events: readonly number[]): number[] {
  return [...text('MTrk'), ...uint32(events.length + 4), ...events, 0x00, 0xff, 0x2f, 0x00]
}

/** The name of a track, written as UTF-8 bytes, as most programs write it. */
function trackName(name: string): number[] {
  const bytes = [...new TextEncoder().encode(name)]
  return [0x00, 0xff, 0x03, ...variable(bytes.length), ...bytes]
}

/**
 * A two-part MIDI file made in code: `count` notes for the right hand over a
 * slow left hand, a drum on every beat, at 97 beats a minute so that no time
 * is a round number.
 */
function midiBytes(count: number, name = ''): Uint8Array {
  const right: number[] = [
    ...trackName(name), 0x00, 0xff, 0x51, 0x03, 0x09, 0x70, 0x2f, 0x00, 0xc0, 0x00,
  ]
  for (let index = 0; index < count; index++) {
    const midi = 60 + ((index * 7) % 25)
    right.push(
      ...variable(index === 0 ? 0 : 13),
      0x90,
      midi,
      40 + (index % 80),
      ...variable(107),
      0x80,
      midi,
      0,
    )
  }
  const left: number[] = [...trackName('Left hand'), 0x00, 0xc1, 0x20]
  for (let index = 0; index < Math.ceil(count / 4); index++) {
    const midi = 36 + (index % 12)
    left.push(
      0x00, 0x91, midi, 70, 0x00, 0x99, 36, 100, ...variable(480), 0x81, midi, 0, 0x00, 0x89, 36, 0,
    )
  }
  return Uint8Array.from(
    [...text('MThd'), ...uint32(6), 0, 1, 0, 2, 0x01, 0xe0, ...track(right), ...track(left)],
  )
}

let importedSoFar = 0

/** What importing a file does in the app: a new id every time, even for the same bytes. */
function importSong(count = 40, name = '', fileName = 'tune.mid'): Song {
  importedSoFar += 1
  return parseMidiFile(midiBytes(count, name), fileName, { now: 1_700_000_000_000 + importedSoFar })
}

function ids(library: SongLibrary): string[] {
  return library.list().map((song) => song.id)
}

/** Every listed song has its notes, and no notes are saved that the list does not point at. */
function expectNoLooseEnds(storage: BrowserStorage, library: SongLibrary): void {
  const listed = ids(library)
  expect(storage.listedIds().sort()).toEqual([...listed].sort())
  expect(storage.songKeys()).toEqual(listed.map((id) => SONG_KEY_PREFIX + id).sort())
  for (const id of listed) expect(library.get(id), `song ${id}`).not.toBeNull()
  // A later visit sees exactly the same songs.
  const laterVisit = createSongLibrary(storage)
  expect(laterVisit.list()).toEqual(library.list())
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
  vi.restoreAllMocks()
})

describe('an imported song, saved and read back', () => {
  it('has the same parts and the same notes, each time within half a millisecond', () => {
    const storage = new BrowserStorage()
    const song = importSong(300, 'Étude in C')
    createSongLibrary(storage).add(song)

    const back = createSongLibrary(storage).get(song.id)
    if (back === null) throw new Error('The song did not come back.')
    expect(back.title).toBe('Étude in C')
    expect(back.createdAt).toBe(song.createdAt)
    const facts = (each: Song): unknown[] =>
      each.tracks.map((part) => [part.id, part.name, part.isPercussion, part.program])
    expect(facts(back)).toEqual(facts(song))
    back.tracks.forEach((part, index) => {
      const original = song.tracks[index]?.notes ?? []
      expect(part.notes).toHaveLength(original.length)
      // Saving rounds to whole milliseconds, which can swap two notes that were closer than that.
      const key = (note: SongNote): string => `${note.midi}@${Math.round(note.time * 1000)}`
      const byKey = new Map(original.map((note) => [key(note), note]))
      for (const note of part.notes) {
        const was = byKey.get(key(note))
        if (!was) throw new Error(`A note that was not in the song: ${key(note)}`)
        expect(Math.abs(note.time - was.time)).toBeLessThanOrEqual(0.0005 + 1e-9)
        expect(
          Math.abs(note.time + note.duration - (was.time + was.duration)),
        ).toBeLessThanOrEqual(0.0005 + 1e-9)
        expect(note.velocity).toBeCloseTo(was.velocity, 9)
      }
    })
    expect(Math.abs(back.duration - song.duration)).toBeLessThanOrEqual(0.0005 + 1e-9)
  })

  it('plays the same notes as before it was saved', () => {
    const storage = new BrowserStorage()
    const song = importSong(500)
    createSongLibrary(storage).add(song)
    const back = createSongLibrary(storage).get(song.id)
    if (back === null) throw new Error('The song did not come back.')

    const piano = { first: 21, last: 108 }
    const before = arrange(song, DEFAULT_ARRANGE_OPTIONS, piano)
    const after = arrange(back, DEFAULT_ARRANGE_OPTIONS, piano)
    expect(after.notes.map((note) => note.midi).sort()).toEqual(
      before.notes.map((note) => note.midi).sort(),
    )
    expect(after.duration).toBeCloseTo(before.duration, 2)
  })

  it('is listed twice when the same file is imported twice, and each copy lives on its own', () => {
    const storage = new BrowserStorage()
    const library = createSongLibrary(storage)
    const first = importSong(20, 'Same tune')
    const second = importSong(20, 'Same tune')
    expect(first.id).not.toBe(second.id)
    library.add(first)
    library.add(second)
    expect(library.list().map((song) => song.title)).toEqual(['Same tune', 'Same tune'])

    library.rename(first.id, 'Same tune (slow)')
    library.setOptions(first.id, { speed: 0.5 })
    library.remove(second.id)
    expect(library.list().map((song) => song.title)).toEqual(['Same tune (slow)'])
    expect(library.get(first.id)?.tracks).toHaveLength(3)
    expect(library.getOptions(first.id).speed).toBe(0.5)
    expectNoLooseEnds(storage, library)
  })
})

describe('a storage that fills up', () => {
  /** How much room `count` songs take, measured in a storage with no limit. */
  function roomFor(songs: readonly Song[]): { afterEach: number[]; afterNotesOfLast: number } {
    const storage = new BrowserStorage()
    const library = createSongLibrary(storage)
    const sizes: number[] = []
    let afterNotesOfLast = 0
    for (const song of songs) {
      const before = storage.used()
      library.add(song)
      const notesKey = SONG_KEY_PREFIX + song.id
      afterNotesOfLast = before + notesKey.length + (storage.items.get(notesKey)?.length ?? 0)
      sizes.push(storage.used())
    }
    return { afterEach: sizes, afterNotesOfLast }
  }

  function expectFull(act: () => void): void {
    let thrown: unknown
    try {
      act()
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(SongStorageError)
    expect((thrown as SongStorageError).code).toBe('full')
    expect((thrown as SongStorageError).userMessage).toBe(FULL_SENTENCE)
  }

  it('refuses the song whose notes do not fit, and is exactly as it was', () => {
    const songs = [importSong(50), importSong(50), importSong(50)]
    const room = roomFor(songs)
    const storage = new BrowserStorage()
    storage.quota = (room.afterEach[1] ?? 0) + 20
    const library = createSongLibrary(storage)
    library.add(songs[0] as Song)
    library.add(songs[1] as Song)

    const listBefore = library.list()
    const savedBefore = storage.snapshot()
    const listener = vi.fn()
    library.subscribe(listener)

    expectFull(() => library.add(songs[2] as Song))
    expect(library.list()).toBe(listBefore)
    expect(storage.snapshot()).toEqual(savedBefore)
    expect(listener).not.toHaveBeenCalled()
    expect(library.get((songs[2] as Song).id)).toBeNull()
    expectNoLooseEnds(storage, library)
  })

  it('refuses a song whose notes fit when the list does not, and takes them out again', () => {
    const songs = [importSong(50), importSong(50), importSong(50)]
    const room = roomFor(songs)
    const storage = new BrowserStorage()
    // The notes of the third song go in; the longer list that names it is one character too long.
    storage.quota = (room.afterEach[2] ?? 0) - 1
    expect(storage.quota).toBeGreaterThanOrEqual(room.afterNotesOfLast)
    const library = createSongLibrary(storage)
    library.add(songs[0] as Song)
    library.add(songs[1] as Song)
    const savedBefore = storage.snapshot()

    expectFull(() => library.add(songs[2] as Song))
    expect(storage.snapshot()).toEqual(savedBefore)
    expect(ids(library)).toEqual([(songs[1] as Song).id, (songs[0] as Song).id])
    expectNoLooseEnds(storage, library)
  })

  it('never ends with a list that names a missing song, at any quota', { timeout: 60_000 }, () => {
    const songs = [importSong(12), importSong(30), importSong(5), importSong(18)]
    const { afterEach: sizes } = roomFor(songs)
    const most = sizes[sizes.length - 1] ?? 0
    // Every quota from nothing to everything, in steps small enough to cut every write in two.
    for (let quota = 0; quota <= most + 5; quota += 7) {
      const storage = new BrowserStorage()
      storage.quota = quota
      const library = createSongLibrary(storage)
      let added = 0
      for (const song of songs) {
        try {
          library.add(song)
          added += 1
        } catch (error) {
          expect(error).toBeInstanceOf(SongStorageError)
        }
      }
      expect(ids(library)).toHaveLength(added)
      expectNoLooseEnds(storage, library)
    }
  })

  it('has room again once a song is deleted, as the sentence promises', () => {
    const songs = [importSong(60), importSong(60), importSong(60)]
    const room = roomFor(songs)
    const storage = new BrowserStorage()
    storage.quota = (room.afterEach[1] ?? 0) + 30
    const library = createSongLibrary(storage)
    library.add(songs[0] as Song)
    library.add(songs[1] as Song)
    expectFull(() => library.add(songs[2] as Song))

    library.remove((songs[0] as Song).id)
    library.add(songs[2] as Song)
    expect(ids(library)).toEqual([(songs[2] as Song).id, (songs[1] as Song).id])
    expectNoLooseEnds(storage, library)
  })

  it('renaming, choosing options and deleting never throw when nothing more fits', () => {
    const storage = new BrowserStorage()
    const library = createSongLibrary(storage)
    const song = importSong(30, 'Short')
    const other = importSong(30, 'Other')
    library.add(song)
    library.add(other)
    storage.quota = storage.used()

    library.rename(song.id, 'A much longer name than the one it had before')
    library.setOptions(song.id, { speed: 0.75, melodyOnly: true })
    library.setOptions('starter:ode-to-joy', { speed: 1.25 })
    // The change holds for as long as the page is open.
    expect(
      library.list().find((each) => each.id === song.id)?.title,
    ).toBe('A much longer name than the one it had before')
    expect(library.getOptions(song.id)).toMatchObject({ speed: 0.75, melodyOnly: true })
    expect(library.getOptions('starter:ode-to-joy').speed).toBe(1.25)

    library.remove(other.id)
    expect(ids(library)).toEqual([song.id])
    // Deleting made room: what was changed in memory is now saved too.
    expectNoLooseEnds(storage, library)
    expect(createSongLibrary(storage).getOptions(song.id).speed).toBe(0.75)
  })

  it('says there is no room when the browser refuses every write, and loses nothing it had', () => {
    const storage = new BrowserStorage()
    const library = createSongLibrary(storage)
    const kept = importSong(10, 'Kept')
    library.add(kept)
    storage.quota = 0

    expectFull(() => library.add(importSong(10)))
    expect(ids(library)).toEqual([kept.id])
    expect(library.get(kept.id)?.title).toBe('Kept')
    expectNoLooseEnds(storage, library)
  })
})

describe('a list that is damaged', () => {
  const damaged: [what: string, saved: string][] = [
    ['empty text', ''],
    ['text cut off in the middle', '{"songs":[{"id":"a","title":"A so'],
    ['not a list at all', '"songs"'],
    ['nothing', 'null'],
    ['a number', '42'],
    ['a bare list', '[]'],
    ['songs that are not a list', '{"songs":{"0":{"id":"a"}},"options":[]}'],
    [
      'songs that are not songs',
      '{"songs":[null,1,"x",[],{},{"id":7},{"id":"a"},{"id":"a","title":3}],"options":"none"}',
    ],
    ['a list from some other program', '{"version":2,"items":[{"name":"x"}]}'],
  ]

  for (const [what, saved] of damaged) {
    it(`starts empty and still works: ${what}`, () => {
      const storage = new BrowserStorage()
      storage.items.set(INDEX_KEY, saved)
      const library = createSongLibrary(storage)
      expect(library.list()).toEqual([])

      const song = importSong(10, 'After the damage')
      library.add(song)
      library.setOptions(song.id, { fitToPiano: true })
      expect(
        createSongLibrary(storage).list().map((each) => each.title),
      ).toEqual(['After the damage'])
      expect(createSongLibrary(storage).getOptions(song.id).fitToPiano).toBe(true)
    })
  }

  it('drops a listed song whose notes are gone, cleans the list, and keeps the others', () => {
    const storage = new BrowserStorage()
    const first = createSongLibrary(storage)
    const lost = importSong(10, 'Lost')
    const kept = importSong(10, 'Kept')
    first.add(lost)
    first.add(kept)
    first.setOptions(lost.id, { speed: 0.5 })
    storage.items.delete(SONG_KEY_PREFIX + lost.id)

    const library = createSongLibrary(storage)
    expect(library.list().map((song) => song.title)).toEqual(['Kept'])
    expect(library.get(lost.id)).toBeNull()
    expect(library.getOptions(lost.id)).toBe(DEFAULT_PLAY_OPTIONS)
    expectNoLooseEnds(storage, library)
  })

  it('drops a listed song whose notes are damaged, removes them, and keeps the others', () => {
    const storage = new BrowserStorage()
    const first = createSongLibrary(storage)
    const broken = importSong(10, 'Broken')
    const kept = importSong(10, 'Kept')
    first.add(broken)
    first.add(kept)
    const key = SONG_KEY_PREFIX + broken.id
    storage.items.set(key, (storage.items.get(key) ?? '').slice(0, 40))

    const library = createSongLibrary(storage)
    expect(library.list().map((song) => song.title)).toEqual(['Kept'])
    expect(library.get(kept.id)?.tracks).toHaveLength(3)
    expectNoLooseEnds(storage, library)
  })

  it('does not list notes that no list points at, and a new song may take their place', () => {
    const storage = new BrowserStorage()
    const song = importSong(10)
    createSongLibrary(storage).add(song)
    // The list is lost; the notes are still there.
    storage.items.delete(INDEX_KEY)

    const library = createSongLibrary(storage)
    expect(library.list()).toEqual([])
    expect(library.get(song.id)).toBeNull()
    library.add(song)
    expect(ids(library)).toEqual([song.id])
    expectNoLooseEnds(storage, library)
  })
})

describe('titles', () => {
  const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/

  function titleAfter(rename: string): string {
    const storage = new BrowserStorage()
    const library = createSongLibrary(storage)
    const song = importSong(5, 'Before')
    library.add(song)
    library.rename(song.id, rename)
    const now = library.list()[0]?.title ?? ''
    // The same at a later visit, and in the song itself.
    expect(createSongLibrary(storage).list()[0]?.title).toBe(now)
    expect(library.get(song.id)?.title).toBe(now)
    return now
  }

  it('are cut to 80 characters, however long they come', () => {
    expect(titleAfter('x'.repeat(100_000))).toBe('x'.repeat(MAX_TITLE_LENGTH))
    expect(titleAfter(`${'word '.repeat(40)}`)).toHaveLength(79)
  })

  it('are one line with no control characters in them', () => {
    expect(
      titleAfter('  First\r\nSecond\tThird\u0000\u0007 \u007f\u0085 end  '),
    ).toBe('First Second Third end')
  })

  it('are never empty', () => {
    for (const blank of ['', '   ', '\n\t', '\u0000\u0001']) {
      expect(titleAfter(blank)).toBe(UNTITLED)
    }
  })

  it('keep text that is written from right to left exactly as it was typed', () => {
    for (const title of ['שיר ערש', 'أغنية للبيانو', 'Mix of עברית and English 123']) {
      expect(titleAfter(title)).toBe(title)
    }
  })

  it('keep accents, other alphabets and emoji, and never cut an emoji in half', () => {
    const accents = 'Für Elise – Ludwig van Beethoven'
    expect(titleAfter(accents)).toBe(accents)
    expect(titleAfter('月光 ソナタ 🎹')).toBe('月光 ソナタ 🎹')
    const manyEmoji = titleAfter('🎹'.repeat(200))
    expect(Array.from(manyEmoji)).toHaveLength(MAX_TITLE_LENGTH)
    expect(manyEmoji).not.toMatch(LONE_SURROGATE)
    // 79 letters, then an emoji that just fits, then one that does not.
    const edge = titleAfter(`${'a'.repeat(79)}🎹🎹`)
    expect(edge).toBe(`${'a'.repeat(79)}🎹`)
    expect(edge).not.toMatch(LONE_SURROGATE)
  })

  it('come from the name in the file, tidied the same way', () => {
    const library = createSongLibrary(new BrowserStorage())
    const named = (name: string, fileName = 'from-file.mid'): string => {
      const song = importSong(5, name, fileName)
      library.add(song)
      return library.get(song.id)?.title ?? ''
    }
    // Some programs end a name with a zero byte, or pad it with spaces.
    expect(named('Gymnopédie\u0000')).toBe('Gymnopédie')
    expect(named('   Prelude   in   C   ')).toBe('Prelude in C')
    expect(named('שיר ערש 🎵')).toBe('שיר ערש 🎵')
    expect(named('y'.repeat(300))).toBe('y'.repeat(MAX_TITLE_LENGTH))
    // A name that says nothing: the name of the file is used instead.
    // (A browser gives the name without its folders; they are cut off all the same.)
    expect(named('', 'Music\\My Songs\\lullaby.MID')).toBe('lullaby')
    expect(named('Untitled', 'songs/slow/night_song.midi')).toBe('night_song')
    expect(named('\u0000\u0000', 'waltz.mid')).toBe('waltz')
  })
})

describe('the built-in songs', () => {
  it('are not in the library: there is nothing of theirs to rename or delete', () => {
    const storage = new BrowserStorage()
    const library = createSongLibrary(storage)
    const listener = vi.fn()
    library.subscribe(listener)

    for (const starter of STARTER_SONGS) {
      expect(library.get(starter.id)).toBeNull()
      library.rename(starter.id, 'Mine now')
      library.remove(starter.id)
    }
    expect(library.list()).toEqual([])
    expect(listener).not.toHaveBeenCalled()
    expect(storage.writes).toBe(0)
    // The songs themselves are what they were.
    expect(STARTER_SONGS.map((song) => song.title)).not.toContain('Mine now')
    expect(STARTER_SONGS).toHaveLength(6)
  })

  it('remember their speed and options from one visit to the next', () => {
    const storage = new BrowserStorage()
    const library = createSongLibrary(storage)
    const [first, second] = STARTER_SONGS
    if (!first || !second) throw new Error('No built-in songs.')
    library.setOptions(first.id, { speed: 0.6 })
    library.setOptions(second.id, { melodyOnly: true, fitToPiano: true })

    const laterVisit = createSongLibrary(storage)
    expect(laterVisit.getOptions(first.id)).toEqual({ ...DEFAULT_PLAY_OPTIONS, speed: 0.6 })
    expect(laterVisit.getOptions(second.id)).toEqual(
      { ...DEFAULT_PLAY_OPTIONS, melodyOnly: true, fitToPiano: true },
    )
    expect(laterVisit.list()).toEqual([])
  })

  it('keep their options when every imported song is deleted', () => {
    const storage = new BrowserStorage()
    const library = createSongLibrary(storage)
    const starter = STARTER_SONGS[0]
    if (!starter) throw new Error('No built-in songs.')
    library.setOptions(starter.id, { speed: 1.4 })
    const song = importSong(5)
    library.add(song)
    library.remove(song.id)
    expect(createSongLibrary(storage).getOptions(starter.id).speed).toBe(1.4)
  })

  it('cannot be saved over by options meant for a song that does not exist', () => {
    const library = createSongLibrary(new BrowserStorage())
    library.setOptions('no-such-song', { speed: 0.5 })
    expect(library.getOptions('no-such-song')).toBe(DEFAULT_PLAY_OPTIONS)
  })
})

describe('the app open in two tabs', () => {
  /** A tab: its own copy of the app-wide library, over the storage both tabs share. */
  async function openTab(localStorage: BrowserStorage) {
    const tabWindow = Object.assign(new EventTarget(), { localStorage })
    vi.stubGlobal('window', tabWindow)
    vi.resetModules()
    const { songLibrary: library } = await import('./songLibrary')
    const told = vi.fn()
    library.subscribe(told)
    return {
      library,
      told,
      /** The browser tells this tab what another tab wrote. */
      hear(key: string | null = INDEX_KEY): void {
        tabWindow.dispatchEvent(Object.assign(new Event('storage'), { key }))
      },
    }
  }

  it('neither tab loses a song when each adds, renames and deletes in turn', async () => {
    const storage = new BrowserStorage()
    const one = await openTab(storage)
    const two = await openTab(storage)
    const a = importSong(10, 'From tab one')
    const b = importSong(10, 'From tab two')
    const c = importSong(10, 'Also from tab one')

    one.library.add(a)
    two.hear()
    two.library.add(b)
    one.hear()
    one.library.add(c)
    two.hear()
    expect(ids(one.library)).toEqual([c.id, b.id, a.id])
    expect(ids(two.library)).toEqual([c.id, b.id, a.id])

    two.library.rename(a.id, 'Renamed in tab two')
    one.hear()
    expect(one.library.list().find((song) => song.id === a.id)?.title).toBe('Renamed in tab two')
    expect(one.library.get(a.id)?.title).toBe('Renamed in tab two')

    one.library.remove(b.id)
    two.hear()
    expect(ids(two.library)).toEqual([c.id, a.id])
    expect(two.library.get(b.id)).toBeNull()

    expectNoLooseEnds(storage, one.library)
    expectNoLooseEnds(storage, two.library)
  })

  it('a song deleted in one tab cannot be read in the other, even before it is told', async () => {
    const storage = new BrowserStorage()
    const one = await openTab(storage)
    const two = await openTab(storage)
    const song = importSong(10)
    one.library.add(song)
    two.hear()

    one.library.remove(song.id)
    // Tab two has not been told yet. It has never read the notes, and they are gone.
    expect(two.library.get(song.id)).toBeNull()
    two.hear()
    expect(two.library.list()).toEqual([])
    expect(two.told).toHaveBeenCalledTimes(2)
  })

  it('options chosen in one tab are the options in the other, built-in songs too', async () => {
    const storage = new BrowserStorage()
    const one = await openTab(storage)
    const two = await openTab(storage)
    one.library.setOptions('starter:jingle-bells', { speed: 0.5 })
    two.hear()
    expect(two.library.getOptions('starter:jingle-bells').speed).toBe(0.5)
    expect(two.told).toHaveBeenCalledTimes(1)

    one.library.setOptions('starter:jingle-bells', { speed: 1 })
    two.hear()
    // (A tab has its own copy of the defaults, so they are compared by what they say.)
    expect(two.library.getOptions('starter:jingle-bells')).toEqual(DEFAULT_PLAY_OPTIONS)
  })

  it('a tab told about a change that is no change tells no one and writes nothing', async () => {
    const storage = new BrowserStorage()
    const one = await openTab(storage)
    one.library.add(importSong(10))
    const two = await openTab(storage)
    const list = two.library.list()
    const writes = storage.writes

    two.hear()
    two.hear('pianoapp.settings.v1')
    two.hear(SONG_KEY_PREFIX + 'whatever')
    expect(two.library.list()).toBe(list)
    expect(two.told).not.toHaveBeenCalled()
    expect(storage.writes).toBe(writes)
  })

  it('a tab is empty, and can start again, after the site data is cleared', async () => {
    const storage = new BrowserStorage()
    const one = await openTab(storage)
    const two = await openTab(storage)
    one.library.add(importSong(10))
    one.library.setOptions('starter:ode-to-joy', { speed: 0.5 })
    two.hear()

    storage.items.clear()
    one.hear(null)
    two.hear(null)
    expect(one.library.list()).toEqual([])
    expect(two.library.getOptions('starter:ode-to-joy')).toEqual(DEFAULT_PLAY_OPTIONS)

    const again = importSong(10, 'A new start')
    two.library.add(again)
    one.hear()
    expect(one.library.list().map((song) => song.title)).toEqual(['A new start'])
    expectNoLooseEnds(storage, one.library)
  })
})
