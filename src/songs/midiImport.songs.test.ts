/**
 * The importer, attacked with files written out byte by byte: cut short at
 * every position, with the wrong lengths, of every kind, far too large, or
 * not MIDI at all. Then its reading of the music is compared, over hundreds
 * of random files, with a second and much slower reading written here.
 */
import { describe, expect, it } from 'vitest'
import { arrange, selectedTracks } from './arrange'
import { MAX_MIDI_BYTES, MAX_SONG_NOTES, SongImportError, parseMidiFile } from './midiImport'
import type { SongImportErrorCode } from './midiImport'
import { DEFAULT_ARRANGE_OPTIONS, cleanTitle } from './song'
import type { Song, SongNote } from './song'

/* ---------------------------------------------------------------- bytes */

function text(value: string): number[] {
  return Array.from(value, (character) => character.charCodeAt(0))
}

function uint16(value: number): number[] {
  return [(value >>> 8) & 0xff, value & 0xff]
}

function uint32(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]
}

/** A number as MIDI files write waits and lengths: seven bits a byte, the last byte under 128. */
function variable(value: number): number[] {
  const out = [value & 0x7f]
  for (let rest = Math.floor(value / 128); rest > 0; rest = Math.floor(rest / 128)) {
    out.unshift((rest & 0x7f) | 0x80)
  }
  return out
}

function header(format: number, trackCount: number, division: number): number[] {
  return [
    ...text('MThd'), ...uint32(6), ...uint16(format), ...uint16(trackCount), ...uint16(division),
  ]
}

function track(events: readonly number[]): number[] {
  return [...text('MTrk'), ...uint32(events.length), ...events]
}

function endOfTrack(delta = 0): number[] {
  return [...variable(delta), 0xff, 0x2f, 0x00]
}

function on(delta: number, midi: number, velocity = 100, channel = 0): number[] {
  return [...variable(delta), 0x90 | channel, midi, velocity]
}

function off(delta: number, midi: number, channel = 0): number[] {
  return [...variable(delta), 0x80 | channel, midi, 64]
}

function pedal(delta: number, value: number, channel = 0): number[] {
  return [...variable(delta), 0xb0 | channel, 64, value]
}

function tempo(delta: number, microsecondsPerBeat: number): number[] {
  const value = [
    (microsecondsPerBeat >>> 16) & 0xff,
    (microsecondsPerBeat >>> 8) & 0xff,
    microsecondsPerBeat & 0xff,
  ]
  return [...variable(delta), 0xff, 0x51, 0x03, ...value]
}

function meta(delta: number, type: number, value: string): number[] {
  return [...variable(delta), 0xff, type, ...variable(value.length), ...text(value)]
}

function trackName(value: string): number[] {
  return meta(0, 0x03, value)
}

function program(delta: number, number: number, channel = 0): number[] {
  return [...variable(delta), 0xc0 | channel, number]
}

/** A file with one track, 480 ticks to the beat: half a second a beat unless it sets a speed. */
function oneTrack(events: readonly number[], division = 480): number[] {
  return [...header(0, 1, division), ...track(events)]
}

/* ------------------------------------------------------------ outcomes */

const SENTENCES: Readonly<Record<SongImportErrorCode, string>> = {
  'not-midi': 'That file is not a MIDI file. MIDI files usually end in .mid or .midi.',
  'too-big': 'That file is too big. The limit is 5 MB.',
  'no-notes': 'That MIDI file has no notes in it.',
  unsupported: 'That kind of MIDI file is not supported yet.',
  damaged: 'That MIDI file seems to be damaged and could not be read.',
}

type Outcome = { song: Song } | { refused: SongImportErrorCode }

/** Reads a file. Anything but a song or a refusal in the app's own words fails the test. */
function outcomeOf(file: ArrayLike<number>, fileName = 'test.mid'): Outcome {
  let song: Song
  try {
    song = parseMidiFile(file instanceof Uint8Array ? file : Uint8Array.from(file), fileName, {
      id: 'test',
      now: 0,
    })
  } catch (error) {
    if (!(error instanceof SongImportError)) {
      throw new Error(`The importer threw something of its own: ${String(error)}`)
    }
    expect(error.userMessage).toBe(SENTENCES[error.code])
    expect(error.message).toBe(SENTENCES[error.code])
    return { refused: error.code }
  }
  expect(problemsOf(song)).toEqual([])
  return { song }
}

function read(file: ArrayLike<number>, fileName = 'test.mid'): Song {
  const outcome = outcomeOf(file, fileName)
  if ('refused' in outcome) throw new Error(`The file was refused as "${outcome.refused}".`)
  return outcome.song
}

function refusal(file: ArrayLike<number>, fileName = 'test.mid'): string {
  const outcome = outcomeOf(file, fileName)
  return 'refused' in outcome ? outcome.refused : 'not refused'
}

