import { useSyncExternalStore } from 'react'
import { MIDI_MAX, MIDI_MIN } from '../core/notes'
import type { StorageLike } from '../state/settings'
import {
  DEFAULT_PLAY_OPTIONS,
  MAX_SPEED,
  MAX_TITLE_LENGTH,
  MIN_SPEED,
  cleanTitle,
  summarize,
} from './song'
import type { Song, SongNote, SongPlayOptions, SongSummary, SongTrack } from './song'

export { DEFAULT_PLAY_OPTIONS, MAX_SPEED, MIN_SPEED } from './song'
export type { SongPlayOptions } from './song'

export type SongStorageErrorCode = 'full'

const STORAGE_MESSAGES: Readonly<Record<SongStorageErrorCode, string>> = {
  full: 'There is no room left to save songs. Delete a song and try again.',
}

export class SongStorageError extends Error {
  readonly code: SongStorageErrorCode
  /** A plain sentence to show the player. */
  readonly userMessage: string

  constructor(code: SongStorageErrorCode) {
    super(STORAGE_MESSAGES[code])
    this.name = 'SongStorageError'
    this.code = code
    this.userMessage = STORAGE_MESSAGES[code]
  }
}

export interface SongLibrary {
  /** Newest first. Same array reference until something changes. */
  list(): readonly SongSummary[]
  /** The full song, or null when it does not exist or its stored data is unreadable. */
  get(id: string): Song | null
  /** The saved options for a song (defaults when none are saved or the song is unknown). */
  getOptions(id: string): SongPlayOptions
  /**
   * Saves a song. Throws SongStorageError('full') when the browser refuses;
   * the library is then unchanged.
   */
  add(song: Song): void
  rename(id: string, title: string): void
  remove(id: string): void
  setOptions(id: string, patch: Partial<SongPlayOptions>): void
  subscribe(listener: () => void): () => void
}

/*
 * What is kept in storage:
 * - one entry, INDEX_KEY, with the list of songs (what the song list shows)
 *   and the options chosen for each song;
 * - one entry per song, SONG_KEY_PREFIX followed by the song's id, with its
 *   notes written as short lists of whole numbers (see StoredNote).
 * A song's notes are written once and never change; renaming a song or
 * changing its options only rewrites the small index.
 */
const INDEX_KEY = 'pianoapp.songs.v1'
const SONG_KEY_PREFIX = 'pianoapp.song.v1.'

/** Ids of the built-in songs start with this. They are not saved here, but their options are. */
const STARTER_ID_PREFIX = 'starter:'

const MS_PER_SECOND = 1000
/**
 * No saved note starts or ends later than a day into its song: this keeps
 * every saved time a small whole number.
 */
const MAX_SONG_MS = 24 * 60 * 60 * MS_PER_SECOND
/** How hard a note is played is saved as a whole number from 0 to this. */
const MAX_LOUDNESS = 127
const MAX_PROGRAM = 127
/** The last moment a date can hold, in milliseconds since the epoch. */
const LATEST_DATE = 8.64e15
/** A title read from storage is cut to this before it is cleaned: it could be any length. */
const LONGEST_SAVED_TITLE = 1000

/**
 * One note as it is saved, in whole numbers: the pitch, the milliseconds
 * since the previous note of the part started, the length in milliseconds and
 * how hard it is played (0..MAX_LOUDNESS).
 */
type StoredNote = [midi: number, sinceLast: number, length: number, loudness: number]

/** One part as it is saved. */
interface StoredTrack {
  id: number
  name: string
  percussion: boolean
  program: number | null
  notes: StoredNote[]
}

/** What the library holds in memory. Never changed in place: every change makes a new one. */
interface LibraryState {
  /** Newest first. */
  readonly songs: readonly SongSummary[]
  /** Song id -> its options. Songs played with the default options are not in here. */
  readonly options: ReadonlyMap<string, SongPlayOptions>
}

const EMPTY_STATE: LibraryState = { songs: Object.freeze([]), options: new Map() }

