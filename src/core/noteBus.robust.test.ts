/**
 * The bus is the one place every note passes through, and later phases will
 * add inputs ('midi', 'mic', 'playback') and consumers (practice, scoring) to
 * it. These tests check the property everything else relies on: a consumer
 * that starts a note on every 'on' and stops it on every 'off' (which is what
 * the sound engine and the light trails do) always ends up holding exactly
 * the notes the bus says are held. Anything else is a stuck note.
 */
import { describe, expect, it } from 'vitest'
import { NoteBus } from './noteBus'
import type { Midi, NoteEvent, NoteSource } from './types'

const SOURCES: readonly NoteSource[] = ['keyboard', 'pointer', 'midi', 'mic', 'playback']

/** A consumer like the sound engine: it believes whatever the events tell it, in the order they arrive. */
function follow(bus: NoteBus): { sounding: ReadonlySet<Midi>; events: NoteEvent[] } {
  const sounding = new Set<Midi>()
  const events: NoteEvent[] = []
  bus.subscribe((event) => {
    events.push(event)
    if (event.type === 'on') sounding.add(event.midi)
    else sounding.delete(event.midi)
  })
  return { sounding, events }
}

function sorted(notes: Iterable<Midi>): Midi[] {
  return [...notes].sort((a, b) => a - b)
}

/** Small deterministic random generator, so a failure can be reproduced. */
function randomSource(seed: number): () => number {
  let state = seed
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296
    return state / 4294967296
  }
}

describe('NoteBus, as seen by a consumer that follows its events', () => {
  it('agrees with the bus after every step of a long random session', () => {
    const random = randomSource(20240607)
    const pick = <Item>(items: readonly Item[]): Item => {
      const item = items[Math.floor(random() * items.length)]
      if (item === undefined) throw new Error('nothing to pick from')
      return item
    }
    const bus = new NoteBus()
    const consumer = follow(bus)
    /** What the test itself expects to be held: note -> sources holding it. */
    const model = new Map<Midi, Set<NoteSource>>()
    const notes = [48, 55, 60, 61, 64, 67, 72, 84]

    for (let step = 0; step < 5000; step++) {
      const action = random()
      const midi = pick(notes)
      const source = pick(SOURCES)
      if (action < 0.5) {
        bus.noteOn(midi, source)
        model.set(midi, (model.get(midi) ?? new Set<NoteSource>()).add(source))
      } else if (action < 0.9) {
        bus.noteOff(midi, source)
        model.get(midi)?.delete(source)
      } else if (action < 0.97) {
        bus.allOff(source)
        for (const sources of model.values()) sources.delete(source)
      } else {
        bus.allOff()
        model.clear()
      }
      for (const [held, sources] of model) if (sources.size === 0) model.delete(held)

      const expected = sorted(model.keys())
      expect(sorted(bus.getActiveNotes())).toEqual(expected)
      expect(sorted(consumer.sounding)).toEqual(expected)
      for (const note of notes) expect(bus.isActive(note)).toBe(model.has(note))
    }

    bus.allOff()
    expect(sorted(consumer.sounding)).toEqual([])
  })

  it('ends every note it started, in pairs, when everything is let go at once', () => {
    const bus = new NoteBus()
    const consumer = follow(bus)
    for (const source of SOURCES) {
      bus.noteOn(60, source)
      bus.noteOn(64, source)
    }
    bus.allOff()

    expect(sorted(consumer.sounding)).toEqual([])
    const last = new Map<Midi, NoteEvent['type']>()
    for (const event of consumer.events) last.set(event.midi, event.type)
    expect([...last.values()]).toEqual(['off', 'off'])
    expect(consumer.events.filter((event) => event.type === 'off')).toHaveLength(2)
  })

  it('still releases the others when a consumer fails on every event', () => {
    const bus = new NoteBus()
    const errors: unknown[] = []
    const realError = console.error
    console.error = (...args: unknown[]) => errors.push(args)
    try {
      bus.subscribe(() => {
        throw new Error('broken consumer')
      })
      const consumer = follow(bus)
      bus.noteOn(60, 'keyboard')
      bus.noteOn(62, 'pointer')
      bus.allOff()
      expect(sorted(consumer.sounding)).toEqual([])
      expect(errors.length).toBeGreaterThan(0)
    } finally {
      console.error = realError
    }
  })

  it('lets a consumer unsubscribe itself, or another one, in the middle of an event', () => {
    const bus = new NoteBus()
    let stopSecond: () => void = () => {}
    let toldFirst = 0
    const stopFirst = bus.subscribe(() => {
      toldFirst += 1
      stopFirst()
      stopSecond()
    })
    const seenBySecond: NoteEvent[] = []
    stopSecond = bus.subscribe((event) => seenBySecond.push(event))
    const consumer = follow(bus)

    bus.noteOn(60, 'keyboard')
    bus.noteOff(60, 'keyboard')
    bus.noteOn(62, 'keyboard')

    expect(toldFirst).toBe(1)
    // Whether the event that was under way (60 starting) still reaches a
    // consumer removed during it is not promised either way. No later event does.
    const later = seenBySecond.filter((event) => event.type === 'off' || event.midi !== 60)
    expect(later).toEqual([])
    // The consumer that stayed heard everything.
    expect(consumer.events.map((event) => event.type)).toEqual(['on', 'off', 'on'])
    expect(sorted(consumer.sounding)).toEqual([62])
  })
})

