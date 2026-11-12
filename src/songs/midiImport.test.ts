import { writeMidi } from 'midi-file'
import type { MidiEvent } from 'midi-file'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_MIDI_BYTES,
  MAX_SONG_NOTES,
  SongImportError,
  parseMidiFile,
} from './midiImport'
import type { SongImportErrorCode } from './midiImport'
import { MAX_TITLE_LENGTH, UNTITLED, cleanTitle } from './song'
import type { Song, SongTrack } from './song'
import { isStarterSong } from './starterSongs'

/*
 * Every file in these tests is built here, in code: either as a list of
 * events written out by midi-file, or byte by byte.
 */

/**
 * midi-file reads the bytes for the importer. A test can put an answer of its
 * own in the place of midi-file's, to check that the importer does not trust
 * what it is handed. While `answer` is null, midi-file answers as usual.
 */
const reader = vi.hoisted(() => ({ answer: null as (() => unknown) | null }))

vi.mock('midi-file', async (importOriginal) => {
  const real = await importOriginal<typeof import('midi-file')>()
  const parseMidi = (data: ArrayLike<number>) =>
    reader.answer ? reader.answer() : real.parseMidi(data)
  return { ...real, parseMidi }
})

/** Ticks in one beat. At the speed of a file that sets none, a beat lasts half a second. */
const BEAT = 480

const MESSAGES: Readonly<Record<SongImportErrorCode, string>> = {
  'not-midi': 'That file is not a MIDI file. MIDI files usually end in .mid or .midi.',
  'too-big': 'That file is too big. The limit is 5 MB.',
  'no-notes': 'That MIDI file has no notes in it.',
  unsupported: 'That kind of MIDI file is not supported yet.',
  damaged: 'That MIDI file seems to be damaged and could not be read.',
}

function on(deltaTime: number, noteNumber: number, velocity = 100, channel = 0): MidiEvent {
  return { deltaTime, type: 'noteOn', channel, noteNumber, velocity }
}

function off(deltaTime: number, noteNumber: number, channel = 0): MidiEvent {
  return { deltaTime, type: 'noteOff', channel, noteNumber, velocity: 0 }
}

function controller(deltaTime: number, control: number, value: number, channel = 0): MidiEvent {
  return { deltaTime, type: 'controller', channel, controllerType: control, value }
}

function pedal(deltaTime: number, value: number, channel = 0): MidiEvent {
  return controller(deltaTime, 64, value, channel)
}

function tempo(deltaTime: number, beatsPerMinute: number): MidiEvent {
  return microsecondsPerBeat(deltaTime, Math.round(60_000_000 / beatsPerMinute))
}

function microsecondsPerBeat(deltaTime: number, value: number): MidiEvent {
  return { deltaTime, meta: true, type: 'setTempo', microsecondsPerBeat: value }
}

function name(text: string): MidiEvent {
  return { deltaTime: 0, meta: true, type: 'trackName', text }
}

function program(programNumber: number, channel = 0): MidiEvent {
  return { deltaTime: 0, type: 'programChange', channel, programNumber }
}

function end(deltaTime = 0): MidiEvent {
  return { deltaTime, meta: true, type: 'endOfTrack' }
}

function midiFile(format: 0 | 1, tracks: MidiEvent[][], ticksPerBeat = BEAT): Uint8Array {
  const header = { format, numTracks: tracks.length, ticksPerBeat }
  return Uint8Array.from(writeMidi({ header, tracks }))
}

/** Joins numbers, lists of numbers and text (one byte per character) into one list of bytes. */
function bytes(...parts: (number | string | readonly number[])[]): number[] {
  return parts.flatMap((part) =>
    typeof part === 'string' ? Array.from(part, (character) => character.charCodeAt(0)) : part,
  )
}

function uint16(value: number): number[] {
  return [(value >>> 8) & 0xff, value & 0xff]
}

function uint32(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]
}

function chunk(id: string, data: readonly number[]): number[] {
  return bytes(id, uint32(data.length), data)
}

function headerChunk(format: number, trackCount: number, division: number): number[] {
  return chunk('MThd', bytes(uint16(format), uint16(trackCount), uint16(division)))
}

/** A whole file with one track, from the bytes of that track's events. */
function oneTrackFile(events: readonly number[], division = BEAT): number[] {
  return bytes(headerChunk(0, 1, division), chunk('MTrk', events))
}

const END_OF_TRACK = [0x00, 0xff, 0x2f, 0x00]

/** Wraps a MIDI file the way an "RMID" file does. */
function riff(midi: readonly number[], formType = 'RMID'): number[] {
  const little = (value: number) => uint32(value).reverse()
  const data = bytes('data', little(midi.length), midi)
  return bytes('RIFF', little(4 + data.length), formType, data)
}

/** Text as the bytes UTF-8 gives it, one character per byte, which is how midi-file writes text. */
function utf8(text: string): string {
  return String.fromCharCode(...new TextEncoder().encode(text))
}

/** Everything that is wrong with a song: an empty list for a song the app can rely on. */
function songProblems(song: Song): string[] {
  const problems: string[] = []
  const check = (ok: boolean, problem: string) => {
    if (!ok) problems.push(problem)
  }
  const isCount = (value: unknown, max: number) =>
    typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max

  check(typeof song.id === 'string' && song.id !== '', 'the id is empty')
  check(typeof song.title === 'string' && cleanTitle(song.title) === song.title, 'untidy title')
  check(Number.isFinite(song.createdAt), 'createdAt is not a number')
  check(song.tracks.some((track) => !track.isPercussion), 'no part the piano can play')
  check(new Set(song.tracks.map((track) => track.id)).size === song.tracks.length, 'shared ids')

  let noteCount = 0
  let lastEnd = 0
  let firstPitched = Number.POSITIVE_INFINITY
  for (const track of song.tracks) {
    check(isCount(track.id, Number.MAX_SAFE_INTEGER), `part id ${track.id}`)
    check(track.name === '' || cleanTitle(track.name) === track.name, 'untidy part name')
    check(typeof track.isPercussion === 'boolean', 'isPercussion is not a boolean')
    check(track.program === null || isCount(track.program, 127), `program ${track.program}`)
    check(track.notes.length > 0, `part ${track.id} has no notes`)
    noteCount += track.notes.length

    let before: { time: number; midi: number } | null = null
    for (const note of track.notes) {
      check(isCount(note.midi, 108) && note.midi >= 21, `pitch ${note.midi}`)
      check(Number.isFinite(note.time) && note.time >= 0, `time ${note.time}`)
      check(Number.isFinite(note.duration) && note.duration >= 0.03, `duration ${note.duration}`)
      check(note.velocity > 0 && note.velocity <= 1, `velocity ${note.velocity}`)
      const inOrder =
        before === null ||
        note.time > before.time ||
        (note.time === before.time && note.midi >= before.midi)
      check(inOrder, `part ${track.id} is not sorted`)
      before = note
      lastEnd = Math.max(lastEnd, note.time + note.duration)
      if (!track.isPercussion) firstPitched = Math.min(firstPitched, note.time)
    }
  }
  check(noteCount <= MAX_SONG_NOTES, `${noteCount} notes`)
  check(song.duration === lastEnd, `duration ${song.duration}, last note ends at ${lastEnd}`)
  check(firstPitched <= 1 + 1e-9, `the first note comes after ${firstPitched} s`)
  return problems
}

/** Imports a file that should be fine, and checks that the song is one the app can rely on. */
function read(file: ArrayLike<number>, fileName = 'test.mid'): Song {
  const song = parseMidiFile(Uint8Array.from(file), fileName, { id: 'test', now: 0 })
  expect(songProblems(song)).toEqual([])
  return song
}

/** The code of the error a file is refused with. */
function refusal(file: ArrayLike<number>, fileName = 'test.mid'): string {
  try {
    parseMidiFile(Uint8Array.from(file), fileName)
  } catch (error) {
    return error instanceof SongImportError ? error.code : `threw something else: ${String(error)}`
  }
  return 'not refused'
}

