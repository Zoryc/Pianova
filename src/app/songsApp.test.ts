/**
 * The song singletons (src/app/songsApp.ts): the one player, which plays onto
 * the app's own note bus, and the one library of saved songs.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NoteEvent } from '../core/types'
import { songLibrary as theLibrary } from '../songs/songLibrary'
import type { Arrangement } from '../songs/song'
import { bus } from './pianoApp'
import { player, songLibrary } from './songsApp'

const TWO_NOTES: Arrangement = {
  notes: [
    { midi: 60, time: 0, duration: 0.2, velocity: 0.5 },
    { midi: 64, time: 0.3, duration: 0.2, velocity: 0.9 },
  ],
  duration: 0.5,
  offPianoCount: 0,
}

afterEach(() => {
  player.unload()
  bus.allOff()
  vi.useRealTimers()
})

describe('the song player of the app', () => {
  it('starts with no song', () => {
    expect(player.getState()).toMatchObject({ status: 'empty', songId: null })
  })

  it('plays a song onto the note bus of the app, as an input of its own', () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'performance'] })
    const heard: string[] = []
    const stopListening = bus.subscribe((event: NoteEvent) => {
      const strength = event.type === 'on' ? ` at ${event.velocity}` : ''
      heard.push(`${event.type} ${event.midi} from ${event.source}${strength}`)
    })

    player.load({ id: 'test', title: 'Two notes' }, TWO_NOTES)
    player.play()
    vi.advanceTimersByTime(250)
    expect([...bus.getActiveNotes()]).toEqual([])
    vi.advanceTimersByTime(100)
    expect([...bus.getActiveNotes()]).toEqual([64])
    vi.advanceTimersByTime(300)
    stopListening()

    expect(heard).toEqual([
      'on 60 from playback at 0.5',
      'off 60 from playback',
      'on 64 from playback at 0.9',
      'off 64 from playback',
    ])
    expect(player.getState()).toMatchObject({ status: 'stopped', position: 0 })
  })

  it('leaves the notes of the keyboard alone when its song is taken away', () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'performance'] })
    bus.noteOn(72, 'keyboard')
    player.load({ id: 'test', title: 'Two notes' }, TWO_NOTES)
    player.play()
    vi.advanceTimersByTime(50)
    expect([...bus.getActiveNotes()].sort()).toEqual([60, 72])

    player.unload()
    expect([...bus.getActiveNotes()]).toEqual([72])
  })
})

describe('the song library of the app', () => {
  it('is the one library, whichever file it is taken from', () => {
    expect(songLibrary).toBe(theLibrary)
  })
})
