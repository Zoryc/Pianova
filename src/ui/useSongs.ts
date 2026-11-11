/**
 * The glue between the song modules and the screen: which song is in the
 * player and the notes it plays on the piano that is on screen, adding songs
 * from files, and the hooks the components read all of that with.
 */
import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { player, songLibrary } from '../app/songsApp'
import type { PianoRange } from '../core/layout'
import { MIDI_MAX, MIDI_MIN } from '../core/notes'
import { arrange, bestBaseOctave, selectedTracks } from '../songs/arrange'
import { MAX_MIDI_BYTES, SongImportError, parseMidiFile } from '../songs/midiImport'
import type { Arrangement, Song, SongPlayOptions } from '../songs/song'
import { SongStorageError } from '../songs/songLibrary'
import type { PlayerState } from '../songs/songPlayer'
import { STARTER_SONGS, isStarterSong } from '../songs/starterSongs'
import { settingsStore } from '../state/settings'
import type { FallingSource } from './sky/Sky'

// Development only: see the same lines in src/app/pianoApp.ts. A fresh copy of
// this file starts with no song loaded, so the copy before it closes its song.
import.meta.hot?.data.shutDown?.()

/** The song in the player, as it is being played. A new object whenever any of it changes. */
export interface LoadedSong {
  song: Song
  /** Which parts are played, melody only, fit to the piano, and how fast. */
  options: SongPlayOptions
  /** The notes that are played, arranged for the piano on screen. */
  arrangement: Arrangement
}

/** What the app shell needs to know about the song in the player. */
export interface SongSession {
  /** What the sky needs as `falling`: null with no song, a new object whenever the notes change. */
  falling: FallingSource | null
  /** A song is in the player, playing or not. */
  loaded: boolean
  /** The song is moving forward right now. */
  playing: boolean
}

/** One line of the Songs panel's message line. */
export interface SongMessage {
  text: string
  /** True when it says that something could not be done. */
  isProblem: boolean
}

/** Shown when a listed song cannot be played because its saved notes are gone or damaged. */
export const UNREADABLE_SONG_MESSAGE =
  'That song could not be read. Delete it and import the MIDI file again.'

const NO_MESSAGES: readonly SongMessage[] = Object.freeze([])

const loadedSong = createStore<LoadedSong | null>(null)
const messages = createStore(NO_MESSAGES)

/** The piano on screen. A full piano until the stage says which one it shows. */
let pianoOnScreen: PianoRange = { first: MIDI_MIN, last: MIDI_MAX }
/** How many Songs panels are on the page (one, or none). */
let panelsShowingMessages = 0

const stopFollowingLibrary = songLibrary.subscribe(followLibrary)

/**
 * For the app shell, called once with the piano that is on screen. It keeps
 * the loaded song arranged for that piano, pauses the song while the page is
 * hidden, and says what the rest of the screen needs to know about the song.
 */
export function useSongSession(range: PianoRange): SongSession {
  const { first, last } = range
  useEffect(() => arrangeFor({ first, last }), [first, last])
  useEffect(pauseWhenPageIsHidden, [])

  const arrangement = useLoadedSong()?.arrangement ?? null
  const playing = useSyncExternalStore(player.subscribe, isPlaying, isPlaying)
  const falling = useMemo(
    () => (arrangement === null ? null : fallingNotesOf(arrangement)),
    [arrangement],
  )
  return { falling, loaded: arrangement !== null, playing }
}

/** The song in the player, or null. */
export function useLoadedSong(): LoadedSong | null {
  return useSyncExternalStore(loadedSong.subscribe, loadedSong.get, loadedSong.get)
}

/** Where the player stands. A playing song reports its position about ten times a second. */
export function usePlayerState(): PlayerState {
  return useSyncExternalStore(player.subscribe, player.getState, player.getState)
}

/**
 * For the Songs panel: the lines of its message line. They are forgotten when
 * the panel goes away, so that it does not open with old news the next time.
 */
export function useSongMessages(): readonly SongMessage[] {
  useEffect(keepMessagesWhileShown, [])
  return useSyncExternalStore(messages.subscribe, messages.get, messages.get)
}