function partOf(song: Song, index = 0): SongTrack {
  const part = song.tracks[index]
  if (!part) throw new Error(`The song has no part number ${index}.`)
  return part
}

/** The notes of a part as [pitch, start, length], in seconds rounded to a millionth. */
function timings(part: SongTrack): number[][] {
  const round = (seconds: number) => Math.round(seconds * 1_000_000) / 1_000_000
  return part.notes.map((note) => [note.midi, round(note.time), round(note.duration)])
}

describe('SongImportError', () => {
  it('carries a code and a plain sentence for the player', () => {
    for (const code of Object.keys(MESSAGES) as SongImportErrorCode[]) {
      const error = new SongImportError(code)
      expect(error).toBeInstanceOf(Error)
      expect(error.name).toBe('SongImportError')
      expect(error.code).toBe(code)
      expect(error.userMessage).toBe(MESSAGES[code])
    }
  })
})

describe('parseMidiFile: what counts as a MIDI file', () => {
  const song = midiFile(0, [[on(0, 60), off(BEAT, 60), end()]])

  it('has the limits the player is told about', () => {
    expect(MAX_MIDI_BYTES).toBe(5 * 1024 * 1024)
    expect(MAX_SONG_NOTES).toBe(50_000)
  })

  it('refuses a file over the size limit before looking at anything else', () => {
    const tooBig = new Uint8Array(MAX_MIDI_BYTES + 1)
    expect(refusal(tooBig)).toBe('too-big')
    tooBig.set(song)
    expect(refusal(tooBig)).toBe('too-big')
  })

  it('reads a file that is exactly at the size limit', () => {
    const atTheLimit = new Uint8Array(MAX_MIDI_BYTES)
    atTheLimit.set(song)
    expect(timings(partOf(read(atTheLimit)))).toEqual([[60, 0, 0.5]])
  })

  it('refuses anything that does not start as a MIDI file does', () => {
    const notMidi = [
      [],
      [0x4d],
      bytes('MTh'),
      bytes('mthd', uint32(6), uint16(0), uint16(1), uint16(BEAT)),
      bytes('MTrk', uint32(4), END_OF_TRACK),
      bytes('Just some words in a text file.'),
      bytes('ID3', 3, 0, 0, 0, 0, 0, 0),
      bytes(0, Array.from(song)),
    ]
    for (const file of notMidi) expect(refusal(file)).toBe('not-midi')
  })

  it('gives the sentence for the player with the error', () => {
    expect.assertions(2)
    try {
      parseMidiFile(Uint8Array.from(bytes('Not music')), 'words.txt')
    } catch (error) {
      expect(error).toBeInstanceOf(SongImportError)
      expect((error as SongImportError).userMessage).toBe(MESSAGES['not-midi'])
    }
  })

  it('reads a MIDI file wrapped in a RIFF container', () => {
    const wrapped = read(riff(Array.from(song)))
    expect(wrapped).toEqual(read(song))
  })

  it('reads a wrapped file that has other things after the music', () => {
    const withExtras = bytes(riff(Array.from(song)), 'LIST', [4, 0, 0, 0], 'INFO')
    expect(timings(partOf(read(withExtras)))).toEqual([[60, 0, 0.5]])
  })

  it('refuses a RIFF file that holds something other than MIDI', () => {
    expect(refusal(riff(Array.from(song), 'WAVE'))).toBe('not-midi')
    expect(refusal(riff(bytes('no music in here')))).toBe('not-midi')
    expect(refusal(bytes('RIFF'))).toBe('not-midi')
  })

  it('refuses the kinds of MIDI file it does not read yet', () => {
    const track = chunk('MTrk', bytes(0x00, 0x90, 60, 100, 0x60, 0x80, 60, 0, END_OF_TRACK))
    const severalSongsInOne = bytes(headerChunk(2, 1, BEAT), track)
    const timedInFilmFrames = bytes(headerChunk(0, 1, 0xe728), track)

    expect(refusal(severalSongsInOne)).toBe('unsupported')
    expect(refusal(timedInFilmFrames)).toBe('unsupported')
  })

  it('does not change the bytes it is given, and reads a view into a larger buffer', () => {
    const buffer = new Uint8Array(song.length + 20).fill(0xff)
    buffer.set(song, 10)
    const view = buffer.subarray(10, 10 + song.length)
    const before = Array.from(buffer)

    expect(parseMidiFile(view, 'view.mid', { id: 'test', now: 0 })).toEqual(read(song, 'view.mid'))
    expect(Array.from(buffer)).toEqual(before)
  })
})

describe('parseMidiFile: files written byte by byte', () => {
  it('reads a one-track file with running status and two channels', () => {
    const file = bytes(
      'MThd', uint32(6), uint16(0), uint16(1), uint16(96),
      'MTrk', uint32(18),
      0x00, 0x90, 60, 80, // C4 down on the first channel
      0x60, 60, 0, // 96 ticks later, same status: C4 with no force, which lets it go
      0x00, 0x99, 36, 127, // a drum on channel 10
      0x30, 36, 0, // 48 ticks later it stops
      END_OF_TRACK,
    )
    const song = read(file, 'bytes.mid')

    expect(song.title).toBe('bytes')
    expect(song.tracks.map((part) => part.isPercussion)).toEqual([false, true])
    expect(timings(partOf(song, 0))).toEqual([[60, 0, 0.5]])
    expect(partOf(song, 0).notes[0]?.velocity).toBeCloseTo(80 / 127, 10)
    expect(timings(partOf(song, 1))).toEqual([[36, 0.5, 0.25]])
    expect(song.duration).toBeCloseTo(0.75, 10)
  })

  it('reads a two-track file with a name, a tempo and an instrument', () => {
    const conductor = bytes(
      0x00, 0xff, 0x03, 5, 'Suite',
      0x00, 0xff, 0x51, 3, 0x0f, 0x42, 0x40, // 1,000,000 microseconds a beat: 60 beats a minute
      END_OF_TRACK,
    )
    const harp = bytes(
      0x00, 0xff, 0x03, 4, 'Harp',
      0x00, 0xc0, 46,
      0x00, 0x90, 60, 100,
      0x83, 0x60, 0x80, 60, 64, // 480 ticks later
      0x00, 0x90, 64, 100,
      0x81, 0x70, 64, 0, // 240 ticks later, same status, no force
      END_OF_TRACK,
    )
    const file = bytes(headerChunk(1, 2, BEAT), chunk('MTrk', conductor), chunk('MTrk', harp))
    const song = read(file, 'ignored.mid')

    expect(song.title).toBe('Suite')
    expect(song.tracks).toHaveLength(1)
    expect(partOf(song)).toMatchObject({ id: 1, name: 'Harp', isPercussion: false, program: 46 })
    expect(timings(partOf(song))).toEqual([
      [60, 0, 1],
      [64, 1, 0.5],
    ])
  })

  it('accepts a header that is longer than usual and bytes after the last track', () => {
    const file = bytes(
      'MThd', uint32(8), uint16(0), uint16(1), uint16(BEAT), 0, 0,
      chunk('MTrk', bytes(0x00, 0x90, 72, 100, 0x83, 0x60, 0x80, 72, 0, END_OF_TRACK)),
      'and then some more',
    )
    expect(timings(partOf(read(file)))).toEqual([[72, 0, 0.5]])
  })

  it('reads the tracks that are there when the header promises more', () => {
    const track = chunk('MTrk', bytes(0x00, 0x90, 72, 100, 0x83, 0x60, 0x80, 72, 0, END_OF_TRACK))
    expect(timings(partOf(read(bytes(headerChunk(1, 5, BEAT), track))))).toEqual([[72, 0, 0.5]])
  })

  it('reads what is there when the file stops between two events', () => {
    const file = oneTrackFile(bytes(0x00, 0x90, 72, 100, 0x83, 0x60, 0x80, 72, 0, END_OF_TRACK))
    expect(timings(partOf(read(file.slice(0, -END_OF_TRACK.length))))).toEqual([[72, 0, 0.5]])
  })

  describe('a track that begins with a sequence number', () => {
    const note = bytes(0x00, 0x90, 72, 100, 0x83, 0x60, 0x80, 72, 0, END_OF_TRACK)
    /** The event as some programs write it: it says it holds no bytes, where two are usual. */
    const withoutItsNumber = [0x00, 0xff, 0x00, 0x00]

    it('is read when the number is left out', () => {
      const oneTrack = oneTrackFile(bytes(withoutItsNumber, note))
      const twoTracks = bytes(
        headerChunk(1, 2, BEAT),
        chunk('MTrk', bytes(withoutItsNumber, 0x00, 0xff, 0x03, 5, 'Suite', END_OF_TRACK)),
        chunk('MTrk', bytes(withoutItsNumber, note)),
      )

      expect(read(oneTrack)).toEqual(read(oneTrackFile(note)))
      expect(read(riff(oneTrack))).toEqual(read(oneTrackFile(note)))
      expect(read(twoTracks).title).toBe('Suite')
      expect(timings(partOf(read(twoTracks)))).toEqual([[72, 0, 0.5]])
    })

    it('is read when the number is there', () => {
      const file = oneTrackFile(bytes(0x00, 0xff, 0x00, 0x02, 0x00, 0x07, note))
      expect(read(file)).toEqual(read(oneTrackFile(note)))
    })

    it('leaves the bytes it is given as they were', () => {
      const file = oneTrackFile(bytes(withoutItsNumber, note))
      const given = Uint8Array.from(file)

      parseMidiFile(given, 'given.mid')

      expect(Array.from(given)).toEqual(file)
    })

    it('is still refused without its number further into a track, where it does not belong', () => {
      const file = oneTrackFile(bytes(note.slice(0, -END_OF_TRACK.length), withoutItsNumber))
      expect(refusal(file)).toBe('damaged')
    })
  })
})