/** What the rest of the app relies on in a song. An empty list means the song is sound. */
function problemsOf(song: Song): string[] {
  const problems: string[] = []
  const check = (fine: boolean, problem: string): void => {
    if (!fine) problems.push(problem)
  }
  check(song.title === cleanTitle(song.title), `untidy title ${JSON.stringify(song.title)}`)
  check(song.tracks.some((part) => !part.isPercussion), 'nothing the piano can play')
  check(
    new Set(song.tracks.map((part) => part.id)).size === song.tracks.length,
    'two parts share an id',
  )

  let count = 0
  let end = 0
  let first = Number.POSITIVE_INFINITY
  for (const part of song.tracks) {
    check(Number.isSafeInteger(part.id) && part.id >= 0, `part id ${part.id}`)
    check(part.notes.length > 0, `part ${part.id} is empty`)
    check(
      part.program === null ||
        (Number.isInteger(part.program) && part.program >= 0 && part.program <= 127),
      `program ${part.program}`,
    )
    count += part.notes.length
    let before: SongNote | undefined
    for (const note of part.notes) {
      check(
        Number.isInteger(note.midi) && note.midi >= 21 && note.midi <= 108,
        `pitch ${note.midi}`,
      )
      check(Number.isFinite(note.time) && note.time >= 0, `time ${note.time}`)
      check(Number.isFinite(note.duration) && note.duration >= 0.03, `length ${note.duration}`)
      check(note.velocity > 0 && note.velocity <= 1, `force ${note.velocity}`)
      check(
        before === undefined ||
          note.time > before.time ||
          (note.time === before.time && note.midi >= before.midi),
        `part ${part.id} is out of order`,
      )
      before = note
      end = Math.max(end, note.time + note.duration)
      if (!part.isPercussion) first = Math.min(first, note.time)
    }
  }
  check(count <= MAX_SONG_NOTES, `${count} notes`)
  check(song.duration === end, `length ${song.duration}, but the last note ends at ${end}`)
  check(first <= 1 + 1e-9, `the first note comes after ${first} s`)
  return problems
}

/** The notes of one part as [pitch, start, length], rounded to a millionth of a second. */
function notesOf(song: Song, part = 0): number[][] {
  const round = (seconds: number): number => Math.round(seconds * 1e6) / 1e6
  const found = song.tracks[part]
  if (!found) throw new Error(`The song has no part number ${part}.`)
  return found.notes.map((note) => [note.midi, round(note.time), round(note.duration)])
}

function noteCount(song: Song): number {
  return song.tracks.reduce((sum, part) => sum + part.notes.length, 0)
}

/* --------------------------------------------------------------- tests */

/** Two tracks with a name, a speed, an instrument, a pedal, running status and a drum. */
const RICH_FILE: number[] = [
  ...header(1, 2, 480),
  ...track([
    ...trackName('A little tune'),
    ...tempo(0, 500_000),
    ...on(0, 72),
    ...off(480, 72),
    ...pedal(0, 127),
    ...on(0, 74),
    // Running status: no status byte, and a note-on with no force for a note-off.
    0x60,
    74,
    0,
    ...pedal(240, 0),
    ...on(0, 38, 90, 9),
    ...off(60, 38, 9),
    ...endOfTrack(),
  ]),
  ...track(
    [...trackName('Left'), ...program(0, 5), ...on(0, 48), ...off(960, 48), ...endOfTrack()],
  ),
]

describe('a file that stops too early', () => {
  it('is read whole when nothing is missing', () => {
    const song = read(RICH_FILE)
    expect(song.title).toBe('A little tune')
    expect(noteCount(song)).toBe(4)
  })

  it('gives a sound song or a plain refusal, wherever it is cut', () => {
    const whole = noteCount(read(RICH_FILE))
    const seen = new Set<string>()
    for (let length = 0; length < RICH_FILE.length; length++) {
      const outcome = outcomeOf(RICH_FILE.slice(0, length))
      if ('refused' in outcome) {
        seen.add(outcome.refused)
        // Only the reasons that can apply to a file cut short.
        expect(['not-midi', 'damaged', 'no-notes']).toContain(outcome.refused)
      } else {
        seen.add('song')
        expect(noteCount(outcome.song)).toBeLessThanOrEqual(whole)
      }
    }
    expect([...seen].sort()).toEqual(['damaged', 'no-notes', 'not-midi', 'song'])
  })

  it('is not taken for a MIDI file before its first four letters are there', () => {
    for (let length = 0; length < 4; length++) {
      expect(refusal(RICH_FILE.slice(0, length))).toBe('not-midi')
    }
    expect(refusal(text('MThd'))).toBe('damaged')
  })

  it('has an answer with any one byte changed to an awkward value', { timeout: 60_000 }, () => {
    // Not a claim about what the answer is: only that there always is one, in the app's words.
    for (let at = 0; at < RICH_FILE.length; at++) {
      for (const value of [0x00, 0x7f, 0x80, 0xff]) {
        const file = [...RICH_FILE]
        file[at] = value
        outcomeOf(file)
      }
    }
  })
})

describe('lengths that are wrong', () => {
  const NOTES = [...on(0, 60), ...off(480, 60), ...endOfTrack()]

  it('reads a track whose length is right', () => {
    expect(notesOf(read(oneTrack(NOTES)))).toEqual([[60, 0, 0.5]])
  })

  it('answers a track that claims every possible wrong length', () => {
    const sizes = [0, 1, 3, 4, 7, NOTES.length - 1, NOTES.length + 1, 0xffff]
    for (const length of [...sizes, 0x7fffffff, 0x80000000, 0xffffffff]) {
      const file = [...header(0, 1, 480), ...text('MTrk'), ...uint32(length), ...NOTES]
      outcomeOf(file)
    }
  })

  it('answers a header that claims every possible wrong length', () => {
    for (const length of [0, 1, 5, 7, 100, 0x7fffffff, 0x80000000, 0xffffffff]) {
      const file = [
        ...text('MThd'), ...uint32(length), ...uint16(0), ...uint16(1), ...uint16(480),
        ...track(NOTES),
      ]
      outcomeOf(file)
    }
  })

  it('answers waits and lengths written with far too many bytes', () => {
    for (const extra of [1, 2, 3, 4, 5, 8, 30]) {
      const long = new Array<number>(extra).fill(0xff)
      outcomeOf(oneTrack([...long, 0x00, 0x90, 60, 100, ...off(480, 60), ...endOfTrack()]))
      outcomeOf(oneTrack([0x00, 0xff, 0x01, ...long, 0x00, ...NOTES]))
      outcomeOf(oneTrack([0x00, 0xf0, ...long, 0x00, ...NOTES]))
    }
  })

  it('refuses a wait that is longer than a MIDI file can write', () => {
    // Five bytes: one more than the format allows.
    const tooLong = [0x81, 0x80, 0x80, 0x80, 0x00]
    expect(
      refusal(oneTrack([...on(0, 60), ...tooLong, 0x80, 60, 0, ...endOfTrack()])),
    ).toBe('damaged')
  })
})