/**
 * Loads a song into the player and starts it. The computer keys move to where
 * they can play the most of the song. Returns false, and says why in the
 * message line, when the song cannot be read.
 */
export function playSong(id: string): boolean {
  const song = findSong(id)
  if (song === null) {
    messages.set([{ text: UNREADABLE_SONG_MESSAGE, isProblem: true }])
    return false
  }
  const options = usableOptions(song)
  moveKeysToSong(song, options)
  const arrangement = arrange(song, options, pianoOnScreen)

  player.load(song, arrangement)
  // The player keeps its speed from one song to the next: each song brings its own.
  player.setSpeed(options.speed)
  player.play()
  loadedSong.set({ song, options, arrangement })
  return true
}

/** Takes the song out of the player. */
export function closeSong(): void {
  player.unload()
  loadedSong.set(null)
}

/** Changes how the loaded song is played. The choice is saved with that song. */
export function changeSongOptions(patch: Partial<SongPlayOptions>): void {
  const current = loadedSong.get()
  // The library tells `followLibrary`, which hands the change to the player.
  if (current !== null) songLibrary.setOptions(current.song.id, patch)
}

/**
 * Adds each file to the library as a song and reports in the message line.
 * Never rejects: a file that cannot be added becomes a line of the report.
 */
export async function importSongFiles(files: readonly File[]): Promise<void> {
  if (files.length === 0) return
  // Emptied first, so that the same report twice in a row is still announced as news.
  messages.set(NO_MESSAGES)
  const results: ImportResult[] = []
  for (const file of files) results.push(await addSongFromFile(file))
  messages.set(reportOf(results))
}

/** What became of one imported file: the title of the new song, or why there is none. */
type ImportResult = { fileName: string; title: string } | { fileName: string; problem: string }

async function addSongFromFile(file: File): Promise<ImportResult> {
  try {
    // Checked before reading: a huge file is never loaded into memory.
    if (file.size > MAX_MIDI_BYTES) throw new SongImportError('too-big')
    const song = parseMidiFile(new Uint8Array(await file.arrayBuffer()), file.name)
    songLibrary.add(song)
    return { fileName: file.name, title: song.title }
  } catch (error) {
    return { fileName: file.name, problem: sentenceFor(error) }
  }
}

function sentenceFor(error: unknown): string {
  if (error instanceof SongImportError || error instanceof SongStorageError) {
    return error.userMessage
  }
  // The browser could not read the file at all (it was moved meanwhile, or it is a folder).
  return new SongImportError('damaged').userMessage
}

/** How many songs were added, then one line for each file that was not. */
function reportOf(results: readonly ImportResult[]): readonly SongMessage[] {
  const report: SongMessage[] = []
  const titles = results.flatMap((result) => ('title' in result ? [result.title] : []))
  if (titles.length > 0) report.push({ text: addedSentence(titles), isProblem: false })

  const severalFiles = results.length > 1
  for (const result of results) {
    if ('title' in result) continue
    const text = severalFiles ? `${result.fileName}: ${result.problem}` : result.problem
    report.push({ text, isProblem: true })
  }
  return report
}

function addedSentence(titles: readonly string[]): string {
  return titles.length === 1 ? `"${titles[0]}" was added.` : `${titles.length} songs were added.`
}

/** A built-in song or a saved one. Null when there is none, or its saved notes cannot be read. */
function findSong(id: string): Song | null {
  return STARTER_SONGS.find((song) => song.id === id) ?? songLibrary.get(id)
}

/** The options saved for a song. A saved choice of parts that leaves nothing to play is dropped. */
function usableOptions(song: Song): SongPlayOptions {
  const saved = songLibrary.getOptions(song.id)
  if (selectedTracks(song, saved).length > 0) return saved
  songLibrary.setOptions(song.id, { trackIds: 'auto' })
  return songLibrary.getOptions(song.id)
}

function moveKeysToSong(song: Song, options: SongPlayOptions): void {
  const notes = selectedTracks(song, options).flatMap((track) => track.notes)
  const slotsWithAKey = new Set(Object.values(settingsStore.get().bindings))
  settingsStore.set({ baseOctave: bestBaseOctave(notes, slotsWithAKey) })
}

