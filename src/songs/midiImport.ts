import { parseMidi } from 'midi-file'
import type { MidiEvent, MidiHeader } from 'midi-file'
import { MIDI_MAX, MIDI_MIN } from '../core/notes'
import { UNTITLED, cleanTitle, titleFromFileName } from './song'
import type { Song, SongNote, SongTrack } from './song'

/*
 * Turns the bytes of a MIDI file into a Song. midi-file reads the bytes into
 * events; everything musical is worked out here, in six steps (see readSong).
 */

export type SongImportErrorCode = 'not-midi' | 'too-big' | 'no-notes' | 'unsupported' | 'damaged'

const USER_MESSAGES: Readonly<Record<SongImportErrorCode, string>> = {
  'not-midi': 'That file is not a MIDI file. MIDI files usually end in .mid or .midi.',
  'too-big': 'That file is too big. The limit is 5 MB.',
  'no-notes': 'That MIDI file has no notes in it.',
  unsupported: 'That kind of MIDI file is not supported yet.',
  damaged: 'That MIDI file seems to be damaged and could not be read.',
}

export class SongImportError extends Error {
  readonly code: SongImportErrorCode
  /** A plain sentence to show the player. */
  readonly userMessage: string

  constructor(code: SongImportErrorCode) {
    super(USER_MESSAGES[code])
    this.name = 'SongImportError'
    this.code = code
    this.userMessage = USER_MESSAGES[code]
  }
}

export const MAX_MIDI_BYTES = 5 * 1024 * 1024
export const MAX_SONG_NOTES = 50_000

export interface ParseOptions {
  /** Defaults to a random id. */
  id?: string
  /** Defaults to Date.now(). */
  now?: number
}

/** The longest silence left before the first note, in seconds. */
const MAX_LEAD_IN_SECONDS = 1
/** No note is shorter than this, in seconds: one with no length at all would not be heard. */
const MIN_NOTE_SECONDS = 0.03

const CHANNEL_COUNT = 16
/** "Channel 10", counting from 1 as musicians do: drums. */
const PERCUSSION_CHANNEL = 9
/** The controller number of the sustain pedal, and the value from which it counts as down. */
const SUSTAIN_PEDAL = 64
const PEDAL_DOWN_FROM = 64

/** The longest wait between two events that a MIDI file can write down. */
const MAX_DELTA_TICKS = 0x0fffffff
/** 120 beats a minute, the speed of a file that sets none. */
const DEFAULT_MICROSECONDS_PER_BEAT = 500_000
/** 1000 beats a minute. A file that asks for more is held to this, so its notes cannot pile up. */
const MIN_MICROSECONDS_PER_BEAT = 60_000
/** The slowest speed a MIDI file can write down (about 3.6 beats a minute). */
const MAX_MICROSECONDS_PER_BEAT = 0xffffff

/** Throws SongImportError and nothing else, whatever the bytes are. Never hangs. */
export function parseMidiFile(
  bytes: Uint8Array,
  fileName: string,
  options: ParseOptions = {},
): Song {
  try {
    return readSong(bytes, fileName, options)
  } catch (error) {
    // midi-file throws plain strings for bytes it cannot read. Those, and anything else
    // that was not foreseen, mean the same thing to the player: the file is damaged.
    throw error instanceof SongImportError ? error : new SongImportError('damaged')
  }
}

function readSong(bytes: Uint8Array, fileName: string, options: ParseOptions): Song {
  if (bytes.length > MAX_MIDI_BYTES) throw new SongImportError('too-big')
  const start = findMidiStart(bytes)
  if (start < 0) throw new SongImportError('not-midi')

  // A copy, so that it can be changed without touching the bytes that were handed in.
  const midiBytes = new ForwardOnlyBytes(bytes.subarray(start))
  blankEmptySequenceNumbers(midiBytes)
  const file = parseMidi(midiBytes)
  const ticksPerBeat = ticksPerBeatOf(file.header)
  const score = readScore(file.tracks)
  const notes = pairNotes(score)
  const tempoMap = buildTempoMap(score.tempoChanges, ticksPerBeat)
  const parts = buildParts(notes, score.tracks, tempoMap)
  if (parts.every((part) => part.isPercussion)) throw new SongImportError('no-notes')

  const tracks = trimSilentStart(parts)
  return {
    id: options.id ?? randomId(),
    title: songTitle(score.tracks, fileName),
    duration: endOfLastNote(tracks),
    tracks,
    createdAt: options.now ?? Date.now(),
  }
}

