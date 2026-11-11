/**
 * The one line that turns bus events into sound (src/app/pianoApp.ts), tried
 * from the outside: what the engine is told for every kind of bus traffic.
 * Tone.js is never loaded here: the engine is only started in the last test,
 * with a stand-in that fails, to see that the wiring survives it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_VELOCITY } from '../core/noteBus'
import { bus, engine } from './pianoApp'

vi.mock('tone', () => {
  throw new Error('Tone.js is not available in this test')
})

afterEach(() => {
  bus.allOff()
  engine.dispose()
  vi.restoreAllMocks()
})

function watchEngine() {
  return {
    noteOn: vi.spyOn(engine, 'noteOn'),
    noteOff: vi.spyOn(engine, 'noteOff'),
    start: vi.spyOn(engine, 'start'),
    allNotesOff: vi.spyOn(engine, 'allNotesOff'),
  }
}

describe('bus -> engine', () => {
  it('starts a note with its strength and stops it, once each', () => {
    const calls = watchEngine()
    bus.noteOn(60, 'keyboard', { velocity: 0.35 })
    expect(calls.noteOn.mock.calls).toEqual([[60, 0.35]])
    expect(calls.noteOff).not.toHaveBeenCalled()

    bus.noteOff(60, 'keyboard')
    expect(calls.noteOff.mock.calls).toEqual([[60]])
    expect(calls.noteOn).toHaveBeenCalledTimes(1)
  })

  it('uses the usual strength when the input gives none, and keeps it between 0 and 1', () => {
    const calls = watchEngine()
    bus.noteOn(60, 'pointer')
    bus.noteOn(62, 'pointer', { velocity: 9 })
    bus.noteOn(64, 'pointer', { velocity: -2 })
    bus.noteOn(65, 'pointer', { velocity: Number.NaN })
    expect(calls.noteOn.mock.calls).toEqual([
      [60, DEFAULT_VELOCITY],
      [62, 1],
      [64, 0],
      [65, DEFAULT_VELOCITY],
    ])
  })

  it('strikes the note again for a second input, and stops it only when both have let go', () => {
    const calls = watchEngine()
    bus.noteOn(60, 'keyboard', { velocity: 0.5 })
    bus.noteOn(60, 'pointer', { velocity: 0.9 })
    expect(calls.noteOn.mock.calls).toEqual([
      [60, 0.5],
      [60, 0.9],
    ])

    bus.noteOff(60, 'keyboard')
    expect(calls.noteOff).not.toHaveBeenCalled()
    bus.noteOff(60, 'pointer')
    expect(calls.noteOff.mock.calls).toEqual([[60]])
  })

  it('does not pass on a repeated press or a stray release', () => {
    const calls = watchEngine()
    bus.noteOn(60, 'keyboard')
    bus.noteOn(60, 'keyboard')
    bus.noteOff(61, 'keyboard')
    bus.noteOff(60, 'pointer')
    expect(calls.noteOn).toHaveBeenCalledTimes(1)
    expect(calls.noteOff).not.toHaveBeenCalled()
  })

  it('stops every held note when the bus lets go of everything', () => {
    const calls = watchEngine()
    for (const midi of [60, 64, 67]) bus.noteOn(midi, 'keyboard')
    bus.noteOn(72, 'pointer')
    bus.allOff()
    expect(calls.noteOff.mock.calls.map(([midi]) => midi).sort()).toEqual([60, 64, 67, 72])
    // Sustained notes are the engine's business: the bus never silences them itself.
    expect(calls.allNotesOff).not.toHaveBeenCalled()
  })

  it('never starts audio by itself: only a click or key press may', () => {
    const calls = watchEngine()
    bus.noteOn(60, 'keyboard')
    bus.noteOff(60, 'keyboard')
    bus.allOff()
    expect(calls.start).not.toHaveBeenCalled()
    expect(engine.getStatus()).toBe('idle')
  })

  it('keeps the bus working for everyone else when the engine cannot start', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const heard: string[] = []
    const stopListening = bus.subscribe((event) => heard.push(`${event.type} ${event.midi}`))
    await engine.start()
    expect(engine.getStatus()).toBe('error')

    expect(() => {
      bus.noteOn(60, 'keyboard')
      bus.noteOff(60, 'keyboard')
    }).not.toThrow()
    expect(heard).toEqual(['on 60', 'off 60'])
    expect(bus.getActiveNotes().size).toBe(0)
    stopListening()
  })
})
