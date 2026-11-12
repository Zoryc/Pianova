/** MIDI note number. 60 = middle C (C4). A piano spans 21 (A0) to 108 (C8). */
export type Midi = number

/**
 * Where a note came from. Every input produces the same events, so the sound
 * engine, the on-screen piano and (later) the practice/scoring engines never
 * need to know which device was used.
 *
 * - `keyboard`: the computer keyboard
 * - `pointer`:  mouse or touch on the on-screen piano
 * - `midi`, `mic`: a real instrument (future update)
 * - `playback`: the app itself playing a song (and, in a future update, a recording)
 */
export type NoteSource = 'keyboard' | 'pointer' | 'midi' | 'mic' | 'playback'

export interface NoteOnEvent {
  type: 'on'
  midi: Midi
  /** How hard the note was played, 0..1. */
  velocity: number
  source: NoteSource
  /** Milliseconds on the `performance.now()` clock. */
  time: number
}

export interface NoteOffEvent {
  type: 'off'
  midi: Midi
  source: NoteSource
  /** Milliseconds on the `performance.now()` clock. */
  time: number
}

export type NoteEvent = NoteOnEvent | NoteOffEvent
export type NoteListener = (event: NoteEvent) => void

/** What to print on the on-screen piano keys. */
export type LabelMode = 'keys' | 'notes' | 'both' | 'none'

/** How note names are written: C D E… or Do Ré Mi… */
export type NoteNaming = 'letters' | 'solfege'

/** How long a note keeps ringing after its key is released. */
export type ReleaseLength = 'short' | 'normal' | 'long'

/** A named colour of light. */
export type AccentName = 'red' | 'amber' | 'blue' | 'green' | 'purple' | 'white'

/** A named colour, a colour of the player's own, or a different colour for every note. */
export type AccentChoice = AccentName | 'custom' | 'rainbow'

/** What is drawn behind the notes. */
export type BackgroundName = 'black' | 'night' | 'stars' | 'aurora'

/** Bars of light filled with colour, or drawn as glowing outlines. */
export type BarStyle = 'solid' | 'neon'

export type SparksLevel = 'off' | 'some' | 'lots'

/** Which letters are printed on the player's keyboard ('auto' = ask the browser). */
export type KeyboardType = 'auto' | 'qwerty' | 'azerty' | 'qwertz'

/** How the piano keys are drawn. */
export type KeyStyle = 'classic' | 'midnight' | 'glass'