/*
 * Step 1: from bytes to events. midi-file does the reading; this part only
 * makes sure it is given something it can finish, and smooths over the one
 * harmless oddity of real files that it refuses.
 */

/**
 * Where the MIDI data starts: at the very beginning, or further in when the
 * file is wrapped in a RIFF container (an "RMID" file). -1 when it is not a MIDI file.
 */
function findMidiStart(bytes: Uint8Array): number {
  if (hasTextAt(bytes, 'MThd', 0)) return 0
  if (!hasTextAt(bytes, 'RIFF', 0) || !hasTextAt(bytes, 'RMID', 8)) return -1
  for (let at = 12; at + 4 <= bytes.length; at++) {
    if (hasTextAt(bytes, 'MThd', at)) return at
  }
  return -1
}

function hasTextAt(bytes: Uint8Array, text: string, at: number): boolean {
  for (let index = 0; index < text.length; index++) {
    if (bytes[at + index] !== text.charCodeAt(index)) return false
  }
  return true
}

/**
 * The bytes handed to midi-file. midi-file believes every length written in
 * the file; a length that overflows into a negative number sends it backwards
 * through the file, where it can read the same bytes again for ever. It takes
 * each run of bytes with `slice`, so a slice that would go backwards is
 * refused here. (A slice of these bytes is of this class too, so the bytes of
 * each track are protected in the same way.)
 */
class ForwardOnlyBytes extends Uint8Array {
  override slice(start = 0, end = this.length): Uint8Array<ArrayBuffer> {
    // Written this way round so that a length that is not a number at all is refused too.
    if (!(start <= end)) throw new SongImportError('damaged')
    return super.slice(start, end)
  }
}

/** Every chunk of a MIDI file (the header, each track) starts with four letters and its length. */
const CHUNK_HEADER_BYTES = 8
/** A wait of zero, then a "sequence number" event (FF 00) that says it holds zero bytes. */
const EMPTY_SEQUENCE_NUMBER = [0x00, 0xff, 0x00, 0x00]
/** A wait of zero, then a "text" event (FF 01) that holds zero bytes. */
const EMPTY_TEXT = [0x00, 0xff, 0x01, 0x00]

/**
 * A track may begin with a "sequence number" event. Some programs write it
 * without the number, and midi-file refuses the whole file for that. The app
 * has no use for the number, so such an event is turned into an empty piece of
 * text, which midi-file reads and the importer passes over.
 */
function blankEmptySequenceNumbers(bytes: Uint8Array): void {
  let at = 0
  while (at + CHUNK_HEADER_BYTES <= bytes.length) {
    const length = uint32At(bytes, at + 4)
    const data = at + CHUNK_HEADER_BYTES
    if (hasTextAt(bytes, 'MTrk', at) && startsWithEmptySequenceNumber(bytes, data, length)) {
      bytes.set(EMPTY_TEXT, data)
    }
    // Always forwards, by eight bytes at least: the walk ends whatever lengths the file claims.
    at = data + length
  }
}

/** True when the `length` bytes of a track that start at `at` begin with that event, whole. */
function startsWithEmptySequenceNumber(bytes: Uint8Array, at: number, length: number): boolean {
  return (
    length >= EMPTY_SEQUENCE_NUMBER.length &&
    EMPTY_SEQUENCE_NUMBER.every((byte, index) => bytes[at + index] === byte)
  )
}

/** The four bytes at `at` as one number, never negative. */
function uint32At(bytes: Uint8Array, at: number): number {
  let value = 0
  for (let index = 0; index < 4; index++) value = value * 256 + (bytes[at + index] ?? 0)
  return value
}