describe('the kinds of MIDI file', () => {
  const ONE_NOTE = [...on(0, 60), ...off(480, 60), ...endOfTrack()]

  it('reads the two usual kinds and says "not supported yet" for the others', () => {
    expect(noteCount(read([...header(0, 1, 480), ...track(ONE_NOTE)]))).toBe(1)
    expect(noteCount(read([...header(1, 1, 480), ...track(ONE_NOTE)]))).toBe(1)
    expect(refusal([...header(2, 1, 480), ...track(ONE_NOTE)])).toBe('unsupported')
    // Time counted in film frames (25 a second, 40 ticks a frame) instead of beats.
    expect(refusal([...header(1, 1, 0xe728), ...track(ONE_NOTE)])).toBe('unsupported')
  })

  it('calls a kind that does not exist damaged', () => {
    expect(refusal([...header(3, 1, 480), ...track(ONE_NOTE)])).toBe('damaged')
    expect(refusal([...header(0xffff, 1, 480), ...track(ONE_NOTE)])).toBe('damaged')
  })

  it('refuses a file whose beat has no ticks', () => {
    expect(refusal([...header(0, 1, 0), ...track(ONE_NOTE)])).toBe('damaged')
  })

  it('finds no notes in a file with no tracks at all', () => {
    expect(refusal(header(1, 0, 480))).toBe('no-notes')
    expect(refusal(header(0, 3, 480))).toBe('no-notes')
  })

  it('finds no notes in tracks that hold nothing, or only words', () => {
    expect(refusal([...header(1, 2, 480), ...track([]), ...track(endOfTrack())])).toBe('no-notes')
    const words = [
      ...trackName('Words only'),
      ...meta(0, 0x01, 'Hello'),
      ...meta(480, 0x05, 'la la'),
      ...endOfTrack(),
    ]
    expect(refusal(oneTrack(words))).toBe('no-notes')
  })

  it('reads a file of the usual kind with several tracks as music played together', () => {
    const song = read([
      ...header(0, 2, 480),
      ...track([...on(0, 60), ...off(480, 60), ...endOfTrack()]),
      ...track([...on(240, 64), ...off(480, 64), ...endOfTrack()]),
    ])
    expect(song.tracks.map((part) => part.id)).toEqual([0, 1])
    expect(notesOf(song, 1)).toEqual([[64, 0.25, 0.5]])
  })
})

describe('files that are not MIDI at all', () => {
  it('says so, in the same plain sentence, for each of them', () => {
    const others: [what: string, bytes: number[]][] = [
      ['nothing at all', []],
      ['a picture', [0x89, ...text('PNG'), 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]],
      ['recorded sound', [...text('ID3'), 3, 0, 0, 0, 0, 0, 0]],
      [
        'a sound file in the same wrapper as some MIDI files',
        [...text('RIFF'), 36, 0, 0, 0, ...text('WAVEfmt ')],
      ],
      ['a web page', text('<!DOCTYPE html><html><body>MThd</body></html>')],
      ['a text file about MIDI', text('This is not MThd, whatever its name says.')],
      ['a MIDI file with something in front of it', [0x00, ...header(0, 1, 480)]],
      ['the right letters in small type', text('mthd\0\0\0\x06\0\0\0\x01\x01\xe0')],
      ['a zip file', [...text('PK'), 3, 4, 20, 0, 0, 0]],
    ]
    for (const [what, bytes] of others) {
      expect(refusal(bytes, 'song.mid'), what).toBe('not-midi')
    }
  })

  it('takes a file by what is in it, not by its name', () => {
    const file = oneTrack([...on(0, 60), ...off(480, 60), ...endOfTrack()])
    expect(read(file, 'holiday-photo.jpg').title).toBe('holiday-photo')
    expect(read(file, '').title).toBe('Untitled song')
  })
})

describe('what the player is told when a file is refused', () => {
  const ONE_NOTE = [...on(0, 60), ...off(480, 60), ...endOfTrack()]

  function sentenceFor(file: ArrayLike<number>): string {
    try {
      parseMidiFile(file instanceof Uint8Array ? file : Uint8Array.from(file), 'test.mid')
    } catch (error) {
      if (error instanceof SongImportError) return error.userMessage
      throw error
    }
    throw new Error('The file was not refused.')
  }

  it('is one of five exact sentences', () => {
    expect(sentenceFor([1, 2, 3])).toBe(SENTENCES['not-midi'])
    expect(sentenceFor(new Uint8Array(MAX_MIDI_BYTES + 1))).toBe(SENTENCES['too-big'])
    expect(sentenceFor(oneTrack(endOfTrack()))).toBe(SENTENCES['no-notes'])
    expect(sentenceFor([...header(2, 1, 480), ...track(ONE_NOTE)])).toBe(SENTENCES.unsupported)
    expect(sentenceFor(oneTrack([0x00, 0x90, 60]))).toBe(SENTENCES.damaged)
  })

  it('never uses a word a casual player would not know', () => {
    const words = ['track', 'tempo', 'bpm', 'byte', 'chunk', 'header', 'parse', 'parsing', 'format']
    words.push('channel', 'tick', 'smpte', 'invalid', 'exception', 'error', 'null', 'undefined')
    const jargon = new RegExp(`\\b(${words.join('|')})\\b`, 'i')
    const codes = Object.keys(SENTENCES) as SongImportErrorCode[]
    expect(codes).toHaveLength(5)
    for (const code of codes) {
      const sentence = new SongImportError(code).userMessage
      expect(sentence).toBe(SENTENCES[code])
      expect(sentence).not.toMatch(jargon)
      // A whole sentence: a capital to start, a full stop to end, nothing shouted.
      expect(sentence).toMatch(/^[A-Z].*\.$/)
      expect(sentence).not.toMatch(/!/)
    }
  })

  it('checks the size before anything else, so a huge file that is not MIDI is "too big"', () => {
    const huge = new Uint8Array(MAX_MIDI_BYTES + 1).fill(0x41)
    expect(refusal(huge)).toBe('too-big')
  })
})

