import type { Midi } from '../core/types'

/** One note of a song. Times are in seconds from the start of the song, at the song's own speed. */
export interface SongNote {
  midi: Midi
  time: number
  duration: number
  /** 0..1 */
  velocity: number
}

/** One part of a song (a MIDI track, or one channel of a single-track file). */
export interface SongTrack {
  id: number
  /** Name from the file, or '' when it has none. */
  name: string
  /** Drums and other unpitched sounds: never played on the piano. */
  isPercussion: boolean
  /** General MIDI program number 0..127, or null when the file does not say. */
  program: number | null
  /** Sorted by time, then by midi. */
  notes: readonly SongNote[]
}

export interface Song {
  id: string
  title: string
  /** Seconds: when the last note ends. */
  duration: number
  tracks: readonly SongTrack[]
  /** Milliseconds since the epoch. */
  createdAt: number
}

/** What the song list shows, without the notes. */
export interface SongSummary {
  id: string
  title: string
  duration: number
  noteCount: number
  createdAt: number
}

/** How a song is turned into the notes that are played. */
export interface ArrangeOptions {
  /** Ids of the parts to play, or 'auto' = every part that is not percussion. */
  trackIds: readonly number[] | 'auto'
  /** One note at a time: the highest one. */
  melodyOnly: boolean
  /** Move notes that are off the on-screen piano by whole octaves so that they land on it. */
  fitToPiano: boolean
}

/** A note ready to be played. */
export type PlayableNote = SongNote

/** The notes of a song after arranging, ready for the player. */
export interface Arrangement {
  /** Sorted by time, then midi. No two notes of the same pitch overlap. */
  notes: readonly PlayableNote[]
  /** Seconds: when the last note ends (0 when there are no notes). */
  duration: number
  /** How many notes are not on the on-screen piano (always 0 when fitToPiano is on). */
  offPianoCount: number
}

export const DEFAULT_ARRANGE_OPTIONS: ArrangeOptions = Object.freeze({
  trackIds: 'auto',
  melodyOnly: false,
  fitToPiano: false,
})

/** Slowest and fastest a song can be played, where 1 is its own speed. */
export const MIN_SPEED = 0.5
export const MAX_SPEED = 1.5

/** How one song is played: how it is arranged, and how fast. */
export interface SongPlayOptions extends ArrangeOptions {
  /** MIN_SPEED..MAX_SPEED */
  speed: number
}

export const DEFAULT_PLAY_OPTIONS: SongPlayOptions = Object.freeze({
  ...DEFAULT_ARRANGE_OPTIONS,
  speed: 1,
})

export const MAX_TITLE_LENGTH = 80
export const UNTITLED = 'Untitled song'

/** Trims, collapses whitespace, removes control characters, cuts to MAX_TITLE_LENGTH; empty gives UNTITLED. */
export function cleanTitle(raw: string): string {
  const cleaned = String(raw)
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const cut = Array.from(cleaned).slice(0, MAX_TITLE_LENGTH).join('').trim()
  return cut === '' ? UNTITLED : cut
}

/** A file name without its folder and extension, cleaned: "music/fur_elise.mid" gives "fur_elise". */
export function titleFromFileName(fileName: string): string {
  const base = String(fileName).split(/[\\/]/).pop() ?? ''
  return cleanTitle(base.replace(/\.[A-Za-z0-9]{1,5}$/, ''))
}

export function summarize(song: Song): SongSummary {
  let noteCount = 0
  for (const track of song.tracks) noteCount += track.notes.length
  return {
    id: song.id,
    title: song.title,
    duration: song.duration,
    noteCount,
    createdAt: song.createdAt,
  }
}

/** General MIDI instrument families, eight programs each. */
const INSTRUMENT_FAMILIES = [
  'Piano',
  'Chimes',
  'Organ',
  'Guitar',
  'Bass',
  'Strings',
  'Ensemble',
  'Brass',
  'Reed',
  'Flute',
  'Synth lead',
  'Synth pad',
  'Synth effects',
  'World',
  'Percussion',
  'Sound effects',
] as const

/** Plain name of the instrument family of a part: "Piano", "Guitar", "Drums"…, "Instrument" when unknown. */
export function instrumentName(track: SongTrack): string {
  if (track.isPercussion) return 'Drums'
  const { program } = track
  if (program === null || !Number.isInteger(program) || program < 0 || program > 127) {
    return 'Instrument'
  }
  return INSTRUMENT_FAMILIES[Math.floor(program / 8)] ?? 'Instrument'
}

/** "3:07", "0:42", "1:02:15". Never negative, never NaN. */
export function formatDuration(seconds: number): string {
  const total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const rest = String(total % 60).padStart(2, '0')
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`
}
