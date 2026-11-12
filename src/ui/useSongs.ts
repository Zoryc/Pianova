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
import type { Arrangement, Song, SongNote, SongPlayOptions } from '../songs/song'
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
  /**
   * The notes that are played, arranged for the piano on screen. They come
   * later than the song has them when it starts with less than LEAD_IN_SECONDS
   * of silence, and `duration` is longer by as much.
   */
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

/**
 * How long a song is in the player before its first note sounds, at least, in
 * seconds: the time that note needs to be seen falling, so that the player
 * can find its key and play along from the start.
 */
export const LEAD_IN_SECONDS = 2

/** Shown when a listed song cannot be played because its saved notes are gone or damaged. */
export const UNREADABLE_SONG_MESSAGE =
  'That song could not be read. Delete it and import the MIDI file again.'

/** Shown for what the browser cannot hand over: a folder, or a file that was moved meanwhile. */
export const UNREADABLE_FILE_MESSAGE =
  'That could not be read. If it is a folder, open it and drop the MIDI files that are in it.'

const NO_MESSAGES: readonly SongMessage[] = Object.freeze([])

const loadedSong = createStore<LoadedSong | null>(null)
const messages = createStore(NO_MESSAGES)
/** Whether the options of the loaded song are open under the player line. */
const songOptionsOpen = createStore(false)

/** The piano on screen. A full piano until the stage says which one it shows. */
let pianoOnScreen: PianoRange = { first: MIDI_MIN, last: MIDI_MAX }
/** How many Songs panels are on the page (one, or none). */
let panelsShowingMessages = 0
/**
 * Set while the computer keys are where a song put them: where the player had
 * them before that (`from`) and where the song moved them (`to`).
 */
let keysMovedForSong: { from: number; to: number } | null = null
/** How many calls of `importSongFiles` are still reading their files. */
let importsRunning = 0
/** What became of each file of the imports that are running: they share one report. */
let importResults: ImportResult[] = []

const stopFollowingLibrary = songLibrary.subscribe(followLibrary)

/**
 * For the app shell, called once with the piano that is on screen. It keeps
 * the loaded song arranged for that piano, pauses the song while the page is
 * hidden and when the app goes away, gives the computer keys back when the
 * page is left, and says what the rest of the screen needs to know about the
 * song.
 */