describe('parseMidiFile: damaged files', () => {
  const note = bytes(0x00, 0x90, 60, 100, 0x83, 0x60, 0x80, 60, 0)

  it('refuses a file that stops in the middle of an event', () => {
    const whole = oneTrackFile(bytes(note, END_OF_TRACK))
    for (const missing of [3, 5, 6, 7, 8]) {
      expect(refusal(whole.slice(0, -missing)), `${missing} bytes short`).toBe('damaged')
    }
  })

  it('refuses a header that is cut short or makes no sense', () => {
    expect(refusal(bytes('MThd'))).toBe('damaged')
    expect(refusal(bytes('MThd', uint32(6), uint16(0)))).toBe('damaged')
    expect(refusal(bytes('MThd', uint32(4), uint16(0), uint16(1)))).toBe('damaged')
    expect(refusal(bytes(headerChunk(3, 1, BEAT), chunk('MTrk', note)))).toBe('damaged')
    expect(refusal(bytes(headerChunk(0, 1, 0), chunk('MTrk', note)))).toBe('damaged')
  })

  it('refuses a track that is not marked as one', () => {
    expect(refusal(bytes(headerChunk(0, 1, BEAT), chunk('MTrx', note)))).toBe('damaged')
    expect(refusal(bytes(headerChunk(0, 1, BEAT), 'garbage where a track should be'))).toBe(
      'damaged',
    )
  })

  it('refuses events that cannot be', () => {
    const impossible = {
      'a pitch above 127': bytes(0x00, 0x90, 200, 100, note),
      'a force above 127': bytes(0x00, 0x90, 60, 0x90, note),
      'a note with no status before it': bytes(0x00, 60, 100, note),
      'a status that does not exist': bytes(0x00, 0xf4, note),
      'a tempo of the wrong size': bytes(0x00, 0xff, 0x51, 2, 0x07, 0xa1, note),
      'an instrument above 127': bytes(0x00, 0xc0, 0xc8, note),
      'a pedal value above 127': bytes(0x00, 0xb0, 64, 0xff, note),
      'a wait longer than a file can write': bytes(0xff, 0xff, 0xff, 0xff, 0x7f, 0x90, 60, 100),
    }
    for (const [what, events] of Object.entries(impossible)) {
      expect(refusal(oneTrackFile(events)), what).toBe('damaged')
    }
  })

  it('refuses, without getting stuck, a length that would send the reader backwards', () => {
    // Read as a length, FF FF FF FF 79 overflows to -7: exactly the size of the event it is in.
    const eventThatPointsAtItself = bytes(0x00, 0xf0, 0xff, 0xff, 0xff, 0xff, 0x79)
    // A track whose size, FF FF FF E0, reads as -32: back to the start of the file.
    const trackThatPointsBack = bytes(headerChunk(1, 0xffff, BEAT), 'MTrk', 0xff, 0xff, 0xff, 0xe0)
    const nameThatPointsBack = bytes(note, 0x00, 0xff, 0x03, 0xff, 0xff, 0xff, 0xff, 0x70)

    expect(refusal(oneTrackFile(eventThatPointsAtItself))).toBe('damaged')
    expect(refusal(trackThatPointsBack)).toBe('damaged')
    expect(refusal(oneTrackFile(nameThatPointsBack))).toBe('damaged')
  })
})

describe('parseMidiFile: what midi-file hands back is checked', () => {
  const anyFile = midiFile(0, [[on(0, 60), off(BEAT, 60)]])
  const header = { format: 1, numTracks: 1, ticksPerBeat: BEAT }
  const note = [on(0, 60), off(BEAT, 60)]

  afterEach(() => {
    reader.answer = null
  })

  function readAs(answer: unknown): Song {
    reader.answer = () => answer
    return read(anyFile)
  }

  function refusalOf(answer: unknown): string {
    reader.answer = () => answer
    return refusal(anyFile)
  }

  it('reads an answer that is as it should be', () => {
    expect(timings(partOf(readAs({ header, tracks: [note] })))).toEqual([[60, 0, 0.5]])
  })

  it('calls the file damaged when the answer does not have the shape of a song', () => {
    const shapeless = [
      undefined,
      null,
      'words',
      7,
      {},
      { header },
      { tracks: [note] },
      { header: null, tracks: [note] },
      { header, tracks: null },
      { header, tracks: 'words' },
      { header, tracks: { length: 1, 0: note } },
      { header, tracks: [null] },
      { header, tracks: [7] },
      { header, tracks: [[null]] },
      { header, tracks: [[7]] },
      { header, tracks: ['words'] },
    ]
    for (const answer of shapeless) {
      expect(refusalOf(answer), JSON.stringify(answer)).toBe('damaged')
    }
  })

  it('calls the file damaged when the header holds something impossible', () => {
    const impossible = [
      { format: 3 },
      { format: 0.5 },
      { format: '1' },
      { format: undefined },
      { ticksPerBeat: 0 },
      { ticksPerBeat: 0x8000 },
      { ticksPerBeat: 12.5 },
      { ticksPerBeat: Number.NaN },
      { ticksPerBeat: undefined },
    ]
    for (const change of impossible) {
      const answer = { header: { ...header, ...change }, tracks: [note] }
      expect(refusalOf(answer), JSON.stringify(change)).toBe('damaged')
    }
    expect(refusalOf({ header: { ...header, format: 2 }, tracks: [note] })).toBe('unsupported')
    const inFilmFrames = { format: 1, numTracks: 1, framesPerSecond: 25, ticksPerFrame: 40 }
    expect(refusalOf({ header: inFilmFrames, tracks: [note] })).toBe('unsupported')
  })

  it('calls the file damaged when an event holds something impossible', () => {
    const impossible = [
      { ...on(0, 62), deltaTime: -1 },
      { ...on(0, 62), deltaTime: 1.5 },
      { ...on(0, 62), deltaTime: Number.NaN },
      { ...on(0, 62), deltaTime: Number.POSITIVE_INFINITY },
      { ...on(0, 62), deltaTime: 0x10000000 },
      { ...on(0, 62), deltaTime: '5' },
      { ...on(0, 62), deltaTime: undefined },
      { ...on(0, 62), noteNumber: 128 },
      { ...on(0, 62), noteNumber: -1 },
      { ...on(0, 62), noteNumber: '62' },
      { ...on(0, 62), noteNumber: undefined },
      { ...on(0, 62), velocity: 128 },
      { ...on(0, 62), velocity: undefined },
      { ...on(0, 62), channel: 16 },
      { ...on(0, 62), channel: -1 },
      { ...off(0, 62), noteNumber: 6.2 },
      { ...off(0, 62), channel: undefined },
      { ...pedal(0, 127), value: 128 },
      { ...pedal(0, 127), value: undefined },
      { ...pedal(0, 127), channel: 16 },
      { ...program(5), programNumber: 128 },
      { ...program(5), channel: 1.5 },
      { ...microsecondsPerBeat(0, 500_000), microsecondsPerBeat: -1 },
      { ...microsecondsPerBeat(0, 500_000), microsecondsPerBeat: 0x1000000 },
      { ...microsecondsPerBeat(0, 500_000), microsecondsPerBeat: Number.NaN },
      { ...name('Words'), text: 7 },
      { ...name('Words'), text: undefined },
    ]
    for (const event of impossible) {
      const answer = { header, tracks: [[...note, event]] }
      expect(refusalOf(answer), JSON.stringify(event)).toBe('damaged')
    }
  })

  it('takes a note-on with no force as a note-off, whoever reports it', () => {
    const events = [on(0, 60), on(BEAT, 60, 0), on(BEAT, 64), off(BEAT, 64)]
    const song = readAs({ header, tracks: [events] })
    expect(timings(partOf(song))).toEqual([
      [60, 0, 0.5],
      [64, 1, 0.5],
    ])
  })

  it('passes over events it has no use for, known or not', () => {
    const song = readAs({
      header,
      tracks: [
        [
          { deltaTime: BEAT, type: 'somethingNew', channel: 99 },
          { deltaTime: 0, type: 'pitchBend', channel: 0, value: Number.NaN },
          { deltaTime: 0 },
          ...note,
        ],
      ],
    })
    expect(timings(partOf(song))).toEqual([[60, 0.5, 0.5]])
  })

  it('calls the file damaged whatever midi-file throws', () => {
    const thrown = ['a plain string', new Error('an error'), new RangeError('deep'), undefined, 0]
    for (const value of thrown) {
      reader.answer = () => {
        throw value
      }
      expect(refusal(anyFile), String(value)).toBe('damaged')
    }
  })
})