describe('the speed of the music', () => {
  it('follows a change of speed in the middle of a note', () => {
    // 120 beats a minute, then 60 from half-way through the note: 0.25 s + 0.5 s.
    const song = read(
      oneTrack(
        [
          ...on(0, 60), ...tempo(240, 1_000_000), ...off(240, 60), ...on(0, 62), ...off(480, 62),
          ...endOfTrack(),
        ],
      ),
    )
    expect(notesOf(song)).toEqual([
      [60, 0, 0.75],
      [62, 0.75, 1],
    ])
  })

  it('follows several changes inside one long note', () => {
    const song = read(
      oneTrack([
        ...on(0, 60),
        ...tempo(480, 250_000),
        ...tempo(480, 1_000_000),
        ...tempo(480, 500_000),
        ...off(480, 60),
        ...endOfTrack(),
      ]),
    )
    // One beat each at 120, 240, 60 and 120 beats a minute.
    expect(notesOf(song)).toEqual([[60, 0, 0.5 + 0.25 + 1 + 0.5]])
  })

  it('lets a change written in a later track move the notes of an earlier one', () => {
    const song = read([
      ...header(1, 2, 480),
      ...track([...on(0, 60), ...off(960, 60), ...endOfTrack()]),
      ...track([...tempo(480, 1_000_000), ...endOfTrack()]),
    ])
    expect(notesOf(song)).toEqual([[60, 0, 1.5]])
  })

  it('stays a number the app can use whatever speeds the file asks for', () => {
    for (const microseconds of [0, 1, 59_999, 60_000, 0xffffff]) {
      const song = read(
        oneTrack([...tempo(0, microseconds), ...on(0, 60), ...off(480, 60), ...endOfTrack()]),
      )
      expect(song.duration).toBeGreaterThan(0)
      expect(Number.isFinite(song.duration)).toBe(true)
    }
    // Nothing a file asks for makes a beat shorter than 60 ms: notes never pile up at one moment.
    const fastest = read(oneTrack([...tempo(0, 1), ...on(0, 60), ...off(480, 60), ...endOfTrack()]))
    expect(notesOf(fastest)).toEqual([[60, 0, 0.06]])
  })
})

describe('notes', () => {
  it('reads notes written without repeating the status byte', () => {
    // One status byte, then pairs of bytes only; force 0 lets a key go.
    const song = read(
      oneTrack(
        [
          0x00, 0x90, 60, 100, 0x83, 0x60, 60, 0, 0x00, 62, 100, 0x83, 0x60, 62, 0, 0x00, 64, 100,
          0x83, 0x60, 64, 0, ...endOfTrack(),
        ],
      ),
    )
    expect(notesOf(song)).toEqual([
      [60, 0, 0.5],
      [62, 0.5, 0.5],
      [64, 1, 0.5],
    ])
  })

  it('ends a note that is never let go where its track ends', () => {
    const song = read(oneTrack([...on(0, 60), ...on(480, 62), ...off(480, 62), ...endOfTrack(960)]))
    expect(notesOf(song)).toEqual([
      [60, 0, 2],
      [62, 0.5, 0.5],
    ])
  })

  it('ends a note where the same key is struck again', () => {
    const song = read(oneTrack([...on(0, 60), ...on(480, 60), ...off(480, 60), ...endOfTrack()]))
    expect(notesOf(song)).toEqual([
      [60, 0, 0.5],
      [60, 0.5, 0.5],
    ])
  })

  /*
   * Some programs write, at the moment a key is struck again, the new note-on
   * BEFORE the note-off of the note it replaces:
   *     on C at 0 | on C at 480, off C at 480 | off C at 960
   * The file means two notes of one beat each. The note-off at 480 belongs to
   * the first note, which ends there; the second sounds until 960.
   */
  it('gives a struck-again note its full length when it is written before the old note-off', () => {
    const song = read(
      oneTrack([...on(0, 60), ...on(480, 60), ...off(0, 60), ...off(480, 60), ...endOfTrack()]),
    )
    expect(notesOf(song)).toEqual([
      [60, 0, 0.5],
      [60, 0.5, 0.5],
    ])
  })

  it('gives a note with no length a short one, so it is still heard', () => {
    const song = read(
      oneTrack([...on(0, 60), ...off(0, 60), ...on(480, 62), ...off(0, 62), ...endOfTrack()]),
    )
    expect(notesOf(song)).toEqual([
      [60, 0, 0.03],
      [62, 0.5, 0.03],
    ])
  })

  it('leaves out the pitches a piano does not have, and their note-offs', () => {
    const song = read(
      oneTrack(
        [
          ...on(0, 20), ...on(0, 21), ...on(0, 108), ...on(0, 109), ...off(480, 20), ...off(0, 21),
          ...off(0, 108), ...off(0, 109), ...endOfTrack(),
        ],
      ),
    )
    expect(notesOf(song).map(([midi]) => midi)).toEqual([21, 108])
  })

  it('takes exactly the largest song and refuses one note more', { timeout: 60_000 }, () => {
    const notes = (count: number): number[] => {
      const events: number[] = [0x00, 0x90]
      for (let index = 0; index < count; index++) {
        const midi = 21 + (index % 88)
        if (index > 0) events.push(0x00)
        events.push(midi, 100, 0x01, midi, 0)
      }
      return oneTrack([...events, ...endOfTrack()])
    }
    expect(noteCount(read(notes(MAX_SONG_NOTES)))).toBe(MAX_SONG_NOTES)
    expect(refusal(notes(MAX_SONG_NOTES + 1))).toBe('unsupported')
  })
})