/** How many ticks make one beat, once the file is known to be of a kind this app reads. */
function ticksPerBeatOf(header: MidiHeader): number {
  const format = wholeNumber(header.format, 0, 2)
  const countsInFilmFrames = header.framesPerSecond !== undefined
  if (format === 2 || countsInFilmFrames) throw new SongImportError('unsupported')
  return wholeNumber(header.ticksPerBeat, 1, 0x7fff)
}

/** `value`, when it is a whole number from `min` to `max`. Anything else: the file is damaged. */
function wholeNumber(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new SongImportError('damaged')
  }
  return value
}

/*
 * Step 2: from events to what the song needs of them, with every time counted
 * in ticks from the start of the song.
 */

/** A key going down, a key coming up, or the sustain pedal moving. */
type Action =
  | { kind: 'press'; tick: number; track: number; channel: number; midi: number; velocity: number }
  | { kind: 'release'; tick: number; track: number; channel: number; midi: number }
  | { kind: 'pedal'; tick: number; channel: number; down: boolean }

interface TempoChange {
  tick: number
  microsecondsPerBeat: number
}

/** What is kept of one track of the file, besides its notes. */
interface TrackFacts {
  /** '' when the track has no name. */
  name: string
  /** True when the track plays at least one note the piano has. */
  hasNotes: boolean
  /** When the last event of the track happens. */
  endTick: number
  /** Channel -> the first instrument the track chooses for it. */
  programs: Map<number, number>
}

interface Score {
  /** Of all tracks together, in time order. */
  actions: Action[]
  /** Of all tracks together, in time order: a tempo change applies to every track. */
  tempoChanges: TempoChange[]
  /** One entry per track of the file, in file order. */
  tracks: TrackFacts[]
}

function readScore(tracks: readonly (readonly MidiEvent[])[]): Score {
  const score: Score = { actions: [], tempoChanges: [], tracks: [] }
  for (const [track, events] of tracks.entries()) {
    score.tracks.push(readTrack(events, track, score))
  }
  // The tracks play together. Sorting is stable, so events at the same tick stay in file order.
  score.actions.sort(byTick)
  score.tempoChanges.sort(byTick)
  return score
}

function byTick(a: { tick: number }, b: { tick: number }): number {
  return a.tick - b.tick
}

/** Adds the actions and tempo changes of one track to `score`; returns the rest of what it says. */
function readTrack(events: readonly MidiEvent[], track: number, score: Score): TrackFacts {
  const facts: TrackFacts = { name: '', hasNotes: false, endTick: 0, programs: new Map() }
  let tick = 0
  for (const event of events) {
    tick += wholeNumber(event.deltaTime, 0, MAX_DELTA_TICKS)
    switch (event.type) {
      case 'noteOn':
      case 'noteOff': {
        const channel = channelOf(event)
        const midi = wholeNumber(event.noteNumber, 0, 127)
        const velocity = wholeNumber(event.velocity, 0, 127)
        if (midi < MIDI_MIN || midi > MIDI_MAX) break
        // A "note on" with no force at all is how many files write a note off. (midi-file
        // already reports it as one; checking here keeps the rule from depending on that.)
        if (event.type === 'noteOn' && velocity > 0) {
          facts.hasNotes = true
          score.actions.push({ kind: 'press', tick, track, channel, midi, velocity })
        } else {
          score.actions.push({ kind: 'release', tick, track, channel, midi })
        }
        break
      }
      case 'controller': {
        if (event.controllerType !== SUSTAIN_PEDAL) break
        const down = wholeNumber(event.value, 0, 127) >= PEDAL_DOWN_FROM
        score.actions.push({ kind: 'pedal', tick, channel: channelOf(event), down })
        break
      }
      case 'programChange': {
        const channel = channelOf(event)
        const program = wholeNumber(event.programNumber, 0, 127)
        if (!facts.programs.has(channel)) facts.programs.set(channel, program)
        break
      }
      case 'setTempo': {
        const asked = wholeNumber(event.microsecondsPerBeat, 0, MAX_MICROSECONDS_PER_BEAT)
        // A tempo of 0 would stop time: it is not believed, and the tempo stays as it was.
        if (asked === 0) break
        const microsecondsPerBeat = Math.max(asked, MIN_MICROSECONDS_PER_BEAT)
        score.tempoChanges.push({ tick, microsecondsPerBeat })
        break
      }
      case 'trackName':
        if (facts.name === '') facts.name = cleanName(event.text)
        break
    }
  }
  facts.endTick = tick
  return facts
}