describe('parseMidiFile: timing', () => {
  it('plays at 120 beats a minute when the file sets no speed', () => {
    const song = read(midiFile(0, [[on(BEAT, 60), off(BEAT / 2, 60), end()]]))
    expect(timings(partOf(song))).toEqual([[60, 0.5, 0.25]])
  })

  it('counts beats by the ticks-per-beat of the file', () => {
    const song = read(midiFile(0, [[on(96, 60), off(48, 60), end()]], 96))
    expect(timings(partOf(song))).toEqual([[60, 0.5, 0.25]])
  })

  it('follows the speed the file sets', () => {
    const song = read(midiFile(0, [[tempo(0, 60), on(BEAT, 60), off(BEAT, 60), end()]]))
    expect(timings(partOf(song))).toEqual([[60, 1, 1]])
  })

  it('follows a change of speed, even in the middle of a note', () => {
    const song = read(
      midiFile(0, [
        [
          on(0, 60),
          tempo(2 * BEAT, 60),
          off(BEAT, 60),
          on(0, 62),
          tempo(BEAT, 240),
          off(BEAT, 62),
          end(),
        ],
      ]),
    )
    // Two beats at 120 (1 s), one beat at 60 (1 s); then one beat at 60 and one at 240 (0.25 s).
    expect(timings(partOf(song))).toEqual([
      [60, 0, 2],
      [62, 2, 1.25],
    ])
  })

  it('applies a change of speed in one track to every track', () => {
    const conductor = [tempo(0, 60), tempo(2 * BEAT, 120), end()]
    const high = [on(0, 72), off(BEAT, 72), on(BEAT, 74), off(BEAT, 74), end()]
    const low = [on(2 * BEAT, 48), off(2 * BEAT, 48), end()]

    for (const tracks of [
      [conductor, high, low],
      [high, low, conductor],
    ]) {
      const song = read(midiFile(1, tracks))
      const [first, second] = song.tracks
      expect(first && timings(first)).toEqual([
        [72, 0, 1],
        [74, 2, 0.5],
      ])
      expect(second && timings(second)).toEqual([[48, 2, 1]])
    }
  })

  it('lets the later of two speeds set at the same moment count', () => {
    const song = read(midiFile(0, [[tempo(0, 30), tempo(0, 60), on(BEAT, 60), off(BEAT, 60)]]))
    expect(timings(partOf(song))).toEqual([[60, 1, 1]])
  })

  it('does not believe a speed that would stop time', () => {
    const song = read(
      midiFile(0, [[tempo(0, 60), microsecondsPerBeat(0, 0), on(BEAT, 60), off(BEAT, 60), end()]]),
    )
    expect(timings(partOf(song))).toEqual([[60, 1, 1]])
  })

  it('holds an absurd speed to 1000 beats a minute', () => {
    const tooFast = microsecondsPerBeat(0, 1)
    const song = read(
      midiFile(0, [[tooFast, on(BEAT, 60), off(BEAT, 60), on(0, 62), off(BEAT, 62)]]),
    )
    expect(timings(partOf(song))).toEqual([
      [60, 0.06, 0.06],
      [62, 0.12, 0.06],
    ])
  })

  it('places every note where a slow, simple sum of the speed changes says', () => {
    const random = seededRandom(7)
    const changes: { tick: number; microseconds: number }[] = []
    const conductor: MidiEvent[] = []
    let tick = 0
    for (let index = 0; index < 200; index++) {
      const wait = int(random, 700)
      const microseconds = 150_000 + int(random, 900_000)
      tick += wait
      changes.push({ tick, microseconds })
      conductor.push(microsecondsPerBeat(wait, microseconds))
    }
    const starts: number[] = []
    const melody: MidiEvent[] = []
    tick = 0
    for (let index = 0; index < 300; index++) {
      const wait = int(random, 400)
      tick += wait
      starts.push(tick)
      melody.push(on(wait, 60 + (index % 12)), off(0, 60 + (index % 12)))
    }
    const secondsAt = (at: number) => {
      let seconds = 0
      let from = 0
      let current = 500_000
      for (const change of changes) {
        if (change.tick > at) break
        seconds += ((change.tick - from) * current) / 1_000_000 / BEAT
        from = change.tick
        current = change.microseconds
      }
      return seconds + ((at - from) * current) / 1_000_000 / BEAT
    }

    const song = read(midiFile(1, [conductor, melody]))
    const heard = partOf(song)
      .notes.map((note) => note.time)
      .sort((a, b) => a - b)
    const expected = starts.map(secondsAt)

    expect(heard).toHaveLength(expected.length)
    heard.forEach((time, index) => expect(time).toBeCloseTo(expected[index] ?? -1, 6))
  })
})

