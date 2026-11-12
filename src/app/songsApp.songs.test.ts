/**
 * The whole way a song travels in the app, with no screen: the bytes of a
 * MIDI file are imported, saved in the app's library, read back, arranged
 * for a piano and played by the app's player onto the app's note bus.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_BASE_OCTAVE, pianoRange } from '../core/layout'
import type { NoteEvent } from '../core/types'
import { arrange } from '../songs/arrange'
import { parseMidiFile } from '../songs/midiImport'
import { DEFAULT_ARRANGE_OPTIONS } from '../songs/song'
import type { Arrangement } from '../songs/song'
import { STARTER_SONGS } from '../songs/starterSongs'
import { bus } from './pianoApp'
import { player, songLibrary } from './songsApp'

/**
 * A small MIDI file made in code: the name of the song on a first track that
 * plays nothing, then a scale for the right hand, held notes for the left, a drum.
 */
function scaleFile(): Uint8Array {
  const text = (value: string): number[] => Array.from(
    value,
    (character) => character.charCodeAt(0),
  )
  const chunk = (id: string, data: number[]): number[] => [
    ...text(id), 0, 0, (data.length >> 8) & 0xff, data.length & 0xff, ...data,
  ]
  const end = [0x00, 0xff, 0x2f, 0x00]

  const name: number[] = [0x00, 0xff, 0x03, 5, ...text('Scale')]
  const right: number[] = []
  for (const midi of [60, 62, 64, 65, 67, 69, 71, 72]) {
    right.push(0x00, 0x90, midi, 90, 0x78, 0x80, midi, 0)
  }
  const left: number[] = [
    0x00, 0x91, 36, 70, 0x00, 0x99, 38, 100, 0x83, 0x60, 0x81, 36, 0, 0x00, 0x91, 43, 70, 0x83,
    0x60, 0x81, 43, 0, 0x00, 0x89, 38, 0,
  ]
  return Uint8Array.from(
    [
      ...chunk('MThd', [0, 1, 0, 3, 0x01, 0xe0]),
      ...chunk('MTrk', [...name, ...end]),
      ...chunk('MTrk', [...right, ...end]),
      ...chunk('MTrk', [...left, ...end]),
    ],
  )
}

let heard: NoteEvent[] = []
let stopListening: () => void = () => undefined

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'performance'] })
  heard = []
  stopListening = bus.subscribe((event) => heard.push(event))
})

afterEach(() => {
  stopListening()
  player.unload()
  player.setSpeed(1)
  bus.allOff()
  for (const song of songLibrary.list()) songLibrary.remove(song.id)
  vi.useRealTimers()
})

/** Plays what is loaded to its end. Returns how long that took on the clock, in milliseconds. */
function playToTheEnd(): number {
  const started = performance.now()
  player.play()
  for (let waited = 0; player.getState().status === 'playing'; waited += 100) {
    if (waited > 600_000) throw new Error('The song did not end.')
    vi.advanceTimersByTime(100)
  }
  return performance.now() - started
}

function expectPlayedInFull(arrangement: Arrangement): void {
  const ons = heard.filter((event) => event.type === 'on')
  const offs = heard.filter((event) => event.type === 'off')
  expect(ons.map((event) => event.midi)).toEqual(arrangement.notes.map((note) => note.midi))
  expect(offs).toHaveLength(ons.length)
  expect(heard.every((event) => event.source === 'playback')).toBe(true)
  expect([...bus.getActiveNotes()]).toEqual([])
  expect(player.getState()).toMatchObject({ status: 'stopped', position: 0 })
}