/** `storage` null/undefined → in memory only (songs last until the page is closed). */
export function createSongLibrary(storage?: StorageLike | null): SongLibrary {
  return createLibrary(storage).library
}

/** A library, plus the one extra thing the app-wide library needs (see `followOtherTabs`). */
interface LibraryAndReload {
  library: SongLibrary
  /** Reads the saved list and options again. Listeners are told when that changed something. */
  reloadFromStorage(): void
}

function createLibrary(given: StorageLike | null | undefined): LibraryAndReload {
  // With no storage, songs are kept in the same compact form in memory.
  const storage = given ?? createMemoryStorage()
  let state = loadState(storage, EMPTY_STATE)
  /** The song `get` read last: the same song is usually asked for again. */
  let lastRead: { summary: SongSummary; song: Song } | null = null
  const listeners = new Set<() => void>()

  function notify(): void {
    for (const listener of [...listeners]) {
      try {
        listener()
      } catch (error) {
        // One broken listener must not stop the others from hearing about the change.
        console.error('[songLibrary] listener failed', error)
      }
    }
  }

  /** Makes `next` the current state and saves the index. A change that cannot be saved still holds. */
  function change(next: LibraryState): void {
    state = next
    saveIndex(storage, state)
    notify()
  }

  const library: SongLibrary = {
    list: () => state.songs,

    get(id) {
      const summary = findSong(state, id)
      if (!summary) return null
      // A renamed or replaced song has a new summary object, so this never gives an old copy.
      if (lastRead?.summary === summary) return lastRead.song
      const tracks = readTracks(storage, id)
      if (!tracks) return null
      const song = songOf(summary, tracks)
      lastRead = { summary, song }
      return song
    },

    getOptions: (id) => state.options.get(id) ?? DEFAULT_PLAY_OPTIONS,

    add(song) {
      const stored = packTracks(song.tracks)
      // The list shows the song as it will be read back, not as it was given:
      // its times are now whole milliseconds.
      const header = {
        id: song.id,
        title: cleanTitle(song.title),
        createdAt: cleanDate(song.createdAt) ?? 0,
      }
      const summary = Object.freeze(summarize(songOf(header, unpackTracks(stored))))
      const others = state.songs.filter((other) => other.id !== song.id)
      const next = { ...state, songs: newestFirst([summary, ...others]) }

      writeSongAndIndex(storage, song.id, stored, next)
      state = next
      notify()
    },

    rename(id, title) {
      const song = findSong(state, id)
      const cleaned = cleanTitle(title)
      if (!song || song.title === cleaned) return
      const renamed = Object.freeze({ ...song, title: cleaned })
      const songs = state.songs.map((other) => (other === song ? renamed : other))
      change({ ...state, songs: Object.freeze(songs) })
    },

    remove(id) {
      if (!findSong(state, id)) return
      const options = new Map(state.options)
      options.delete(id)
      // The notes go first. Should the page close between the two steps, the
      // next visit finds a song without notes and drops it; the other way
      // round would leave notes that nothing points at, there for ever.
      removeText(storage, songKey(id))
      change({ songs: Object.freeze(state.songs.filter((song) => song.id !== id)), options })
    },

    setOptions(id, patch) {
      if (!findSong(state, id) && !isStarterId(id)) return
      const current = library.getOptions(id)
      const next = cleanOptions(patch, current)
      if (sameOptions(current, next)) return
      const options = new Map(state.options)
      if (sameOptions(next, DEFAULT_PLAY_OPTIONS)) options.delete(id)
      else options.set(id, next)
      change({ ...state, options })
    },

    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }

  return {
    library,
    reloadFromStorage() {
      const loaded = reuseUnchangedParts(state, loadState(storage, state))
      if (sameState(state, loaded)) return
      state = loaded
      notify()
    },
  }
}

const appLibrary = createLibrary(browserStorage())

/**
 * App-wide singleton over window.localStorage when available.
 * Importing this module must not throw in Node.
 */
export const songLibrary: SongLibrary = appLibrary.library

followOtherTabs(appLibrary.reloadFromStorage)

