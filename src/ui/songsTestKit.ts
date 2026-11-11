/**
 * Shared by the tests of the song screen: tiny MIDI files built in code,
 * stand-ins for the files a player picks or drops, and a clean slate between
 * tests. Not part of the app.
 */
import { act, renderHook } from '@testing-library/react'
import { writeMidi } from 'midi-file'
import type { MidiEvent } from 'midi-file'
import { vi } from 'vitest'
import { songLibrary } from '../app/songsApp'
import type { PianoRange } from '../core/layout'
import { MAX_MIDI_BYTES } from '../songs/midiImport'
import { DEFAULT_PLAY_OPTIONS } from '../songs/song'
import type { SongSummary } from '../songs/song'
import { STARTER_SONGS } from '../songs/starterSongs'
import { settingsStore } from '../state/settings'
import { closeSong, importSongFiles, useSongMessages, useSongSession } from './useSongs'

/** Ticks in one beat. At the speed of a file that sets none, a beat lasts half a second. */
const BEAT = 480

/** How long each note of a test file lasts, in seconds. */
export const NOTE_SECONDS = 0.5

/** The whole piano: what the songs are arranged for until a test shows another one. */
export const FULL_PIANO: PianoRange = { first: 21, last: 108 }

/** The 37 keys from C3 to C6. */
export const SMALL_PIANO: PianoRange = { first: 48, last: 84 }

/** One part of a test file: its notes are played one after the other, half a second each. */
export interface PartSpec {
  notes: readonly number[]
  name?: string
  /** General MIDI number of the instrument (0 is a piano, 40 a violin). */
  program?: number
  /** True for a drum part, which the piano never plays. */
  drums?: boolean
}

/**
 * The bytes of a MIDI file with these parts. A first track without notes or a
 * name comes before them, so the song is named after its file and the parts
 * get the ids 1, 2, 3…
 */
export function midiBytes(...parts: readonly PartSpec[]): Uint8Array {
  const tracks = [[endOfTrack()], ...parts.map(trackOf)]
  const header = { format: 1 as const, numTracks: tracks.length, ticksPerBeat: BEAT }
  return Uint8Array.from(writeMidi({ header, tracks }))
}

function trackOf(part: PartSpec): MidiEvent[] {
  const channel = part.drums ? 9 : 0
  const events: MidiEvent[] = []
  if (part.name !== undefined) {
    events.push({ deltaTime: 0, meta: true, type: 'trackName', text: part.name })
  }
  if (part.program !== undefined) {
    events.push({ deltaTime: 0, type: 'programChange', channel, programNumber: part.program })
  }
  for (const noteNumber of part.notes) {
    events.push({ deltaTime: 0, type: 'noteOn', channel, noteNumber, velocity: 100 })
    events.push({ deltaTime: BEAT, type: 'noteOff', channel, noteNumber, velocity: 0 })
  }
  return [...events, endOfTrack()]
}

function endOfTrack(): MidiEvent {
  return { deltaTime: 0, meta: true, type: 'endOfTrack' }
}

/** A file whose kind of MIDI the app does not read ("format 2"). */
export function unsupportedMidiBytes(): Uint8Array {
  const header = { format: 2 as const, numTracks: 1, ticksPerBeat: BEAT }
  return Uint8Array.from(writeMidi({ header, tracks: [trackOf({ notes: [60] })] }))
}

/** The start of a MIDI file, and nothing after it. */
export function damagedMidiBytes(): Uint8Array {
  return new TextEncoder().encode('MThd')
}

/** A stand-in for a file picked or dropped by the player, which records whether it was read. */
export interface FakeFile extends File {
  arrayBuffer: ReturnType<typeof vi.fn<() => Promise<ArrayBuffer>>>
}

export function fakeFile(name: string, bytes: Uint8Array): FakeFile {
  const arrayBuffer = vi.fn(() => Promise.resolve(Uint8Array.from(bytes).buffer))
  return { name, size: bytes.byteLength, arrayBuffer } as unknown as FakeFile
}

/** A MIDI file with one part, or with the parts given. */
export function songFile(name: string, ...parts: readonly PartSpec[]): FakeFile {
  return fakeFile(name, midiBytes(...(parts.length > 0 ? parts : [{ notes: [60, 62, 64, 65] }])))
}

/** A file that says it is one byte over the limit. Reading it fails the test that tries. */
export function hugeFile(name: string): FakeFile {
  const arrayBuffer = vi.fn(() => Promise.reject(new Error('A file over the limit was read.')))
  return { name, size: MAX_MIDI_BYTES + 1, arrayBuffer } as unknown as FakeFile
}

/** A file the browser cannot read, as when it was moved away after being picked. */
export function unreadableFile(name: string): FakeFile {
  const arrayBuffer = vi.fn(() => Promise.reject(new DOMException('gone', 'NotFoundError')))
  return { name, size: 100, arrayBuffer } as unknown as FakeFile
}

/** Adds a song to the library the way the player does, and returns it as the list shows it. */
export async function addSong(name: string, ...parts: readonly PartSpec[]): Promise<SongSummary> {
  const title = name.replace(/\.mid$/, '')
  await act(() => importSongFiles([songFile(name, ...parts)]))
  const added = songLibrary.list().find((song) => song.title === title)
  if (added === undefined) throw new Error(`"${name}" was not added to the library.`)
  return added
}

/** Tells the song glue which piano is on screen, as the app shell does. */
export function showPiano(range: PianoRange): void {
  renderHook(() => useSongSession(range)).unmount()
}

/** No song in the player, no saved songs or options, default settings, no message, a full piano. */
export async function resetSongs(): Promise<void> {
  act(() => {
    closeSong()
    for (const song of songLibrary.list()) songLibrary.remove(song.id)
    for (const song of STARTER_SONGS) songLibrary.setOptions(song.id, DEFAULT_PLAY_OPTIONS)
    settingsStore.reset()
  })
  window.localStorage.clear()
  showPiano(FULL_PIANO)
  // The messages are forgotten a moment after the last panel that shows them has gone.
  renderHook(() => useSongMessages()).unmount()
  await Promise.resolve()
}