describe('NoteBus, when a consumer answers a note by calling the bus again', () => {
  /*
   * The bus promises that events reach every consumer in the order they
   * happened, also when a consumer calls the bus while it is being told
   * about an event. Later phases rely on it: a practice or scoring engine
   * that hears a key and, in the same breath, lets go of notes (the guide
   * note it was playing, or everything, with allOff). Consumers that
   * subscribed after it (the light trails subscribe when they are mounted)
   * must still see each note start before it stops.
   */
  it('a consumer that cuts a note as soon as it starts leaves nobody with a stuck note', () => {
    const bus = new NoteBus()
    bus.subscribe((event) => {
      if (event.type === 'on') bus.noteOff(event.midi, event.source)
    })
    const later = follow(bus)

    bus.noteOn(60, 'playback')

    expect(bus.isActive(60)).toBe(false)
    expect(sorted(bus.getActiveNotes())).toEqual([])
    // The consumer that subscribed later must agree: nothing is held.
    expect(sorted(later.sounding)).toEqual([])
    expect(later.events.map((event) => event.type)).toEqual(['on', 'off'])
  })

  it('a consumer that answers one note with allOff() leaves nobody with a stuck note', () => {
    const bus = new NoteBus()
    bus.subscribe((event) => {
      // "The player hit the stop key": everything is let go.
      if (event.type === 'on' && event.midi === 72) bus.allOff()
    })
    const later = follow(bus)

    bus.noteOn(60, 'playback')
    bus.noteOn(64, 'keyboard')
    bus.noteOn(72, 'keyboard')

    expect(sorted(bus.getActiveNotes())).toEqual([])
    expect(sorted(later.sounding)).toEqual([])
  })

  it('a consumer that answers a note by starting another keeps everyone in agreement', () => {
    const bus = new NoteBus()
    bus.subscribe((event) => {
      // An "octave doubler": every keyboard note also sounds an octave higher.
      if (event.source !== 'keyboard') return
      if (event.type === 'on') bus.noteOn(event.midi + 12, 'playback')
      else bus.noteOff(event.midi + 12, 'playback')
    })
    const later = follow(bus)

    bus.noteOn(60, 'keyboard')
    expect(sorted(later.sounding)).toEqual([60, 72])
    expect(sorted(bus.getActiveNotes())).toEqual([60, 72])
    bus.noteOff(60, 'keyboard')
    expect(sorted(later.sounding)).toEqual([])
    expect(sorted(bus.getActiveNotes())).toEqual([])
  })
})