/** React hook over `songLibrary`: the saved songs, newest first. */
export function useSongList(): readonly SongSummary[] {
  return useSyncExternalStore(songLibrary.subscribe, songLibrary.list, songLibrary.list)
}

/**
 * The browser's storage, or null where there is none (Node, tests) or where
 * the browser refuses access: in some privacy modes merely reading
 * `window.localStorage` throws.
 */
function browserStorage(): StorageLike | null {
  try {
    return typeof window === 'undefined' ? null : (window.localStorage ?? null)
  } catch {
    return null
  }
}

/**
 * Keeps the app-wide library up to date when the app is open in several tabs.
 * Each time one tab saves, the browser sends a `storage` event to the other
 * tabs, and they read the list again. Without this, a tab opened earlier
 * would save its old list at its next change, and the songs added in the
 * other tab would be lost.
 */
function followOtherTabs(reloadFromStorage: () => void): void {
  // Node has no window, and a stand-in window (in tests) may have no events.
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return

  window.addEventListener('storage', (event) => {
    // A key of null means everything the site had saved was cleared at once.
    if (event.key === INDEX_KEY || event.key === null) reloadFromStorage()
  })
}

function createMemoryStorage(): StorageLike {
  const items = new Map<string, string>()
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, value)
    },
    removeItem: (key) => {
      items.delete(key)
    },
  }
}

function songKey(id: string): string {
  return SONG_KEY_PREFIX + id
}

function isStarterId(id: unknown): boolean {
  return typeof id === 'string' && id.startsWith(STARTER_ID_PREFIX)
}

function findSong(state: LibraryState, id: string): SongSummary | undefined {
  return state.songs.find((song) => song.id === id)
}

/** The song made of these parts. Its length is where its last note ends. */
function songOf(
  header: Pick<Song, 'id' | 'title' | 'createdAt'>,
  tracks: readonly SongTrack[],
): Song {
  let duration = 0
  for (const track of tracks) {
    for (const note of track.notes) duration = Math.max(duration, note.time + note.duration)
  }
  return Object.freeze({
    id: header.id,
    title: header.title,
    duration,
    tracks,
    createdAt: header.createdAt,
  })
}

/** Stable, so songs made at the same moment keep the order they were given in. */
function newestFirst(songs: readonly SongSummary[]): readonly SongSummary[] {
  return Object.freeze([...songs].sort((a, b) => b.createdAt - a.createdAt))
}

/*
 * Reading. Nothing that comes out of storage is trusted: it may have been
 * written by another version of the app, by hand, or cut short.
 */

/**
 * Reads the list of songs and their options. An entry that is not what it
 * should be, or whose notes are missing or unreadable, is left out, and is
 * then taken out of storage too, so that it does not come back.
 * `known` is what the library already holds: the notes of a song it has read
 * before are not read again.
 */
function loadState(storage: StorageLike, known: LibraryState): LibraryState {
  const saved = parseJson(readText(storage, INDEX_KEY))
  const savedSongs = listOf(own(saved, 'songs'))
  const savedOptions = listOf(own(saved, 'options'))

  const songs = readSongs(storage, savedSongs, known)
  const options = readOptions(savedOptions, songs)
  const state = { songs: newestFirst([...songs.values()]), options }

  if (songs.size < savedSongs.length || options.size < savedOptions.length) {
    for (const entry of savedSongs) {
      const id = own(entry, 'id')
      if (typeof id === 'string' && !songs.has(id)) removeText(storage, songKey(id))
    }
    saveIndex(storage, state)
  }
  return state
}

/** The readable songs of the saved list, by id. Of two entries with one id, the first counts. */
function readSongs(
  storage: StorageLike,
  entries: readonly unknown[],
  known: LibraryState,
): Map<string, SongSummary> {
  const songs = new Map<string, SongSummary>()
  for (const entry of entries) {
    const summary = readSummary(storage, entry, known)
    if (summary && !songs.has(summary.id)) songs.set(summary.id, summary)
  }
  return songs
}

/**
 * What the song list shows for one saved entry, or null when the entry or the
 * song's notes cannot be used. The length and the number of notes are taken
 * from the notes themselves, never from the entry.
 */