function channelOf(event: { channel: number }): number {
  return wholeNumber(event.channel, 0, CHANNEL_COUNT - 1)
}

/** A name from the file, tidied; '' when nothing readable is left of it. */
function cleanName(text: unknown): string {
  if (typeof text !== 'string') throw new SongImportError('damaged')
  const name = cleanTitle(decodeText(text))
  return name === UNTITLED ? '' : name
}

/**
 * midi-file reads text as one character per byte. Most programs write names
 * as UTF-8, where "è" takes two bytes, so that is tried first; text that is
 * not UTF-8 is kept as it was read.
 */
function decodeText(text: string): string {
  const bytes = Uint8Array.from(text, (character) => character.charCodeAt(0))
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return text
  }
}

/*
 * Step 3: from key presses, key releases and pedal moves to notes that each
 * have a start and an end.
 */

/** A note while its times are still in ticks. */
interface TickNote {
  track: number
  channel: number
  midi: number
  velocity: number
  startTick: number
  /** STILL_SOUNDING until something ends the note. */
  endTick: number
}

const STILL_SOUNDING = Number.POSITIVE_INFINITY

function pairNotes(score: Score): TickNote[] {
  const sounding = new SoundingNotes()
  for (const action of score.actions) {
    if (action.kind === 'press') sounding.press(action)
    else if (action.kind === 'release') sounding.release(action)
    else sounding.movePedal(action)
  }
  // Whatever nothing has ended (a key never released, a pedal never lifted) ends with its track.
  for (const note of sounding.notes) {
    if (note.endTick === STILL_SOUNDING) {
      note.endTick = score.tracks[note.track]?.endTick ?? note.startTick
    }
  }
  return sounding.notes
}

/** Follows the keys and the pedals through the song, to find where each note stops sounding. */
class SoundingNotes {
  /** Every note found so far, in the order they start. */
  readonly notes: TickNote[] = []
  /** The notes whose key is down, by track, channel and pitch. */
  private readonly held = new Map<number, TickNote>()
  /** The channels whose pedal is down. */
  private readonly pedalsDown = new Set<number>()
  /** The notes whose key is up but which the pedal keeps sounding: channel -> pitch -> notes. */
  private readonly ringing = new Map<number, Map<number, TickNote[]>>()
  /** The keys struck again while still down, until their next release: key -> when that was. */
  private readonly struckAgainAt = new Map<number, number>()

  press(action: Extract<Action, { kind: 'press' }>): void {
    const { tick, track, channel, midi, velocity } = action
    const key = heldKey(track, channel, midi)
    // The same key cannot be down twice: the note it was playing stops where the new one starts.
    const before = this.held.get(key)
    if (before) {
      before.endTick = tick
      this.struckAgainAt.set(key, tick)
    }
    this.stopRinging(channel, midi, tick)

    const note: TickNote = {
      track,
      channel,
      midi,
      velocity,
      startTick: tick,
      endTick: STILL_SOUNDING,
    }
    this.held.set(key, note)
    this.notes.push(note)
    if (this.notes.length > MAX_SONG_NOTES) throw new SongImportError('unsupported')
  }