describe('the sustain pedal', () => {
  it('keeps each note sounding until the pedal comes up, across several notes', () => {
    const song = read(
      oneTrack([
        ...pedal(0, 127),
        ...on(0, 60),
        ...off(240, 60),
        ...on(0, 64),
        ...off(240, 64),
        ...on(0, 67),
        ...off(240, 67),
        ...pedal(240, 0),
        ...on(0, 72),
        ...off(240, 72),
        ...endOfTrack(),
      ]),
    )
    expect(notesOf(song)).toEqual([
      [60, 0, 1],
      [64, 0.25, 0.75],
      [67, 0.5, 0.5],
      // Played after the pedal came up: its own length.
      [72, 1, 0.25],
    ])
  })

  it('stops a note the pedal holds when the same key is struck again', () => {
    const song = read(
      oneTrack(
        [
          ...pedal(0, 100), ...on(0, 60), ...off(120, 60), ...on(360, 60), ...off(120, 60),
          ...pedal(360, 0), ...endOfTrack(),
        ],
      ),
    )
    expect(notesOf(song)).toEqual([
      [60, 0, 0.5],
      [60, 0.5, 0.5],
    ])
  })

  it('does nothing to notes when it goes down and up between them', () => {
    const song = read(
      oneTrack(
        [
          ...on(0, 60), ...off(480, 60), ...pedal(0, 127), ...pedal(240, 0), ...on(240, 62),
          ...off(480, 62), ...endOfTrack(),
        ],
      ),
    )
    expect(notesOf(song)).toEqual([
      [60, 0, 0.5],
      [62, 1, 0.5],
    ])
  })

  it('holds the notes of its own channel only', () => {
    const song = read(
      oneTrack(
        [
          ...pedal(0, 127, 1), ...on(0, 60, 100, 0), ...on(0, 62, 100, 1), ...off(240, 60, 0),
          ...off(0, 62, 1), ...pedal(720, 0, 1), ...endOfTrack(),
        ],
      ),
    )
    expect(
      song.tracks.map((part) => notesOf(song, song.tracks.indexOf(part))),
    ).toEqual([[[60, 0, 0.25]], [[62, 0, 1]]])
  })
})

describe('drums', () => {
  const drums = (delta: number, midi: number): number[] => [
    ...on(delta, midi, 100, 9),
    ...off(60, midi, 9),
  ]

  it('refuses a song that has nothing but drums', () => {
    expect(
      refusal(oneTrack([...drums(0, 36), ...drums(420, 38), ...endOfTrack()])),
    ).toBe('no-notes')
  })

  it('keeps drums as a part of their own that is never played', () => {
    const song = read(
      oneTrack([...drums(0, 36), ...on(0, 60), ...off(480, 60), ...drums(0, 38), ...endOfTrack()]),
    )
    const drumPart = song.tracks.find((part) => part.isPercussion)
    expect(drumPart?.notes).toHaveLength(2)

    expect(
      selectedTracks(song, DEFAULT_ARRANGE_OPTIONS).map((part) => part.isPercussion),
    ).toEqual([false])
    const everything = { ...DEFAULT_ARRANGE_OPTIONS, trackIds: song.tracks.map((part) => part.id) }
    const played = arrange(song, everything, { first: 21, last: 108 })
    expect(played.notes.map((note) => note.midi)).toEqual([60])
  })

  it('does not make the player wait through a drum introduction', () => {
    const song = read(
      oneTrack(
        [
          ...drums(0, 36), ...drums(900, 36), ...drums(900, 36), ...drums(900, 36), ...on(900, 60),
          ...off(480, 60), ...endOfTrack(),
        ],
      ),
    )
    const piano = song.tracks.find((part) => !part.isPercussion)
    expect(piano?.notes[0]?.time).toBeCloseTo(1, 9)
  })
})

describe('waits of enormous length', () => {
  const LONGEST_WAIT = 0x0fffffff

  it('reads the longest wait a file can write, and keeps every time a usable number', () => {
    const song = read(
      oneTrack(
        [
          ...on(0, 60), ...off(480, 60), ...on(LONGEST_WAIT, 62), ...off(LONGEST_WAIT, 62),
          ...endOfTrack(LONGEST_WAIT),
        ],
      ),
    )
    expect(Number.isFinite(song.duration)).toBe(true)
    expect(noteCount(song)).toBe(2)
  })

  it('cuts a long silence before the first note down to one second', () => {
    const song = read(oneTrack([...on(LONGEST_WAIT, 60), ...off(480, 60), ...endOfTrack()]))
    expect(notesOf(song)).toEqual([[60, 1, 0.5]])
    expect(song.duration).toBeCloseTo(1.5, 6)
  })

  it('stays exact with the slowest speed and the longest waits together', () => {
    const events = [...tempo(0, 0xffffff)]
    for (let index = 0; index < 200; index++) {
      events.push(...on(LONGEST_WAIT, 60), ...off(LONGEST_WAIT, 60))
    }
    const song = read(oneTrack([...events, ...endOfTrack()], 1))
    expect(noteCount(song)).toBe(200)
    expect(Number.isFinite(song.duration)).toBe(true)
  })
})