describe('parseMidiFile: notes', () => {
  it('scales the force of a note to 0..1', () => {
    const song = read(midiFile(0, [[on(0, 60, 127), off(BEAT, 60), on(0, 62, 1), off(BEAT, 62)]]))
    expect(partOf(song).notes.map((note) => note.velocity)).toEqual([1, 1 / 127])
  })

  it('takes a note-on with no force as a note-off', () => {
    const file = oneTrackFile(bytes(0x00, 0x90, 60, 100, 0x83, 0x60, 0x90, 60, 0, END_OF_TRACK))
    expect(timings(partOf(read(file)))).toEqual([[60, 0, 0.5]])
  })

  it('ignores a note-off with no note-on before it', () => {
    const song = read(
      midiFile(0, [[off(0, 64), on(BEAT, 60), off(BEAT, 60), off(BEAT, 60), off(0, 72), end()]]),
    )
    expect(timings(partOf(song))).toEqual([[60, 0.5, 0.5]])
  })

  it('ends a note where the same pitch starts again', () => {
    const song = read(midiFile(0, [[on(0, 60), on(BEAT, 60), off(BEAT, 60), off(BEAT, 60), end()]]))
    expect(timings(partOf(song))).toEqual([
      [60, 0, 0.5],
      [60, 0.5, 0.5],
    ])
  })

  it('gives a note struck again its whole length when the old note-off is written after it', () => {
    // Some programs write a repeated note as "new note on, old note off", at the same moment.
    const again = [on(BEAT, 60), off(0, 60)]
    const twice = [on(0, 60), ...again, off(BEAT, 60)]
    const threeTimes = [on(0, 60), ...again, ...again, off(BEAT, 60)]
    const lastOneNeverReleased = [on(0, 60), ...again, end(BEAT)]

    expect(timings(partOf(read(midiFile(0, [twice]))))).toEqual([
      [60, 0, 0.5],
      [60, 0.5, 0.5],
    ])
    expect(timings(partOf(read(midiFile(0, [threeTimes]))))).toEqual([
      [60, 0, 0.5],
      [60, 0.5, 0.5],
      [60, 1, 0.5],
    ])
    expect(timings(partOf(read(midiFile(0, [lastOneNeverReleased]))))).toEqual([
      [60, 0, 0.5],
      [60, 0.5, 0.5],
    ])
  })

  it('still ends a note struck again at a note-off that is its own', () => {
    // The release of another key at that moment, and a second release of the same key.
    const otherKey = [on(0, 60), on(0, 64), on(BEAT, 60), off(0, 64), off(0, 60), off(BEAT, 60)]
    const releasedTwice = [on(0, 60), on(BEAT, 60), off(0, 60), off(0, 60), end(BEAT)]
    // A note that is struck for the first time and released at once has no old note to end.
    const afterARelease = [on(0, 60), off(BEAT, 60), on(0, 60), off(0, 60), end(BEAT)]

    expect(timings(partOf(read(midiFile(0, [otherKey]))))).toEqual([
      [60, 0, 0.5],
      [64, 0, 0.5],
      [60, 0.5, 0.5],
    ])
    for (const events of [releasedTwice, afterARelease]) {
      expect(timings(partOf(read(midiFile(0, [events]))))).toEqual([
        [60, 0, 0.5],
        [60, 0.5, 0.03],
      ])
    }
  })

  it('ends a note that is never released where its track ends', () => {
    const song = read(midiFile(0, [[on(0, 60), on(BEAT, 64), off(BEAT, 64), end(BEAT)]]))
    expect(timings(partOf(song))).toEqual([
      [60, 0, 1.5],
      [64, 0.5, 0.5],
    ])
  })

  it('gives a note with no length a short one', () => {
    const struckAndReleasedAtOnce = read(midiFile(0, [[on(0, 60), off(0, 60), end(BEAT)]]))
    const lastEventOfItsTrack = read(midiFile(0, [[on(BEAT, 60)]]))

    expect(timings(partOf(struckAndReleasedAtOnce))).toEqual([[60, 0, 0.03]])
    expect(timings(partOf(lastEventOfItsTrack))).toEqual([[60, 0.5, 0.03]])
    expect(lastEventOfItsTrack.duration).toBeCloseTo(0.53, 10)
  })

  it('drops the pitches a piano does not have', () => {
    const song = read(
      midiFile(0, [
        [
          on(0, 20),
          on(0, 21),
          on(0, 108),
          on(0, 109),
          on(0, 0),
          on(0, 127),
          off(BEAT, 20),
          off(0, 21),
          off(0, 108),
          off(0, 109),
          off(0, 0),
          off(0, 127),
        ],
      ]),
    )
    expect(timings(partOf(song))).toEqual([
      [21, 0, 0.5],
      [108, 0, 0.5],
    ])
  })

  it('sorts the notes by time, then by pitch', () => {
    const chord = [on(0, 67), on(0, 60), on(0, 64), off(BEAT, 64), off(0, 67), off(0, 60)]
    const song = read(midiFile(0, [[...chord, on(0, 55), off(BEAT, 55)]]))
    expect(partOf(song).notes.map((note) => note.midi)).toEqual([60, 64, 67, 55])
  })

  it('keeps the same pitch on two channels, or in two tracks, as separate notes', () => {
    const twoChannels = read(
      midiFile(0, [[on(0, 60, 100, 0), on(BEAT, 60, 100, 1), off(BEAT, 60, 0), off(BEAT, 60, 1)]]),
    )
    const twoTracks = read(
      midiFile(1, [
        [on(0, 60), off(2 * BEAT, 60), end()],
        [on(BEAT, 60), off(2 * BEAT, 60), end()],
      ]),
    )

    for (const song of [twoChannels, twoTracks]) {
      expect(timings(partOf(song, 0))).toEqual([[60, 0, 1]])
      expect(timings(partOf(song, 1))).toEqual([[60, 0.5, 1]])
    }
  })

  it('accepts exactly as many notes as the limit and refuses one more', () => {
    const notes = (count: number) => {
      const events: MidiEvent[] = []
      for (let index = 0; index < count; index++) {
        events.push(on(1, 21 + (index % 88)), off(1, 21 + (index % 88)))
      }
      return midiFile(0, [events])
    }

    expect(partOf(read(notes(MAX_SONG_NOTES))).notes).toHaveLength(MAX_SONG_NOTES)
    expect(refusal(notes(MAX_SONG_NOTES + 1))).toBe('unsupported')
  })

  it('says so when a file has no notes', () => {
    const noTracks = headerChunk(1, 0, BEAT)
    const noEvents = midiFile(1, [[], [end()]])
    const wordsOnly = midiFile(0, [[name('Silence'), tempo(0, 90), end(4 * BEAT)]])
    const releasesOnly = midiFile(0, [[off(0, 60), off(BEAT, 62), end()]])
    const offThePiano = midiFile(0, [[on(0, 10), off(BEAT, 10), on(0, 120), off(BEAT, 120)]])

    for (const file of [noTracks, noEvents, wordsOnly, releasesOnly, offThePiano]) {
      expect(refusal(file)).toBe('no-notes')
    }
  })
})

