import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_BASE_OCTAVE,
  MAX_BASE_OCTAVE,
  MIN_BASE_OCTAVE,
  SLOT_COUNT,
  clampBaseOctave,
  isValidSlot,
  midiToSlot,
  slotToMidi,
} from './layout'
import { NoteBus } from './noteBus'
import {
  MIDI_MAX,
  isBlackKey,
  isValidMidi,
  midiOfC,
  noteName,
  octaveOf,
  pitchClass,
  pitchName,
  toneName,
} from './notes'
import type { NoteEvent } from './types'

describe('notes', () => {
  it('names middle C and its neighbours', () => {
    expect(noteName(60)).toBe('C4')
    expect(noteName(61)).toBe('C♯4')
    expect(noteName(59)).toBe('B3')
    expect(noteName(21)).toBe('A0')
    expect(noteName(108)).toBe('C8')
  })

  it('names notes in solfège when asked', () => {
    expect(noteName(60, 'solfege')).toBe('Do4')
    expect(noteName(66, 'solfege')).toBe('Fa♯4')
    expect(pitchName(71, 'solfege')).toBe('Si')
    expect(pitchName(62)).toBe('D')
    expect(noteName(62, 'letters')).toBe('D4')
  })

  it('gives Tone.js ASCII names', () => {
    expect(toneName(61)).toBe('C#4')
    expect(toneName(70)).toBe('A#4')
    expect(toneName(60)).toBe('C4')
  })

  it('knows black keys', () => {
    const blacks = [61, 63, 66, 68, 70]
    for (let midi = 60; midi < 72; midi++) {
      expect(isBlackKey(midi)).toBe(blacks.includes(midi))
    }
  })

  it('computes pitch class and octave', () => {
    expect(pitchClass(60)).toBe(0)
    expect(pitchClass(71)).toBe(11)
    expect(octaveOf(60)).toBe(4)
    expect(octaveOf(59)).toBe(3)
    expect(midiOfC(4)).toBe(60)
  })

  it('validates midi numbers', () => {
    expect(isValidMidi(60)).toBe(true)
    expect(isValidMidi(20)).toBe(false)
    expect(isValidMidi(109)).toBe(false)
    expect(isValidMidi(60.5)).toBe(false)
    expect(isValidMidi('60')).toBe(false)
  })
})

describe('layout', () => {
  it('puts middle C on slot 12 by default', () => {
    expect(slotToMidi(12, DEFAULT_BASE_OCTAVE)).toBe(60)
    expect(midiToSlot(60, DEFAULT_BASE_OCTAVE)).toBe(12)
  })

  it('stays inside the piano at every base octave', () => {
    expect(slotToMidi(0, MIN_BASE_OCTAVE)).toBe(24)
    expect(slotToMidi(SLOT_COUNT - 1, MAX_BASE_OCTAVE)).toBe(MIDI_MAX)
  })

  it('returns null for notes outside the window', () => {
    expect(midiToSlot(47, 3)).toBeNull()
    expect(midiToSlot(48, 3)).toBe(0)
    expect(midiToSlot(84, 3)).toBe(36)
    expect(midiToSlot(85, 3)).toBeNull()
  })

  it('validates slots and clamps the base octave', () => {
    expect(isValidSlot(0)).toBe(true)
    expect(isValidSlot(36)).toBe(true)
    expect(isValidSlot(37)).toBe(false)
    expect(isValidSlot(-1)).toBe(false)
    expect(isValidSlot(1.5)).toBe(false)
    expect(clampBaseOctave(0)).toBe(MIN_BASE_OCTAVE)
    expect(clampBaseOctave(9)).toBe(MAX_BASE_OCTAVE)
    expect(clampBaseOctave('x')).toBe(DEFAULT_BASE_OCTAVE)
    expect(clampBaseOctave(Number.NaN)).toBe(DEFAULT_BASE_OCTAVE)
  })
})

describe('NoteBus', () => {
  function collect(bus: NoteBus): NoteEvent[] {
    const events: NoteEvent[] = []
    bus.subscribe((event) => events.push(event))
    return events
  }

  it('emits on and off with source and velocity', () => {
    const bus = new NoteBus()
    const events = collect(bus)
    bus.noteOn(60, 'keyboard', { velocity: 0.5, time: 10 })
    bus.noteOff(60, 'keyboard', 20)
    expect(events).toEqual([
      { type: 'on', midi: 60, velocity: 0.5, source: 'keyboard', time: 10 },
      { type: 'off', midi: 60, source: 'keyboard', time: 20 },
    ])
  })

  it('ignores duplicate presses and stray releases', () => {
    const bus = new NoteBus()
    const events = collect(bus)
    bus.noteOn(60, 'keyboard')
    bus.noteOn(60, 'keyboard')
    bus.noteOff(62, 'keyboard')
    bus.noteOff(60, 'pointer')
    expect(events.map((e) => e.type)).toEqual(['on'])
    expect(bus.isActive(60)).toBe(true)
  })

  it('re-triggers for a second source and releases when the last one lets go', () => {
    const bus = new NoteBus()
    const events = collect(bus)
    bus.noteOn(60, 'keyboard')
    bus.noteOn(60, 'pointer')
    bus.noteOff(60, 'keyboard')
    expect(events.map((e) => e.type)).toEqual(['on', 'on'])
    expect(bus.isActive(60)).toBe(true)
    bus.noteOff(60, 'pointer')
    expect(events.map((e) => e.type)).toEqual(['on', 'on', 'off'])
    expect(bus.isActive(60)).toBe(false)
  })

  it('releases everything for one source or for all', () => {
    const bus = new NoteBus()
    bus.noteOn(60, 'keyboard')
    bus.noteOn(62, 'keyboard')
    bus.noteOn(64, 'pointer')
    const events = collect(bus)
    bus.allOff('keyboard')
    expect(events.map((e) => [e.type, e.midi])).toEqual([
      ['off', 60],
      ['off', 62],
    ])
    expect([...bus.getActiveNotes()]).toEqual([64])
    bus.allOff()
    expect(bus.getActiveNotes().size).toBe(0)
  })

  it('keeps a stable snapshot until the held notes change', () => {
    const bus = new NoteBus()
    const empty = bus.getActiveNotes()
    expect(bus.getActiveNotes()).toBe(empty)
    bus.noteOn(60, 'keyboard')
    const one = bus.getActiveNotes()
    expect(one).not.toBe(empty)
    expect(empty.size).toBe(0)
    bus.noteOn(60, 'pointer')
    expect(bus.getActiveNotes()).toBe(one)
    bus.noteOff(60, 'keyboard')
    expect(bus.getActiveNotes()).toBe(one)
    bus.noteOff(60, 'pointer')
    expect(bus.getActiveNotes()).not.toBe(one)
  })

  it('clamps velocity and survives a throwing listener', () => {
    const bus = new NoteBus()
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    bus.subscribe(() => {
      throw new Error('boom')
    })
    const events = collect(bus)
    bus.noteOn(60, 'keyboard', { velocity: 7 })
    bus.noteOn(62, 'keyboard', { velocity: Number.NaN })
    expect(events.map((e) => (e.type === 'on' ? e.velocity : null))).toEqual([1, 0.8])
    expect(errors).toHaveBeenCalled()
    errors.mockRestore()
  })

  it('stops notifying after unsubscribe', () => {
    const bus = new NoteBus()
    const listener = vi.fn()
    const unsubscribe = bus.subscribe(listener)
    bus.noteOn(60, 'keyboard')
    unsubscribe()
    bus.noteOff(60, 'keyboard')
    expect(listener).toHaveBeenCalledTimes(1)
  })
})