describe('files made to hurt', () => {
  /** A file as large as is allowed: `start`, then `repeated` as often as it fits, in one track. */
  function filled(start: readonly number[], repeated: readonly number[]): Uint8Array {
    const room = MAX_MIDI_BYTES - 22 - start.length
    const length = start.length + Math.floor(room / repeated.length) * repeated.length
    const file = new Uint8Array(22 + length)
    file.set([...header(0, 1, 480), ...text('MTrk'), ...uint32(length), ...start])
    for (let at = 22 + start.length; at < file.length; at += repeated.length) file.set(repeated, at)
    return file
  }

  function timed(file: ArrayLike<number>): { answer: string; milliseconds: number } {
    const started = performance.now()
    const outcome = outcomeOf(file)
    const milliseconds = performance.now() - started
    return { answer: 'refused' in outcome ? outcome.refused : 'song', milliseconds }
  }

  // The limits below are far above what these take (a fifth of a second to half a second each
  // on a laptop): they are there to catch a file that freezes the page, not to time the importer.
  it('refuses 200,000 notes at once', { timeout: 120_000 }, () => {
    const events: number[] = [0x00, 0x90, 60, 100]
    for (let index = 0; index < 200_000; index++) {
      events.push(0x10, 60 + (index % 12), 0, 0x00, 60 + ((index + 1) % 12), 100)
    }
    const { answer, milliseconds } = timed(oneTrack([...events, ...endOfTrack()]))
    expect(answer).toBe('unsupported')
    expect(milliseconds).toBeLessThan(10_000)
  })

  it('answers the largest files quickly, whatever is in them', { timeout: 300_000 }, () => {
    const files: [what: string, expected: string, file: Uint8Array][] = [
      [
        'the pedal going up and down for ever',
        'no-notes',
        filled([], [0x00, 0xb0, 64, 127, 0x00, 0xb0, 64, 0]),
      ],
      [
        'nothing but changes of speed',
        'no-notes',
        filled([], [0x01, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20]),
      ],
      ['the shortest events there are', 'no-notes', filled([0x00, 0xc0, 0x01], [0x00, 0x01])],
      ['one endless run of high bytes', 'damaged', filled([], [0xff])],
      ['one endless run of zeros', 'damaged', filled([], [0x00])],
      [
        'one note, then changes of speed to the end',
        'song',
        filled([...on(0, 60), ...off(480, 60)], [0x01, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20]),
      ],
      [
        'a sixteen-note chord struck over and over',
        'unsupported',
        filled([0x00, 0x90, 60, 100], [0x00, 61, 100, 0x00, 62, 100, 0x01, 60, 100]),
      ],
    ]
    for (const [what, expected, file] of files) {
      const { answer, milliseconds } = timed(file)
      expect(answer, what).toBe(expected)
      expect(milliseconds, what).toBeLessThan(10_000)
    }
  })

  it('answers a small file of tens of thousands of tracks quickly', { timeout: 120_000 }, () => {
    const parts: number[] = header(1, 0xffff, 480)
    for (let index = 0; index < 20_000; index++) {
      const midi = 60 + (index % 12)
      parts.push(...track([...on(index % 100, midi), ...off(10, midi)]))
    }
    const { answer, milliseconds } = timed(parts)
    expect(answer).toBe('song')
    expect(milliseconds).toBeLessThan(10_000)
  })

  it('does not search for ever in a wrapper that holds no MIDI', () => {
    const file = new Uint8Array(MAX_MIDI_BYTES)
    file.set([...text('RIFF'), 0, 0, 0, 0, ...text('RMID')])
    const { answer, milliseconds } = timed(file)
    expect(answer).toBe('not-midi')
    expect(milliseconds).toBeLessThan(10_000)
  })
})

/* ----------------------------------------------------------------------
 * A second reading of the music, written to be obviously right rather than
 * fast: for every note-on it walks forward through the file to find where
 * that one note stops. The importer follows all notes at once instead.
 * The two must agree on every random file.
 * -------------------------------------------------------------------- */

interface FileEvent {
  delta: number
  kind: 'on' | 'off' | 'pedal' | 'tempo' | 'program' | 'name' | 'words'
  channel: number
  /** Pitch, pedal value, microseconds a beat or instrument number. */
  value: number
  velocity: number
  name: string
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let mixed = state
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1)
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61)
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296
  }
}

function pick<Item>(random: () => number, items: readonly Item[]): Item {
  const item = items[Math.floor(random() * items.length)]
  if (item === undefined) throw new Error('Nothing to pick from.')
  return item
}

const PITCHES = [20, 21, 40, 60, 60, 60, 62, 64, 64, 108, 109]
const CHANNELS = [0, 0, 0, 1, 9]
const WAITS = [0, 0, 0, 1, 7, 60, 120, 480, 2000]
const SPEEDS = [0, 30_000, 250_000, 500_000, 1_000_000, 0xffffff]
const NAMES = ['Right hand', 'Melody', 'Track 3', 'Piano', '', 'Bass line']