function readSummary(
  storage: StorageLike,
  entry: unknown,
  known: LibraryState,
): SongSummary | null {
  const id = own(entry, 'id')
  const title = own(entry, 'title')
  const createdAt = cleanDate(own(entry, 'createdAt'))
  if (typeof id !== 'string' || typeof title !== 'string' || createdAt === null) return null
  const header = { id, title: cleanTitle(title.slice(0, LONGEST_SAVED_TITLE)), createdAt }

  const before = findSong(known, id)
  if (before) {
    const unchanged = before.title === header.title && before.createdAt === header.createdAt
    return unchanged ? before : Object.freeze({ ...before, ...header })
  }
  const tracks = readTracks(storage, id)
  return tracks && Object.freeze(summarize(songOf(header, tracks)))
}

/** The saved options that belong to a song of the library or to a built-in song, by id. */
function readOptions(
  entries: readonly unknown[],
  songs: ReadonlyMap<string, SongSummary>,
): Map<string, SongPlayOptions> {
  const options = new Map<string, SongPlayOptions>()
  for (const entry of entries) {
    const id = own(entry, 'id')
    if (typeof id !== 'string' || options.has(id)) continue
    if (!songs.has(id) && !isStarterId(id)) continue
    const cleaned = cleanOptions(entry, DEFAULT_PLAY_OPTIONS)
    if (!sameOptions(cleaned, DEFAULT_PLAY_OPTIONS)) options.set(id, cleaned)
  }
  return options
}

/** The parts of a saved song, or null when they are missing or unreadable. */
function readTracks(storage: StorageLike, id: string): readonly SongTrack[] | null {
  const stored = own(parseJson(readText(storage, songKey(id))), 'tracks')
  return isStoredTracks(stored) ? unpackTracks(stored) : null
}

/**
 * Valid options made from `raw` (a patch, or something read from storage):
 * every field that is missing or unusable takes its value from `fallback`.
 * Part ids are kept as given, also ids of parts the song does not have.
 */
function cleanOptions(raw: unknown, fallback: SongPlayOptions): SongPlayOptions {
  const melodyOnly = own(raw, 'melodyOnly')
  const fitToPiano = own(raw, 'fitToPiano')
  const speed = own(raw, 'speed')
  return Object.freeze({
    trackIds: cleanTrackIds(own(raw, 'trackIds'), fallback.trackIds),
    melodyOnly: typeof melodyOnly === 'boolean' ? melodyOnly : fallback.melodyOnly,
    fitToPiano: typeof fitToPiano === 'boolean' ? fitToPiano : fallback.fitToPiano,
    speed: isFiniteNumber(speed) ? Math.min(MAX_SPEED, Math.max(MIN_SPEED, speed)) : fallback.speed,
  })
}

function cleanTrackIds(
  raw: unknown,
  fallback: SongPlayOptions['trackIds'],
): SongPlayOptions['trackIds'] {
  if (raw === 'auto') return 'auto'
  if (!Array.isArray(raw)) return fallback
  const ids = (raw as unknown[]).filter((id): id is number => Number.isSafeInteger(id))
  return Object.freeze([...new Set(ids)])
}

function sameOptions(a: SongPlayOptions, b: SongPlayOptions): boolean {
  return (
    a.melodyOnly === b.melodyOnly &&
    a.fitToPiano === b.fitToPiano &&
    a.speed === b.speed &&
    sameTrackIds(a.trackIds, b.trackIds)
  )
}

function sameTrackIds(a: SongPlayOptions['trackIds'], b: SongPlayOptions['trackIds']): boolean {
  if (a === 'auto' || b === 'auto') return a === b
  return a.length === b.length && a.every((id, index) => id === b[index])
}

/** A moment in milliseconds since the epoch, or null when `raw` is not one. */
function cleanDate(raw: unknown): number | null {
  return isFiniteNumber(raw) ? Math.min(LATEST_DATE, Math.max(0, raw)) : null
}