describe('parseMidiFile: the sustain pedal', () => {
  it('keeps a released note sounding until the pedal comes up', () => {
    const song = read(midiFile(0, [[pedal(0, 127), on(0, 60), off(BEAT, 60), pedal(2 * BEAT, 0)]]))
    expect(timings(partOf(song))).toEqual([[60, 0, 1.5]])
  })

  it('stops a note the pedal is holding when the same pitch is played again', () => {
    const song = read(
      midiFile(0, [
        [
          pedal(0, 127),
          on(0, 60),
          off(BEAT / 2, 60),
          on(BEAT / 2, 60),
          off(BEAT / 2, 60),
          pedal(BEAT / 2, 0),
          end(),
        ],
      ]),
    )
    expect(timings(partOf(song))).toEqual([
      [60, 0, 0.5],
      [60, 0.5, 0.5],
    ])
  })

  it('leaves alone a note released before the pedal went down', () => {
    const song = read(midiFile(0, [[on(0, 60), off(BEAT, 60), pedal(0, 127), pedal(BEAT, 0)]]))
    expect(timings(partOf(song))).toEqual([[60, 0, 0.5]])
  })

  it('does not cut a note whose key is still down when the pedal comes up', () => {
    const song = read(midiFile(0, [[pedal(0, 127), on(0, 60), pedal(BEAT, 0), off(BEAT, 60)]]))
    expect(timings(partOf(song))).toEqual([[60, 0, 1]])
  })

  it('holds every note released while it is down, each until the pedal comes up', () => {
    const song = read(
      midiFile(0, [
        [
          on(0, 60),
          pedal(BEAT, 127),
          off(BEAT, 60),
          on(0, 64),
          off(BEAT, 64),
          on(0, 67),
          pedal(BEAT, 0),
          off(BEAT, 67),
        ],
      ]),
    )
    expect(timings(partOf(song))).toEqual([
      [60, 0, 2],
      [64, 1, 1],
      [67, 1.5, 1],
    ])
  })

  it('counts the pedal as down from half-way', () => {
    const withPedalAt = (value: number) =>
      read(midiFile(0, [[pedal(0, value), on(0, 60), off(BEAT, 60), pedal(BEAT, 0), end()]]))

    expect(timings(partOf(withPedalAt(63)))).toEqual([[60, 0, 0.5]])
    expect(timings(partOf(withPedalAt(64)))).toEqual([[60, 0, 1]])
  })

  it('keeps the pedal of each channel to that channel', () => {
    const song = read(
      midiFile(0, [
        [
          pedal(0, 127, 0),
          on(0, 60, 100, 0),
          on(0, 64, 100, 1),
          off(BEAT, 60, 0),
          off(0, 64, 1),
          pedal(BEAT, 0, 0),
          end(),
        ],
      ]),
    )
    expect(timings(partOf(song, 0))).toEqual([[60, 0, 1]])
    expect(timings(partOf(song, 1))).toEqual([[64, 0, 0.5]])
  })

  it('holds the notes of a channel in every track, as an instrument would', () => {
    const leftHand = [pedal(0, 127), on(0, 48), off(BEAT, 48), pedal(BEAT, 0), end()]
    const rightHand = [on(0, 72), off(BEAT, 72), on(2 * BEAT, 76), off(BEAT, 76), end()]
    const song = read(midiFile(1, [leftHand, rightHand]))

    expect(timings(partOf(song, 0))).toEqual([[48, 0, 1]])
    expect(timings(partOf(song, 1))).toEqual([
      [72, 0, 1],
      [76, 1.5, 0.5],
    ])
  })

  it('stops every held note of a pitch that is played again, whichever track it came from', () => {
    const first = [pedal(0, 127), on(0, 60), off(BEAT, 60), on(2 * BEAT, 60), off(BEAT, 60)]
    const second = [on(BEAT / 2, 60), off(BEAT, 60), end()]
    const song = read(midiFile(1, [[...first, pedal(BEAT, 0)], second]))

    // Both tracks let go of C4 under the pedal. Both notes stop when C4 is played again.
    expect(timings(partOf(song, 0))).toEqual([
      [60, 0, 1.5],
      [60, 1.5, 1],
    ])
    expect(timings(partOf(song, 1))).toEqual([[60, 0.25, 1.25]])
  })

  it('ends a held note with its track when the pedal never comes up', () => {
    const song = read(midiFile(0, [[pedal(0, 127), on(0, 60), off(BEAT, 60), end(BEAT)]]))
    expect(timings(partOf(song))).toEqual([[60, 0, 1]])
  })

  it('takes no notice of the other controllers', () => {
    const others = [controller(0, 7, 127), controller(0, 66, 127), controller(0, 1, 127)]
    const song = read(midiFile(0, [[...others, on(0, 60), off(BEAT, 60), end(BEAT)]]))
    expect(timings(partOf(song))).toEqual([[60, 0, 0.5]])
  })
})

describe('parseMidiFile: parts', () => {
  it('makes one part for each track that has notes, numbered by its place in the file', () => {
    const song = read(
      midiFile(1, [
        [name('A song in two hands'), tempo(0, 120), end()],
        [name('Right hand'), program(0), on(0, 72), off(BEAT, 72), end()],
        [],
        [name('Left hand'), program(32), on(0, 48), off(BEAT, 48), end()],
      ]),
    )

    expect(song.tracks.map((part) => [part.id, part.name, part.program])).toEqual([
      [1, 'Right hand', 0],
      [3, 'Left hand', 32],
    ])
    expect(song.tracks.every((part) => !part.isPercussion)).toBe(true)
  })

  it('makes one part for each channel of a one-track file', () => {
    const song = read(
      midiFile(0, [
        [
          name('Trio'),
          program(40, 1),
          program(0, 0),
          program(1, 0),
          on(0, 60, 100, 0),
          on(0, 67, 100, 1),
          on(0, 38, 100, 9),
          off(BEAT, 60, 0),
          off(0, 67, 1),
          off(0, 38, 9),
          end(),
        ],
      ]),
    )

    expect(song.tracks.map((part) => [part.program, part.isPercussion])).toEqual([
      [0, false],
      [40, false],
      [null, true],
    ])
    expect(song.tracks.map((part) => part.notes[0]?.midi)).toEqual([60, 67, 38])
    expect(new Set(song.tracks.map((part) => part.id)).size).toBe(3)
  })

  it('keeps one part for a one-track file that plays on one channel', () => {
    const song = read(midiFile(0, [[on(0, 60, 100, 3), off(BEAT, 60, 3), end()]]))
    expect(song.tracks.map((part) => part.id)).toEqual([0])
  })

  it('splits a track that plays on several channels, and reuses no number', () => {
    const song = read(
      midiFile(1, [
        [on(0, 60, 100, 0), on(0, 36, 100, 9), off(BEAT, 60, 0), off(0, 36, 9), end()],
        [on(0, 72), off(BEAT, 72), end()],
        [on(0, 48), off(BEAT, 48), end()],
      ]),
    )
    const ids = song.tracks.map((part) => part.id)

    expect(song.tracks.map((part) => part.isPercussion)).toEqual([false, true, false, false])
    expect(ids.slice(2)).toEqual([1, 2])
    expect(new Set(ids).size).toBe(4)
  })

  it('gives the same parts the same numbers every time the file is read', () => {
    const file = midiFile(1, [
      [on(0, 60, 100, 0), on(0, 62, 100, 5), off(BEAT, 60, 0), off(0, 62, 5), end()],
      [on(0, 72), off(BEAT, 72), end()],
    ])
    const ids = (song: Song) => song.tracks.map((part) => part.id)
    expect(ids(read(file))).toEqual(ids(read(file)))
  })

  it('marks channel 10 as percussion and refuses a file that has nothing else', () => {
    const drumsAndBass = midiFile(1, [
      [on(0, 36, 100, 9), off(BEAT, 36, 9), end()],
      [on(0, 40, 100, 8), off(BEAT, 40, 8), end()],
    ])
    const drumsOnly = midiFile(0, [[on(0, 36, 100, 9), off(BEAT, 36, 9), end()]])

    expect(read(drumsAndBass).tracks.map((part) => part.isPercussion)).toEqual([true, false])
    expect(refusal(drumsOnly)).toBe('no-notes')
  })

  it('takes the instrument from the first choice made on the channel of the part', () => {
    const chosenTwice = read(midiFile(0, [[program(5), on(0, 60), program(40), off(BEAT, 60)]]))
    const neverChosen = read(midiFile(0, [[on(0, 60), off(BEAT, 60)]]))
    const chosenElsewhere = read(midiFile(0, [[program(5, 1), on(0, 60), off(BEAT, 60)]]))

    expect(partOf(chosenTwice).program).toBe(5)
    expect(partOf(neverChosen).program).toBeNull()
    expect(partOf(chosenElsewhere).program).toBeNull()
  })

  it('tidies the name of a part and reads accents however they were written', () => {
    const named = (text: string) =>
      partOf(read(midiFile(1, [[end()], [name(text), on(0, 60), off(BEAT, 60), end()]]))).name

    expect(named('  Right \u0000 hand\u0000\u0000')).toBe('Right hand')
    expect(named(utf8('Flûte à bec'))).toBe('Flûte à bec')
    expect(named('Flûte')).toBe('Flûte')
    expect(named('')).toBe('')
    expect(named('\u0000\u0000')).toBe('')
    expect(named('n'.repeat(120))).toBe('n'.repeat(MAX_TITLE_LENGTH))
  })

  it('uses the first name a track gives', () => {
    const names = [name(''), name('First'), name('Second')]
    const song = read(midiFile(0, [[...names, on(0, 60), off(BEAT, 60)]]))
    expect(partOf(song).name).toBe('First')
  })
})