function randomTrack(random: () => number): FileEvent[] {
  const events: FileEvent[] = []
  const length = Math.floor(random() * 40)
  for (let index = 0; index < length; index++) {
    const roll = random()
    const event: FileEvent = {
      delta: pick(random, WAITS),
      kind: 'on',
      channel: pick(random, CHANNELS),
      value: 0,
      velocity: 0,
      name: '',
    }
    if (roll < 0.4) {
      event.value = pick(random, PITCHES)
      // Now and then a note-on with no force, which lets the key go.
      event.velocity = random() < 0.1 ? 0 : 1 + Math.floor(random() * 127)
    } else if (roll < 0.7) {
      event.kind = 'off'
      event.value = pick(random, PITCHES)
    } else if (roll < 0.85) {
      event.kind = 'pedal'
      event.value = pick(random, [0, 63, 64, 127])
    } else if (roll < 0.92) {
      event.kind = 'tempo'
      event.value = pick(random, SPEEDS)
    } else if (roll < 0.96) {
      event.kind = 'program'
      event.value = Math.floor(random() * 128)
    } else if (roll < 0.98) {
      event.kind = 'name'
      event.name = pick(random, NAMES)
    } else {
      event.kind = 'words'
      event.name = 'la'
    }
    events.push(event)
  }
  return events
}

function bytesOfTrack(events: readonly FileEvent[], lastWait: number): number[] {
  const out: number[] = []
  for (const event of events) {
    if (event.kind === 'on') {
      out.push(...on(event.delta, event.value, event.velocity, event.channel))
    }
    else if (event.kind === 'off') out.push(...off(event.delta, event.value, event.channel))
    else if (event.kind === 'pedal') out.push(...pedal(event.delta, event.value, event.channel))
    else if (event.kind === 'tempo') out.push(...tempo(event.delta, event.value))
    else if (event.kind === 'program') out.push(...program(event.delta, event.value, event.channel))
    else out.push(...meta(event.delta, event.kind === 'name' ? 0x03 : 0x05, event.name))
  }
  return track([...out, ...endOfTrack(lastWait)])
}

interface Placed extends FileEvent {
  tick: number
  track: number
}

interface ExpectedNote {
  track: number
  channel: number
  midi: number
  time: number
  duration: number
  velocity: number
}

interface ExpectedPart {
  id: number
  isPercussion: boolean
  program: number | null
  notes: [midi: number, time: number, duration: number, velocity: number][]
}

interface SlowReading {
  parts: ExpectedPart[]
  duration: number
  /**
   * True when somewhere in the file a key that is down is struck again and a
   * note-off for it follows at the very same moment. Which of the two notes
   * that note-off ends has a test of its own (in 'notes', above); here the
   * lengths of the notes of such a file are left out of the comparison.
   */
  restruckAtOnce: boolean
}

/** The slow reading. Returns null when the piano has nothing to play. */
function slowReading(
  tracks: readonly FileEvent[][],
  lastWaits: readonly number[],
  division: number,
): SlowReading | null {
  // Everything in one line, in time order; events of one moment stay in file order.
  const placed: Placed[] = []
  const trackEnds: number[] = []
  tracks.forEach((events, trackIndex) => {
    let tick = 0
    for (const event of events) {
      tick += event.delta
      placed.push({ ...event, tick, track: trackIndex })
    }
    trackEnds.push(tick + (lastWaits[trackIndex] ?? 0))
  })
  const line = placed.map((event, index) => ({ event, index })).sort(
    (a, b) => a.event.tick - b.event.tick || a.index - b.index,
  ).map(({ event }) => event)

  const onPiano = (event: Placed): boolean => event.value >= 21 && event.value <= 108
  const isPress = (event: Placed): boolean =>
    event.kind === 'on' && event.velocity > 0 && onPiano(event)
  const isRelease = (event: Placed): boolean =>
    (event.kind === 'off' || (event.kind === 'on' && event.velocity === 0)) && onPiano(event)

  // From ticks to seconds, by walking every change of speed up to that tick.
  const speedChanges = line.filter((event) => event.kind === 'tempo' && event.value !== 0)
  const secondsAt = (tick: number): number => {
    let seconds = 0
    let from = 0
    let microseconds = 500_000
    for (const change of speedChanges) {
      if (change.tick > tick) break
      seconds += ((change.tick - from) * microseconds) / 1e6 / division
      from = change.tick
      microseconds = Math.max(change.value, 60_000)
    }
    return seconds + ((tick - from) * microseconds) / 1e6 / division
  }

  const notes: ExpectedNote[] = []
  let restruckAtOnce = false
  line.forEach((press, at) => {
    if (!isPress(press)) return
    const isSameKey = (event: Placed): boolean =>
      event.track === press.track && event.channel === press.channel && event.value === press.value

    // Was this key already down when it was struck, and is it let go at that same moment?
    const ofKey = (event: Placed): boolean => isSameKey(event) && onPiano(event)
    const lastOfKey = line.slice(0, at).reverse().find(ofKey)
    if (lastOfKey !== undefined && isPress(lastOfKey)) {
      const nextOfKey = line.slice(at + 1).find(ofKey)
      if (nextOfKey && isRelease(nextOfKey) && nextOfKey.tick === press.tick) restruckAtOnce = true
    }

    // Is the pedal of this note's channel down when event `index` happens?
    const pedalDownBefore = (index: number): boolean => {
      let down = false
      for (let earlier = 0; earlier < index; earlier++) {
        const event = line[earlier]
        if (event && event.kind === 'pedal' && event.channel === press.channel) {
          down = event.value >= 64
        }
      }
      return down
    }
    let keyDown = true
    let endTick: number | null = null
    for (let index = at + 1; index < line.length && endTick === null; index++) {
      const event = line[index]
      if (!event) continue
      const samePitch = event.channel === press.channel && event.value === press.value
      const sameKey = samePitch && event.track === press.track
      if (isPress(event) && ((keyDown && sameKey) || (!keyDown && samePitch))) endTick = event.tick
      else if (isRelease(event) && keyDown && sameKey) {
        if (pedalDownBefore(index)) keyDown = false
        else endTick = event.tick
      } else if (event.kind === 'pedal' && event.channel === press.channel) {
        // The pedal comes up: a note it was holding stops.
        if (event.value < 64 && !keyDown) endTick = event.tick
      }
    }
    const time = secondsAt(press.tick)
    const end = secondsAt(endTick ?? trackEnds[press.track] ?? press.tick)
    notes.push({
      track: press.track,
      channel: press.channel,
      midi: press.value,
      time,
      duration: Math.max(end - time, 0.03),
      velocity: press.velocity / 127,
    })
  })

  if (!notes.some((note) => note.channel !== 9)) return null

  // The long silence before the first note the piano plays is cut to one second.
  const firstPitched = Math.min(
    ...notes.filter((note) => note.channel !== 9).map((note) => note.time),
  )
  const cut = Math.max(firstPitched - 1, 0)
  const kept = notes.filter((note) => note.time >= cut).map(
    (note) => ({ ...note, time: note.time - cut }),
  )

  const parts: ExpectedPart[] = []
  tracks.forEach((events, trackIndex) => {
    const channels = [
      ...new Set(notes.filter((note) => note.track === trackIndex).map((note) => note.channel)),
    ].sort((a, b) => a - b)
    for (const channel of channels) {
      const own = kept.filter((note) => note.track === trackIndex && note.channel === channel)
      if (own.length === 0) continue
      const firstProgram = events.find(
        (event) => event.kind === 'program' && event.channel === channel,
      )
      parts.push({
        id: channels.length > 1 ? tracks.length + trackIndex * 16 + channel : trackIndex,
        isPercussion: channel === 9,
        program: firstProgram ? firstProgram.value : null,
        notes: own.map(
          (note): [number, number, number, number] => [
            note.midi,
            note.time,
            note.duration,
            note.velocity,
          ],
        ).sort(byTimePitchLength),
      })
    }
  })
  const duration = Math.max(...kept.map((note) => note.time + note.duration))
  return { parts, duration, restruckAtOnce }
}