/**
 * `next`, but pointing at the previous list and option objects where their
 * content did not change. "Nothing changed" can then be spotted with a plain
 * `===`, here and by React.
 */
function reuseUnchangedParts(previous: LibraryState, next: LibraryState): LibraryState {
  const options = new Map<string, SongPlayOptions>()
  for (const [id, value] of next.options) {
    const before = previous.options.get(id)
    options.set(id, before && sameOptions(before, value) ? before : value)
  }
  const sameSongs =
    previous.songs.length === next.songs.length &&
    previous.songs.every((song, index) => song === next.songs[index])
  return { songs: sameSongs ? previous.songs : next.songs, options }
}

function sameState(a: LibraryState, b: LibraryState): boolean {
  return (
    a.songs === b.songs &&
    a.options.size === b.options.size &&
    [...a.options].every(([id, value]) => b.options.get(id) === value)
  )
}

/*
 * Writing.
 */

function serializeIndex(state: LibraryState): string {
  return JSON.stringify({
    songs: state.songs,
    options: [...state.options].map(([id, options]) => ({ id, ...options })),
  })
}

function saveIndex(storage: StorageLike, state: LibraryState): void {
  try {
    storage.setItem(INDEX_KEY, serializeIndex(state))
  } catch {
    // Private browsing or full storage: the change still holds until the page is closed.
  }
}

/**
 * Writes the notes of a song, then the index that lists it. If either cannot
 * be written, what was there before is put back, so the index never points at
 * a song that is not there and no notes are left behind that nothing points at.
 */
function writeSongAndIndex(
  storage: StorageLike,
  id: string,
  tracks: readonly StoredTrack[],
  next: LibraryState,
): void {
  const key = songKey(id)
  const before = readText(storage, key)
  try {
    storage.setItem(key, JSON.stringify({ tracks }))
    storage.setItem(INDEX_KEY, serializeIndex(next))
  } catch {
    if (before === null) removeText(storage, key)
    else writeText(storage, key, before)
    throw new SongStorageError('full')
  }
}

function readText(storage: StorageLike, key: string): string | null {
  try {
    const text = storage.getItem(key)
    return typeof text === 'string' ? text : null
  } catch {
    return null
  }
}

function writeText(storage: StorageLike, key: string, text: string): void {
  try {
    storage.setItem(key, text)
  } catch {
    // Nothing more can be done: the storage refuses to be written to.
  }
}

function removeText(storage: StorageLike, key: string): void {
  try {
    storage.removeItem(key)
  } catch {
    // Nothing more can be done: the storage refuses to be changed.
  }
}