describe('parseMidiFile: the title, the id and the date', () => {
  const titled = (sequenceName: string | null, fileName: string) => {
    const conductor = sequenceName === null ? [end()] : [name(sequenceName), end()]
    const rightHand = [name('Right hand'), on(0, 60), off(BEAT, 60), end()]
    return read(midiFile(1, [conductor, rightHand]), fileName).title
  }

  it('takes the title from the name of a first track that plays no notes', () => {
    expect(titled('Gymnopedie No. 1', 'track01.mid')).toBe('Gymnopedie No. 1')
    expect(titled(utf8('Für Elise'), 'track01.mid')).toBe('Für Elise')
    expect(titled('  Clair \u0000 de   Lune ', 'track01.mid')).toBe('Clair de Lune')
    expect(titled('1812', 'track01.mid')).toBe('1812')
  })

  it('takes the title from the file name when the first track has no name', () => {
    expect(titled(null, 'music/fur_elise.mid')).toBe('fur_elise')
    expect(titled('', 'Moonlight Sonata.MID')).toBe('Moonlight Sonata')
    expect(titled('\u0000', 'nocturne.midi')).toBe('nocturne')
    expect(titled(null, '')).toBe(UNTITLED)
  })

  it('takes the title from the name of the only track of a one-track file', () => {
    const oneTrack = (trackName: string) =>
      midiFile(0, [[name(trackName), on(0, 60), off(BEAT, 60), end()]])

    expect(read(oneTrack('Nocturne in E flat'), 'track01.mid').title).toBe('Nocturne in E flat')
    expect(read(oneTrack('Piano'), 'nocturne.mid').title).toBe('nocturne')
  })

  it('takes the title from the file name when the first track is one of the parts', () => {
    // Its name is then the name of that part: the player would look for "moonlight" in vain.
    const rightHand = [name('Right Hand'), on(0, 72), off(BEAT, 72), end()]
    const leftHand = [name('Left Hand'), on(0, 48), off(BEAT, 48), end()]
    const drums = [name('Drum Kit'), on(0, 36, 100, 9), off(BEAT, 36, 9), end()]

    const twoHands = read(midiFile(1, [rightHand, leftHand]), 'moonlight.mid')
    expect(twoHands.title).toBe('moonlight')
    expect(twoHands.tracks.map((part) => part.name)).toEqual(['Right Hand', 'Left Hand'])
    expect(read(midiFile(1, [drums, leftHand]), 'march.mid').title).toBe('march')
  })

  it('takes the title from the file name when the name in the file says nothing', () => {
    const sayNothing = [
      'Untitled',
      'untitled',
      'UNTITLED SONG',
      'Untitled-2',
      'Track 1',
      'track_03',
      'MIDI',
      'Sequence',
      'New Song 3',
      'Tempo Track',
      'Conductor',
      'Piano',
    ]
    for (const sequenceName of sayNothing) {
      expect(titled(sequenceName, 'waltz.mid'), sequenceName).toBe('waltz')
    }
  })

  it('uses the id and the date it is given', () => {
    const file = midiFile(0, [[on(0, 60), off(BEAT, 60)]])
    const song = parseMidiFile(file, 'a.mid', { id: 'chosen', now: 1234 })

    expect(song.id).toBe('chosen')
    expect(song.createdAt).toBe(1234)
  })

  it('makes up a new id each time and uses the time of day when it is given none', () => {
    const file = midiFile(0, [[on(0, 60), off(BEAT, 60)]])
    const before = Date.now()
    const first = parseMidiFile(file, 'a.mid')
    const second = parseMidiFile(file, 'a.mid')
    const after = Date.now()

    expect(first.id).not.toBe('')
    expect(first.id).not.toBe(second.id)
    expect(isStarterSong(first.id)).toBe(false)
    expect(first.createdAt).toBeGreaterThanOrEqual(before)
    expect(first.createdAt).toBeLessThanOrEqual(after)
    expect({ ...first, id: '', createdAt: 0 }).toEqual({ ...second, id: '', createdAt: 0 })
  })

  it('still makes up ids on a page where the browser offers no random ones', () => {
    const file = midiFile(0, [[on(0, 60), off(BEAT, 60)]])
    vi.stubGlobal('crypto', undefined)
    try {
      const first = parseMidiFile(file, 'a.mid').id
      const second = parseMidiFile(file, 'a.mid').id

      expect(first).not.toBe('')
      expect(first).not.toBe(second)
      expect(isStarterSong(first)).toBe(false)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('parseMidiFile: a long silent start', () => {
  it('is cut down to one second', () => {
    const tenBeatsIn = [on(10 * BEAT, 60), off(BEAT, 60), on(BEAT, 64), off(BEAT, 64)]
    const song = read(midiFile(0, [tenBeatsIn]))

    expect(timings(partOf(song))).toEqual([
      [60, 1, 0.5],
      [64, 2, 0.5],
    ])
    expect(song.duration).toBeCloseTo(2.5, 6)
  })

  it('is left alone when it is a second or less', () => {
    const song = read(midiFile(0, [[on(2 * BEAT, 60), off(BEAT, 60), on(BEAT, 64), off(BEAT, 64)]]))

    expect(timings(partOf(song))).toEqual([
      [60, 1, 0.5],
      [64, 2, 0.5],
    ])
    expect(timings(partOf(read(midiFile(0, [[on(BEAT, 60), off(BEAT, 60)]]))))).toEqual([
      [60, 0.5, 0.5],
    ])
  })

  it('moves every part by the same amount', () => {
    const song = read(
      midiFile(1, [
        [on(8 * BEAT, 72), off(BEAT, 72), end()],
        [on(6 * BEAT, 48), off(BEAT, 48), end()],
      ]),
    )
    expect(timings(partOf(song, 0))).toEqual([[72, 2, 0.5]])
    expect(timings(partOf(song, 1))).toEqual([[48, 1, 0.5]])
  })

  it('does not wait for drums: they are never played', () => {
    // A drum hit every second for four seconds, then two more once the piano has come in.
    const drums: MidiEvent[] = []
    let tick = 0
    for (const beat of [0, 2, 4, 6, 10, 12]) {
      drums.push(on(beat * BEAT - tick, 36, 100, 9), off(1, 36, 9))
      tick = beat * BEAT + 1
    }
    const piano = [on(10 * BEAT, 60), off(BEAT, 60), end()]
    const song = read(midiFile(1, [drums, piano]))

    // The piano comes in after 5 seconds: 4 of them are cut, with the drum hits in them.
    expect(partOf(song, 0).notes.map((note) => Math.round(note.time * 1000) / 1000)).toEqual([1, 2])
    expect(timings(partOf(song, 1))).toEqual([[60, 1, 0.5]])
  })

  it('drops a drum part that only played during the cut', () => {
    const song = read(
      midiFile(1, [
        [on(0, 36, 100, 9), off(BEAT, 36, 9), end()],
        [on(10 * BEAT, 60), off(BEAT, 60), end()],
      ]),
    )
    expect(song.tracks.map((part) => part.isPercussion)).toEqual([false])
  })
})

/*
 * Fuzzing: thousands of files that nobody would write on purpose. Whatever
 * the bytes, the answer is a sound song or a SongImportError, and it comes
 * quickly. The random numbers come from a seed, so every run tests the same files.
 */

function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let mixed = state
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1)
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61)
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296
  }
}

/** A whole number from 0 up to, but not including, `below`. */
function int(random: () => number, below: number): number {
  return Math.floor(random() * below)
}

function randomBytes(random: () => number, count: number): number[] {
  return Array.from({ length: count }, () => int(random, 256))
}

function variableLength(value: number): number[] {
  const result = [value & 0x7f]
  for (let rest = value >>> 7; rest > 0; rest >>>= 7) result.unshift((rest & 0x7f) | 0x80)
  return result
}

/** The bytes of a track of well-formed events, picked at random. */
function randomTrack(random: () => number): number[] {
  const events: number[] = []
  const count = int(random, 40)
  for (let index = 0; index < count; index++) {
    events.push(...variableLength(int(random, 4) === 0 ? int(random, 5000) : int(random, 200)))
    const channel = int(random, 4) === 0 ? 9 : int(random, 3)
    const pitch = int(random, 8) === 0 ? int(random, 128) : 55 + int(random, 12)
    const kind = int(random, 12)
    if (kind < 5) events.push(0x90 | channel, pitch, int(random, 128))
    else if (kind < 8) events.push(0x80 | channel, pitch, int(random, 128))
    else if (kind === 8) events.push(0xb0 | channel, 64, int(random, 128))
    else if (kind === 9) events.push(0xff, 0x51, 3, ...randomBytes(random, 3))
    else if (kind === 10) events.push(0xc0 | channel, int(random, 128))
    else events.push(0xff, 0x03, 4, ...randomBytes(random, 4))
  }
  return events
}

/** A well-formed file of random events. */
function randomFile(random: () => number): number[] {
  const trackCount = 1 + int(random, 4)
  const division = [1, 24, 96, BEAT, 0x7fff][int(random, 5)] ?? BEAT
  const tracks = Array.from({ length: trackCount }, () => chunk('MTrk', randomTrack(random)))
  return bytes(headerChunk(trackCount === 1 ? 0 : 1, trackCount, division), ...tracks)
}

/** A copy of `file` with a few bytes changed, added, removed, repeated or cut off. */
function mutated(file: readonly number[], random: () => number): number[] {
  let result = [...file]
  const edits = 1 + int(random, 4)
  for (let edit = 0; edit < edits; edit++) {
    const at = int(random, result.length + 1)
    const kind = int(random, 7)
    if (kind === 0) result[at] = int(random, 256)
    else if (kind === 1) result[at] = [0x00, 0x7f, 0x80, 0xff][int(random, 4)] ?? 0
    else if (kind === 2) result[at] = (result[at] ?? 0) ^ (1 << int(random, 8))
    else if (kind === 3) result.splice(at, 0, ...randomBytes(random, 1 + int(random, 4)))
    else if (kind === 4) result.splice(at, 1 + int(random, 8))
    else if (kind === 5) result.splice(at, 0, ...result.slice(at, at + 1 + int(random, 16)))
    else result = result.slice(0, at)
  }
  return result
}

/** What became of one file: 'song', the code it was refused with, or what went wrong. */
function outcomeOf(file: ArrayLike<number>): string {
  try {
    const problems = songProblems(parseMidiFile(Uint8Array.from(file), 'fuzz.mid'))
    return problems.length === 0 ? 'song' : `a song that is not sound: ${problems.join('; ')}`
  } catch (error) {
    if (!(error instanceof SongImportError)) return `threw something else: ${String(error)}`
    return error.userMessage === MESSAGES[error.code] ? error.code : `wrong sentence: ${error.code}`
  }
}

const ALLOWED_OUTCOMES = new Set(['song', ...Object.keys(MESSAGES)])

/** Imports every file. Returns how many ended in each way, the failures and the slowest import. */
function fuzz(files: Iterable<readonly number[]>) {
  const counts = new Map<string, number>()
  const failures: string[] = []
  let slowest = 0
  let index = 0
  for (const file of files) {
    const started = performance.now()
    const outcome = outcomeOf(file)
    slowest = Math.max(slowest, performance.now() - started)
    counts.set(outcome, (counts.get(outcome) ?? 0) + 1)
    if (!ALLOWED_OUTCOMES.has(outcome) && failures.length < 5) {
      failures.push(`file ${index} [${file.slice(0, 80).join(' ')}]: ${outcome}`)
    }
    index++
  }
  return { counts, failures, slowest }
}

describe('parseMidiFile: fuzzing', () => {
  const seedFiles: number[][] = [
    Array.from(
      midiFile(0, [
        [
          name('Seed'),
          tempo(0, 90),
          program(0),
          pedal(0, 127),
          on(0, 60),
          off(BEAT, 60),
          on(0, 64, 90, 1),
          tempo(BEAT, 140),
          off(0, 64, 1),
          pedal(BEAT, 0),
          on(0, 38, 110, 9),
          off(60, 38, 9),
          end(),
        ],
      ]),
    ),
    Array.from(
      midiFile(1, [
        [name('Three tracks'), tempo(0, 100), tempo(4 * BEAT, 60), end()],
        [name('High'), program(73), on(0, 76), off(BEAT, 76), on(0, 79), on(BEAT, 79), end(BEAT)],
        [name('Low'), pedal(0, 100), on(BEAT, 43), off(BEAT, 43), pedal(BEAT, 0), end()],
      ]),
    ),
    oneTrackFile(
      bytes(0x00, 0x90, 60, 80, 0x60, 60, 0, 0x00, 64, 90, 0x60, 64, 0, END_OF_TRACK),
      96,
    ),
    riff(Array.from(midiFile(0, [[on(0, 72), off(BEAT, 72), end()]]))),
    // A track that begins with a sequence number written without its number.
    oneTrackFile(bytes(0x00, 0xff, 0x00, 0x00, 0x00, 0x90, 60, 80, 0x60, 60, 0, END_OF_TRACK), 96),
  ]

  it('starts from files that are sound', () => {
    for (const file of seedFiles) expect(outcomeOf(file)).toBe('song')
  })

  it('answers random bytes with a refusal (or a sound song), never with anything else', () => {
    const random = seededRandom(1)
    function* files() {
      for (let index = 0; index < 1500; index++) yield randomBytes(random, int(random, 300))
      for (let index = 0; index < 1500; index++) {
        const header = headerChunk(int(random, 3), 1 + int(random, 3), int(random, 0x10000))
        const events = randomBytes(random, int(random, 200))
        yield int(random, 2) === 0
          ? bytes(header, chunk('MTrk', events))
          : bytes('MThd', randomBytes(random, int(random, 60)))
      }
    }
    const { counts, failures, slowest } = fuzz(files())

    expect(failures).toEqual([])
    expect(counts.get('not-midi')).toBeGreaterThan(1000)
    expect(counts.get('damaged')).toBeGreaterThan(500)
    expect(slowest).toBeLessThan(1000)
  })

  it('reads well-formed files of random events into sound songs', () => {
    const random = seededRandom(2)
    function* files() {
      for (let index = 0; index < 2000; index++) yield randomFile(random)
    }
    const { counts, failures, slowest } = fuzz(files())

    expect(failures).toEqual([])
    expect([...counts.keys()].sort()).toEqual(['no-notes', 'song'])
    expect(counts.get('song')).toBeGreaterThan(1500)
    expect(slowest).toBeLessThan(1000)
  })

  it('answers files with random damage with a sound song or a refusal', () => {
    const random = seededRandom(3)
    function* files() {
      for (let index = 0; index < 2000; index++) {
        yield mutated(seedFiles[index % seedFiles.length] ?? [], random)
      }
      for (let index = 0; index < 2000; index++) yield mutated(randomFile(random), random)
    }
    const { counts, failures, slowest } = fuzz(files())

    expect(failures).toEqual([])
    expect(counts.get('song')).toBeGreaterThan(500)
    expect(counts.get('damaged')).toBeGreaterThan(500)
    expect(slowest).toBeLessThan(1000)
  })

  it('answers quickly however a file of the largest size is filled', { timeout: 60_000 }, () => {
    const filled = (start: readonly number[], repeated: readonly number[]) => {
      const file = new Uint8Array(MAX_MIDI_BYTES)
      const room = MAX_MIDI_BYTES - 22 - start.length
      const length = start.length + Math.floor(room / repeated.length) * repeated.length
      file.set(bytes(headerChunk(0, 1, BEAT), 'MTrk', uint32(length), start))
      for (let at = 22 + start.length; at + repeated.length <= 22 + length; at += repeated.length) {
        file.set(repeated, at)
      }
      return file.subarray(0, 22 + length)
    }
    const largest: [expected: string, file: Uint8Array][] = [
      // One key struck again and again: far more notes than a song may have.
      ['unsupported', filled([0x00, 0x90, 60, 100], [0x01, 60, 0, 0x01, 60, 100])],
      // Nothing but keys coming up.
      ['no-notes', filled([0x00, 0x80, 60, 0], [0x00, 60, 0])],
      // One held note, and a pedal that goes up and down to the end.
      ['song', filled([0x00, 0x90, 60, 100, 0x00, 0xb0, 64, 127], [0x01, 64, 0, 0x01, 64, 127])],
      ['damaged', filled([], [0xff])],
    ]
    for (const [expected, file] of largest) {
      const started = performance.now()
      expect(outcomeOf(file)).toBe(expected)
      expect(performance.now() - started).toBeLessThan(5000)
    }
  })
})