  release(action: Extract<Action, { kind: 'release' }>): void {
    const key = heldKey(action.track, action.channel, action.midi)
    const note = this.held.get(key)
    // A release with no press before it means nothing.
    if (!note) return
    // Some programs write a repeated note as "new note on, old note off" at the same moment.
    // That release belongs to the note the press has already ended, not to the new one.
    const struckAgainAt = this.struckAgainAt.get(key)
    this.struckAgainAt.delete(key)
    if (struckAgainAt === action.tick) return
    this.held.delete(key)
    if (this.pedalsDown.has(action.channel)) this.keepRinging(note)
    else note.endTick = action.tick
  }

  movePedal(action: Extract<Action, { kind: 'pedal' }>): void {
    if (action.down) {
      this.pedalsDown.add(action.channel)
      return
    }
    this.pedalsDown.delete(action.channel)
    const byPitch = this.ringing.get(action.channel)
    if (!byPitch) return
    for (const notes of byPitch.values()) {
      for (const note of notes) note.endTick = action.tick
    }
    byPitch.clear()
  }

  private keepRinging(note: TickNote): void {
    let byPitch = this.ringing.get(note.channel)
    if (!byPitch) {
      byPitch = new Map()
      this.ringing.set(note.channel, byPitch)
    }
    const notes = byPitch.get(note.midi)
    if (notes) notes.push(note)
    else byPitch.set(note.midi, [note])
  }

  /** A pitch that is played again stops the notes of that pitch the pedal was holding. */
  private stopRinging(channel: number, midi: number, tick: number): void {
    const byPitch = this.ringing.get(channel)
    const notes = byPitch?.get(midi)
    if (!byPitch || !notes) return
    for (const note of notes) note.endTick = tick
    byPitch.delete(midi)
  }
}

function heldKey(track: number, channel: number, midi: number): number {
  return (track * CHANNEL_COUNT + channel) * 128 + midi
}

/*
 * Step 4: from ticks to seconds. How long a tick lasts depends on the tempo,
 * which can change along the song.
 */

/** A stretch of the song during which the tempo does not change. */
interface TempoSpan {
  /** Where the stretch starts, in ticks and in seconds. */
  tick: number
  seconds: number
  secondsPerTick: number
}

function buildTempoMap(changes: readonly TempoChange[], ticksPerBeat: number): TempoSpan[] {
  const secondsPerTick = (microsecondsPerBeat: number) =>
    microsecondsPerBeat / 1_000_000 / ticksPerBeat
  let span: TempoSpan = {
    tick: 0,
    seconds: 0,
    secondsPerTick: secondsPerTick(DEFAULT_MICROSECONDS_PER_BEAT),
  }
  const spans = [span]
  for (const change of changes) {
    span = {
      tick: change.tick,
      seconds: span.seconds + (change.tick - span.tick) * span.secondsPerTick,
      secondsPerTick: secondsPerTick(change.microsecondsPerBeat),
    }
    spans.push(span)
  }
  return spans
}

function secondsAt(spans: readonly TempoSpan[], tick: number): number {
  // Find the last stretch that starts at or before `tick`, halving the search each time.
  // (The last: of two tempo changes at the same moment, the later one is the one that counts.)
  let low = 0
  let high = spans.length - 1
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    const startsAt = spans[middle]?.tick ?? Number.POSITIVE_INFINITY
    if (startsAt <= tick) low = middle
    else high = middle - 1
  }
  const span = spans[low]
  return span ? span.seconds + (tick - span.tick) * span.secondsPerTick : 0
}

/*
 * Step 5: from notes to the parts of the song.
 */

/**
 * One part per track that has notes, with the track's place in the file as
 * its id. A track that plays on several channels (as the only track of a
 * "format 0" file usually does) becomes one part per channel instead; those
 * get ids above every track's, so that no two parts share one.
 */