describe('a MIDI file, from its bytes to the keys of the piano', () => {
  it('is imported, saved, read back, arranged and played to its last note', () => {
    const imported = parseMidiFile(scaleFile(), 'my-scale.mid')
    expect(imported.title).toBe('Scale')
    songLibrary.add(imported)

    const saved = songLibrary.get(imported.id)
    if (saved === null) throw new Error('The song was not saved.')
    const piano = pianoRange(37, DEFAULT_BASE_OCTAVE)
    const arrangement = arrange(saved, songLibrary.getOptions(saved.id), piano)
    // Eight notes of the scale and two of the left hand; the drum is never played.
    expect(arrangement.notes).toHaveLength(10)
    // The left hand is below the smallest piano: it still plays, and the player is told how many.
    expect(arrangement.offPianoCount).toBe(2)

    player.load(saved, arrangement)
    const took = playToTheEnd()
    expectPlayedInFull(arrangement)
    expect(took).toBeGreaterThanOrEqual(arrangement.duration * 1000)
    expect(took).toBeLessThanOrEqual(arrangement.duration * 1000 + 100)
    // As loud as the file says.
    const first = heard[0]
    expect(first?.type === 'on' ? first.velocity : 0).toBeCloseTo(70 / 127, 9)
  })

  it('is played with every note on the piano when it is fitted to it', () => {
    const song = parseMidiFile(scaleFile(), 'my-scale.mid')
    const piano = pianoRange(37, DEFAULT_BASE_OCTAVE)
    const arrangement = arrange(song, { ...DEFAULT_ARRANGE_OPTIONS, fitToPiano: true }, piano)
    expect(arrangement.offPianoCount).toBe(0)

    player.load(song, arrangement)
    playToTheEnd()
    expectPlayedInFull(arrangement)
    for (const event of heard) {
      expect(event.midi).toBeGreaterThanOrEqual(piano.first)
      expect(event.midi).toBeLessThanOrEqual(piano.last)
    }
  })

  it('takes two thirds of the time at the fastest speed, and twice the time at the slowest', () => {
    const song = parseMidiFile(scaleFile(), 'my-scale.mid')
    const arrangement = arrange(song, DEFAULT_ARRANGE_OPTIONS, { first: 21, last: 108 })
    for (const speed of [1.5, 0.5]) {
      heard = []
      player.load(song, arrangement)
      player.setSpeed(speed)
      const took = playToTheEnd()
      expectPlayedInFull(arrangement)
      expect(took).toBeGreaterThanOrEqual((arrangement.duration / speed) * 1000)
      expect(took).toBeLessThanOrEqual((arrangement.duration / speed) * 1000 + 100)
    }
  })

  it('stops sounding at once when its song is deleted and taken out of the player', () => {
    const song = parseMidiFile(scaleFile(), 'my-scale.mid')
    songLibrary.add(song)
    const saved = songLibrary.get(song.id)
    if (saved === null) throw new Error('The song was not saved.')
    player.load(saved, arrange(saved, DEFAULT_ARRANGE_OPTIONS, { first: 21, last: 108 }))
    player.play()
    vi.advanceTimersByTime(300)
    expect(bus.getActiveNotes().size).toBeGreaterThan(0)

    songLibrary.remove(song.id)
    player.unload()
    expect([...bus.getActiveNotes()]).toEqual([])
    expect(songLibrary.get(song.id)).toBeNull()
    heard = []
    vi.advanceTimersByTime(5000)
    expect(heard).toEqual([])
  })
})

describe('the built-in songs in the app', () => {
  for (const song of STARTER_SONGS) {
    it(`"${song.title}" plays every one of its notes, once, and ends with no key down`, () => {
      const arrangement = arrange(
        song,
        songLibrary.getOptions(song.id),
        pianoRange(37, DEFAULT_BASE_OCTAVE),
      )
      player.load(song, arrangement)
      const took = playToTheEnd()
      expectPlayedInFull(arrangement)
      expect(
        heard.filter((event) => event.type === 'on'),
      ).toHaveLength(song.tracks[0]?.notes.length ?? -1)
      expect(Math.abs(took - song.duration * 1000)).toBeLessThanOrEqual(100)
    })
  }

  it('can be played along with: the person and the song do not get in each other\'s way', () => {
    const song = STARTER_SONGS[0]
    if (!song) throw new Error('No built-in songs.')
    const arrangement = arrange(song, DEFAULT_ARRANGE_OPTIONS, pianoRange(37, DEFAULT_BASE_OCTAVE))
    player.load(song, arrangement)
    player.play()
    // The person holds middle C, which is also the first note of the song.
    bus.noteOn(60, 'keyboard')
    vi.advanceTimersByTime(2000)
    expect(bus.isActive(60)).toBe(true)

    player.stop()
    expect([...bus.getActiveNotes()]).toEqual([60])
    bus.noteOff(60, 'keyboard')
    expect([...bus.getActiveNotes()]).toEqual([])
  })
})