/**
 * The library changed. The loaded song may have new options or a new name,
 * which the player then takes over; or it was deleted, and is closed.
 */
function followLibrary(): void {
  const current = loadedSong.get()
  if (current === null) return
  const song = asListed(current.song)
  if (song === null) {
    closeSong()
    return
  }
  const options = songLibrary.getOptions(song.id)
  if (song === current.song && options === current.options) return
  const arrangement = playSameNotes(options, current.options)
    ? current.arrangement
    : arrange(song, options, pianoOnScreen)
  carryOnWith({ song, options, arrangement })
}

/** The song under the name the library has for it now. Null when the library no longer has it. */
function asListed(song: Song): Song | null {
  if (isStarterSong(song.id)) return song
  const listed = songLibrary.list().find((summary) => summary.id === song.id)
  if (listed === undefined) return null
  return listed.title === song.title ? song : { ...song, title: listed.title }
}

/** True when two sets of options differ in nothing but the speed. */
function playSameNotes(a: SongPlayOptions, b: SongPlayOptions): boolean {
  return (
    a.melodyOnly === b.melodyOnly &&
    a.fitToPiano === b.fitToPiano &&
    sameParts(a.trackIds, b.trackIds)
  )
}

function sameParts(a: SongPlayOptions['trackIds'], b: SongPlayOptions['trackIds']): boolean {
  if (a === 'auto' || b === 'auto') return a === b
  return a.length === b.length && a.every((id, index) => id === b[index])
}

/** The piano on screen changed: the loaded song is arranged again, for the new one. */
function arrangeFor(range: PianoRange): void {
  if (range.first === pianoOnScreen.first && range.last === pianoOnScreen.last) return
  pianoOnScreen = range
  const current = loadedSong.get()
  if (current === null) return
  carryOnWith({ ...current, arrangement: arrange(current.song, current.options, range) })
}

/** Replaces what is loaded with a newer version of the same song, which keeps its place. */
function carryOnWith(next: LoadedSong): void {
  const current = loadedSong.get()
  const sameInPlayer =
    next.arrangement === current?.arrangement && next.song.title === current.song.title
  if (!sameInPlayer) player.load(next.song, next.arrangement, { keepPlace: true })
  player.setSpeed(next.options.speed)
  loadedSong.set(next)
}

function fallingNotesOf(arrangement: Arrangement): FallingSource {
  return { getNotes: () => arrangement.notes, getPosition: player.getPosition, isPlaying }
}

function isPlaying(): boolean {
  return player.getState().status === 'playing'
}

/** Browsers slow down the timers of a hidden page, which would make the song crawl. */
function pauseWhenPageIsHidden(): () => void {
  const pauseIfHidden = (): void => {
    if (document.visibilityState === 'hidden') player.pause()
  }
  document.addEventListener('visibilitychange', pauseIfHidden)
  return () => document.removeEventListener('visibilitychange', pauseIfHidden)
}

function keepMessagesWhileShown(): () => void {
  panelsShowingMessages += 1
  return () => {
    panelsShowingMessages -= 1
    // Looked at a moment later: in development React takes a new panel off the
    // page and puts it straight back, which must not lose a message it came with.
    queueMicrotask(() => {
      if (panelsShowingMessages === 0) messages.set(NO_MESSAGES)
    })
  }
}

/** A value that components can follow with `useSyncExternalStore`. */
interface Store<Value> {
  get(): Value
  /** Listeners are told only when the value is a different one. */
  set(next: Value): void
  subscribe(listener: () => void): () => void
}

function createStore<Value>(initial: Value): Store<Value> {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    get: () => value,
    set(next) {
      if (next === value) return
      value = next
      for (const listener of [...listeners]) listener()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

if (import.meta.hot) {
  const shutDown = (): void => {
    closeSong()
    stopFollowingLibrary()
  }
  import.meta.hot.data.shutDown = shutDown
  import.meta.hot.dispose(shutDown)
}