/** The value the text stands for, or undefined when there is no text or it is not JSON. */
function parseJson(text: string | null): unknown {
  if (text === null) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/*
 * The compact form of a song's notes.
 */

/**
 * The parts as they are saved. Part ids are saved as they are; should they be
 * unusable (not whole numbers, or not all different), the parts are numbered
 * 0, 1, 2… instead, so that what is saved can always be read back.
 */
function packTracks(tracks: readonly SongTrack[]): StoredTrack[] {
  const ids = tracks.map((track) => track.id)
  const usable = ids.every((id) => Number.isSafeInteger(id)) && new Set(ids).size === ids.length
  return tracks.map((track, index) => packTrack(track, usable ? track.id : index))
}

function packTrack(track: SongTrack, id: number): StoredTrack {
  const notes: StoredNote[] = []
  let previousStart = 0
  for (const note of track.notes) {
    // The start and the end are rounded, not the start and the length: two
    // notes that touch then still touch, and never come to overlap.
    const start = wholeNumber(note.time * MS_PER_SECOND, previousStart, MAX_SONG_MS - 1)
    const end = wholeNumber((note.time + note.duration) * MS_PER_SECOND, start + 1, MAX_SONG_MS)
    const midi = wholeNumber(note.midi, MIDI_MIN, MIDI_MAX)
    const loudness = wholeNumber(note.velocity * MAX_LOUDNESS, 0, MAX_LOUDNESS)
    notes.push([midi, start - previousStart, end - start, loudness])
    previousStart = start
  }
  return {
    id,
    name: cleanName(track.name),
    percussion: track.isPercussion,
    program: isWholeNumber(track.program, 0, MAX_PROGRAM) ? track.program : null,
    notes,
  }
}

function unpackTracks(stored: readonly StoredTrack[]): readonly SongTrack[] {
  return Object.freeze(stored.map(unpackTrack))
}

function unpackTrack(stored: StoredTrack): SongTrack {
  const notes: SongNote[] = []
  let start = 0
  for (const [midi, sinceLast, length, loudness] of stored.notes) {
    start += sinceLast
    notes.push(
      Object.freeze({
        midi,
        time: start / MS_PER_SECOND,
        duration: length / MS_PER_SECOND,
        velocity: loudness / MAX_LOUDNESS,
      }),
    )
  }
  // Notes that were less than a millisecond apart now start together: put those in pitch order.
  notes.sort((a, b) => a.time - b.time || a.midi - b.midi)
  return Object.freeze({
    id: stored.id,
    name: cleanName(stored.name),
    isPercussion: stored.percussion,
    program: stored.program,
    notes: Object.freeze(notes),
  })
}

/** True when `raw` (read from storage) is a list of parts in the saved form, no two with one id. */
function isStoredTracks(raw: unknown): raw is StoredTrack[] {
  if (!Array.isArray(raw)) return false
  const ids = new Set<number>()
  for (const track of raw as unknown[]) {
    if (!isStoredTrack(track) || ids.has(track.id)) return false
    ids.add(track.id)
  }
  return true
}

function isStoredTrack(raw: unknown): raw is StoredTrack {
  const program = own(raw, 'program')
  return (
    Number.isSafeInteger(own(raw, 'id')) &&
    typeof own(raw, 'name') === 'string' &&
    typeof own(raw, 'percussion') === 'boolean' &&
    (program === null || isWholeNumber(program, 0, MAX_PROGRAM)) &&
    areStoredNotes(own(raw, 'notes'))
  )
}

/** True when `raw` is a list of notes in the saved form that all fit inside MAX_SONG_MS. */
function areStoredNotes(raw: unknown): raw is StoredNote[] {
  if (!Array.isArray(raw)) return false
  let start = 0
  for (const note of raw as unknown[]) {
    if (!isStoredNote(note)) return false
    start += note[1]
    if (start + note[2] > MAX_SONG_MS) return false
  }
  return true
}

function isStoredNote(raw: unknown): raw is StoredNote {
  if (!Array.isArray(raw) || raw.length !== 4) return false
  const [midi, sinceLast, length, loudness] = raw as unknown[]
  return (
    isWholeNumber(midi, MIDI_MIN, MIDI_MAX) &&
    isWholeNumber(sinceLast, 0, MAX_SONG_MS) &&
    isWholeNumber(length, 1, MAX_SONG_MS) &&
    isWholeNumber(loudness, 0, MAX_LOUDNESS)
  )
}

/** A part's name, cut to the length of a title: a name read from storage could be any length. */
function cleanName(name: string): string {
  // The first cut only keeps the second one fast: it never splits a character the second keeps.
  return Array.from(name.slice(0, 2 * MAX_TITLE_LENGTH)).slice(0, MAX_TITLE_LENGTH).join('')
}

/*
 * Small helpers.
 */

/** `raw[key]` when `raw` is an object with that property of its own (never an inherited one). */
function own(raw: unknown, key: string): unknown {
  if (typeof raw !== 'object' || raw === null || !Object.hasOwn(raw, key)) return undefined
  return (raw as Record<string, unknown>)[key]
}

function listOf(raw: unknown): readonly unknown[] {
  return Array.isArray(raw) ? raw : []
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isWholeNumber(value: unknown, min: number, max: number): value is number {
  return Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max
}

/** `value` as a whole number between `min` and `max` (`min` when it is not a number at all). */
function wholeNumber(value: number, min: number, max: number): number {
  const rounded = Math.round(value)
  return Number.isFinite(rounded) ? Math.min(max, Math.max(min, rounded)) : min
}