function buildParts(
  notes: readonly TickNote[],
  tracks: readonly TrackFacts[],
  tempoMap: readonly TempoSpan[],
): SongTrack[] {
  const byTrack: Map<number, SongNote[]>[] = tracks.map(() => new Map())
  for (const note of notes) {
    const byChannel = byTrack[note.track]
    if (!byChannel) continue
    const songNote = toSongNote(note, tempoMap)
    const sameChannel = byChannel.get(note.channel)
    if (sameChannel) sameChannel.push(songNote)
    else byChannel.set(note.channel, [songNote])
  }

  const parts: SongTrack[] = []
  tracks.forEach((facts, track) => {
    const byChannel = byTrack[track]
    if (!byChannel) return
    const isSplit = byChannel.size > 1
    const channels = [...byChannel.keys()].sort((a, b) => a - b)
    for (const channel of channels) {
      parts.push({
        id: isSplit ? tracks.length + track * CHANNEL_COUNT + channel : track,
        name: facts.name,
        isPercussion: channel === PERCUSSION_CHANNEL,
        program: facts.programs.get(channel) ?? null,
        notes: (byChannel.get(channel) ?? []).sort(byTimeThenMidi),
      })
    }
  })
  return parts
}

function toSongNote(note: TickNote, tempoMap: readonly TempoSpan[]): SongNote {
  const time = secondsAt(tempoMap, note.startTick)
  const end = secondsAt(tempoMap, note.endTick)
  return {
    midi: note.midi,
    time,
    duration: Math.max(end - time, MIN_NOTE_SECONDS),
    velocity: note.velocity / 127,
  }
}

function byTimeThenMidi(a: SongNote, b: SongNote): number {
  return a.time - b.time || a.midi - b.midi
}

/*
 * Step 6: the finishing touches.
 */

/**
 * Moves the whole song earlier so that the first note the piano can play
 * comes at most MAX_LEAD_IN_SECONDS after the start. Drum notes from before
 * the new start are left out: drums are never played, and they are what would
 * otherwise make the player wait in silence.
 */
function trimSilentStart(parts: readonly SongTrack[]): readonly SongTrack[] {
  let firstNote = Number.POSITIVE_INFINITY
  for (const part of parts) {
    const first = part.notes[0]
    if (!part.isPercussion && first) firstNote = Math.min(firstNote, first.time)
  }
  const cut = firstNote - MAX_LEAD_IN_SECONDS
  if (cut <= 0) return parts

  return parts
    .map((part) => ({
      ...part,
      notes: part.notes
        .filter((note) => note.time >= cut)
        .map((note) => ({ ...note, time: note.time - cut })),
    }))
    .filter((part) => part.notes.length > 0)
}

function endOfLastNote(parts: readonly SongTrack[]): number {
  let end = 0
  for (const part of parts) {
    for (const note of part.notes) end = Math.max(end, note.time + note.duration)
  }
  return end
}

/** Names that music programs give to a song or a track whose author gave none. */
const PLACEHOLDER_NAMES: ReadonlySet<string> = new Set([
  'untitled',
  'untitled song',
  'unnamed',
  'noname',
  'no name',
  'no title',
  'new song',
  'new sequence',
  'new project',
  'sequence',
  'song',
  'track',
  'midi',
  'midi file',
  'tempo',
  'tempo track',
  'tempo map',
  'conductor',
  'conductor track',
  'master',
  'master track',
  'control track',
  'piano',
  'grand piano',
  'acoustic grand piano',
])

/**
 * The name the file gives the song, or else the name of the file. A file
 * writes the name of its song in its first track. But when that track plays
 * notes next to other tracks, the name is that of a part ("Right hand",
 * "Flute"), and the player would not find the song under it.
 */
function songTitle(tracks: readonly TrackFacts[], fileName: string): string {
  const first = tracks[0]
  const namesTheSong = first !== undefined && (tracks.length === 1 || !first.hasNotes)
  const name = namesTheSong ? first.name : ''
  return name === '' || isPlaceholderName(name) ? titleFromFileName(fileName) : name
}

function isPlaceholderName(name: string): boolean {
  // "Track 1" and "Untitled-2" are as empty of meaning as "Track" and "Untitled".
  const withoutNumber = name.toLowerCase().replace(/[\s_#-]*\d+$/, '')
  return PLACEHOLDER_NAMES.has(withoutNumber)
}

function randomId(): string {
  // randomUUID only exists on pages the browser counts as secure (https, or localhost).
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}