function byTimePitchLength(a: readonly number[], b: readonly number[]): number {
  return (a[1] ?? 0) - (b[1] ?? 0) || (a[0] ?? 0) - (b[0] ?? 0) || (a[2] ?? 0) - (b[2] ?? 0)
}

describe('the importer and a slow second reading of the same file', () => {
  it('agree on every note of 1,000 random files', { timeout: 60_000 }, () => {
    const random = seededRandom(20_240_611)
    let songs = 0
    let notesCompared = 0
    let lengthsCompared = 0
    for (let round = 0; round < 1000; round++) {
      const trackCount = 1 + Math.floor(random() * 3)
      const tracks = Array.from({ length: trackCount }, () => randomTrack(random))
      const lastWaits = tracks.map(() => pick(random, WAITS))
      const division = pick(random, [1, 96, 480, 0x7fff])
      const file = [
        ...header(trackCount === 1 ? 0 : 1, trackCount, division),
        ...tracks.flatMap((events, index) => bytesOfTrack(events, lastWaits[index] ?? 0)),
      ]

      const expected = slowReading(tracks, lastWaits, division)
      const outcome = outcomeOf(file)
      if (expected === null) {
        expect(outcome, `file ${round}`).toEqual({ refused: 'no-notes' })
        continue
      }
      if ('refused' in outcome) {
        throw new Error(`File ${round} was refused as "${outcome.refused}".`)
      }
      songs += 1

      const { song } = outcome
      expect(
        song.tracks.map((part) => [part.id, part.isPercussion, part.program]),
        `parts of file ${round}`,
      ).toEqual(expected.parts.map((part) => [part.id, part.isPercussion, part.program]))
      song.tracks.forEach((part, index) => {
        const want = expected.parts[index]?.notes ?? []
        const got = part.notes.map(
          (note): number[] => [note.midi, note.time, note.duration, note.velocity],
        ).sort(byTimePitchLength)
        expect(got.length, `file ${round}, part ${part.id}`).toBe(want.length)
        got.forEach((note, at) => {
          const other = want[at] ?? []
          expect(note[0], `file ${round}, part ${part.id}, note ${at}: pitch`).toBe(other[0])
          expect(
            note[1],
            `file ${round}, part ${part.id}, note ${at}: start`,
          ).toBeCloseTo(other[1] ?? -1, 6)
          notesCompared += 1
          // Two notes of one pitch at one moment are told apart by their length only.
          if (expected.restruckAtOnce) return
          expect(
            note[2],
            `file ${round}, part ${part.id}, note ${at}: length`,
          ).toBeCloseTo(other[2] ?? -1, 6)
          expect(
            note[3],
            `file ${round}, part ${part.id}, note ${at}: force`,
          ).toBeCloseTo(other[3] ?? -1, 9)
          lengthsCompared += 1
        })
      })
      if (!expected.restruckAtOnce) {
        expect(song.duration, `length of file ${round}`).toBeCloseTo(expected.duration, 6)
      }
    }
    // The comparison is worth something only if most files were songs with notes in them.
    expect(songs).toBeGreaterThan(500)
    expect(notesCompared).toBeGreaterThan(4000)
    expect(lengthsCompared).toBeGreaterThan(3000)
  })
})