export function useSongSession(range: PianoRange): SongSession {
  const { first, last } = range
  useEffect(() => arrangeFor({ first, last }), [first, last])
  useEffect(pauseWhenPageIsHidden, [])
  useEffect(giveKeysBackWhenPageIsLeft, [])
  // Once the app is off the page nothing is left to stop the song with: it must not play on.
  useEffect(() => () => player.pause(), [])

  const arrangement = useLoadedSong()?.arrangement ?? null
  const playing = useSyncExternalStore(player.subscribe, isPlaying, isPlaying)
  // A song that stands still is put somewhere else (the position slider,
  // "Restart"): the screen is drawn again, which shows the sky the new place at once.
  useSyncExternalStore(player.subscribe, placeWhileStill, placeWhileStill)
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

/** For the player line: whether the options of the loaded song are open under it. */
export function useSongOptionsOpen(): boolean {
  return useSyncExternalStore(
    songOptionsOpen.subscribe,
    songOptionsOpen.get,
    songOptionsOpen.get,
  )
}

/** Opens the options of the loaded song under the player line. Nothing opens without a song. */
export function openSongOptions(): void {
  if (loadedSong.get() !== null) songOptionsOpen.set(true)
}

/**
 * Closes the song options. Returns true when they were open, which is how the
 * app shell knows that a press of Escape has been used up here.
 */
export function closeSongOptions(): boolean {
  const wereOpen = songOptionsOpen.get()
  songOptionsOpen.set(false)
  return wereOpen
}

/**
 * Loads a song into the player and starts it. The computer keys move to where
 * they can play the most of the song, until the song is closed. Returns
 * false, and says why in the message line, when the song cannot be read.
 */
export function playSong(id: string): boolean {
  const song = findSong(id)
  if (song === null) {
    messages.set([{ text: UNREADABLE_SONG_MESSAGE, isProblem: true }])
    return false
  }
  const options = usableOptions(song)
  moveKeysToSong(song, options)
  const arrangement = arrangeForPlayer(song, options, pianoOnScreen)

  player.load(song, arrangement)
  // The player keeps its speed from one song to the next: each song brings its own.
  player.setSpeed(options.speed)
  player.play()
  // Every song starts with its options closed.
  songOptionsOpen.set(false)
  loadedSong.set({ song, options, arrangement })
  return true
}

/**
 * Takes the song out of the player. The computer keys go back to where they
 * were before the song moved them.
 */
export function closeSong(): void {
  player.unload()
  songOptionsOpen.set(false)
  loadedSong.set(null)
  putKeysBack()
}

/**
 * Forgets where the computer keys were before the loaded song moved them, so
 * that they stay where they are when the song is closed. For "Reset all
 * settings": nothing from before it may come back afterwards.
 */
export function forgetKeysBeforeSong(): void {
  keysMovedForSong = null
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
 * Files added while others are still being read join the same report.
 */
export async function importSongFiles(files: readonly File[]): Promise<void> {
  if (files.length === 0) return
  if (importsRunning === 0) {
    importResults = []
    // Emptied first, so that the same report twice in a row is still announced as news.
    messages.set(NO_MESSAGES)
  }
  const results = importResults
  importsRunning += 1
  for (const file of files) results.push(await addSongFromFile(file))
  importsRunning -= 1
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
  // The browser could not read it at all (the file was moved meanwhile, or it is a folder).
  return UNREADABLE_FILE_MESSAGE
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

/**
 * Moves the computer keys to where they can play the most of the song, and
 * remembers where the player had them, for when the song is closed.
 */
function moveKeysToSong(song: Song, options: SongPlayOptions): void {
  const { bindings, baseOctave } = settingsStore.get()
  const best = bestBaseOctave(notesToReach(song, options), new Set(Object.values(bindings)))
  // Keys that are still where the song before this one put them go back to
  // where the player had them, not to where that song wanted them.
  const from = keysMovedForSong?.to === baseOctave ? keysMovedForSong.from : baseOctave
  keysMovedForSong = best === from ? null : { from, to: best }
  settingsStore.set({ baseOctave: best })
}

/** The notes the computer keys should be able to play: those of the chosen parts. */
function notesToReach(song: Song, options: SongPlayOptions): readonly SongNote[] {
  if (!options.melodyOnly) return selectedTracks(song, options).flatMap((track) => track.notes)
  // "Melody only" plays one note of each chord, and the keys go where those
  // notes are. "Fit to the piano" is left out: the piano on screen follows the
  // keys, so the keys cannot be chosen by it.
  return arrange(song, { ...options, fitToPiano: false }, pianoOnScreen).notes
}

/**
 * Puts the computer keys back where the player had them, unless they were
 * moved since. Returns true when that moved them.
 */
function putKeysBack(): boolean {
  const moved = keysMovedForSong
  keysMovedForSong = null
  if (moved === null || settingsStore.get().baseOctave !== moved.to) return false
  settingsStore.set({ baseOctave: moved.from })
  return true
}

/** The notes to play for a song on the piano on screen, after the song's lead-in. */
function arrangeForPlayer(song: Song, options: SongPlayOptions, range: PianoRange): Arrangement {
  return arrange(startingLater(song, leadInOf(song)), options, range)
}

/**
 * How much later than written a song is played, in seconds: what it takes for
 * its first note to come LEAD_IN_SECONDS after the start. Every part the piano
 * can play counts, chosen or not, so that the notes do not jump in time when
 * parts are switched on and off.
 */
function leadInOf(song: Song): number {
  let firstNoteAt = Infinity
  for (const track of song.tracks) {
    // The notes of a part are in time order: the first one is the earliest.
    const earliest = track.notes[0]
    if (!track.isPercussion && earliest !== undefined) {
      firstNoteAt = Math.min(firstNoteAt, earliest.time)
    }
  }
  return Math.max(0, LEAD_IN_SECONDS - firstNoteAt)
}

/** A copy of the song with every note `seconds` later. The song itself is not changed. */
function startingLater(song: Song, seconds: number): Song {
  if (seconds === 0) return song
  const tracks = song.tracks.map((track) => ({
    ...track,
    notes: track.notes.map((note) => ({ ...note, time: note.time + seconds })),
  }))
  return { ...song, tracks }
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
    : arrangeForPlayer(song, options, pianoOnScreen)
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
  const arrangement = arrangeForPlayer(current.song, current.options, range)
  carryOnWith({ ...current, arrangement })
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

/** What `placeWhileStill` gives for a song that plays. No song is ever at this place. */
const ON_THE_MOVE = -1

/**
 * Where the song stands while it is paused or stopped. A song that plays
 * moves all the time and draws itself in the sky frame by frame: it gets one
 * value for every place, so that the screen is not drawn again as it goes.
 */
function placeWhileStill(): number {
  const { status, position } = player.getState()
  return status === 'playing' ? ON_THE_MOVE : position
}

/**
 * Browsers slow down the timers of a hidden page, which would make the song
 * crawl. A page that is being left is treated the same way.
 */
function pauseWhenPageIsHidden(): () => void {
  const pause = (): void => player.pause()
  const pauseIfHidden = (): void => {
    if (document.visibilityState === 'hidden') player.pause()
  }
  window.addEventListener('pagehide', pause)
  document.addEventListener('visibilitychange', pauseIfHidden)
  return () => {
    window.removeEventListener('pagehide', pause)
    document.removeEventListener('visibilitychange', pauseIfHidden)
  }
}

/**
 * The next visit starts with no song, so it must not find the computer keys
 * where a song had put them: a page that is being left (reloaded, closed)
 * gives them back, as closing the song would. A page that the browser kept
 * and shows again still has its song, and the keys go to that song again.
 */
function giveKeysBackWhenPageIsLeft(): () => void {
  /** True from the moment the page is left with the keys given back, until it is shown again. */
  let givenBack = false
  const giveBack = (): void => {
    givenBack = putKeysBack()
  }
  const takeAgain = (): void => {
    const current = loadedSong.get()
    if (givenBack && current !== null) moveKeysToSong(current.song, current.options)
    givenBack = false
  }
  window.addEventListener('pagehide', giveBack)
  window.addEventListener('pageshow', takeAgain)
  return () => {
    window.removeEventListener('pagehide', giveBack)
    window.removeEventListener('pageshow', takeAgain)
  }
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
