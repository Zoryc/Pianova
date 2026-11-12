// @vitest-environment jsdom
/**
 * The sky with the real song player: does each falling note touch the line
 * exactly when the player sounds it? At every speed, after a pause, after
 * jumping about the song, and at its end.
 *
 * The player runs on a clock the test moves by hand, 5 ms at a time (the
 * player's own step), and the sky draws one picture after each step on the
 * stand-in canvas of skyTestKit.ts. The falling notes are handed to the sky
 * the way the app does it (src/ui/useSongs.ts). The last group goes through
 * that glue itself, with the app's own player: the two seconds a song waits
 * before its first note, and a song that is moved while it stands still.
 *
 * The sky is 1300 x 600 CSS pixels: one second of the song is 200 pixels.
 */
import type { JSX } from 'react'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { bus } from '../../app/pianoApp'
import { player } from '../../app/songsApp'
import { pianoRange } from '../../core/layout'
import { NoteBus } from '../../core/noteBus'
import { keyRectOf } from '../../core/pianoGeometry'
import type { Midi } from '../../core/types'
import type { Arrangement, PlayableNote } from '../../songs/song'
import { createSongPlayer } from '../../songs/songPlayer'
import type { SongPlayer } from '../../songs/songPlayer'
import { STARTER_SONGS } from '../../songs/starterSongs'
import { resetSongs } from '../songsTestKit'
import { LEAD_IN_SECONDS, playSong, useSongSession } from '../useSongs'
import { Sky } from './Sky'
import type { FallingSource } from './Sky'
import { SKY_SECONDS, skySpeed } from './skyModel'
import { BLOOM_PICTURE_SIZE, SPARK_PICTURE_SIZE } from './skySprites'
import { installFakeBrowser } from './skyTestKit'
import type { FakeBrowser, FakeContext, PaintedBar } from './skyTestKit'

const FULL = pianoRange(88, 3)
const STEP_MS = 5
const SKY_WIDTH = 1300
const SKY_HEIGHT = 600
const SPEED = skySpeed(SKY_HEIGHT)
const NO_HINTS: ReadonlyMap<Midi, string> = new Map()

let browser: FakeBrowser

beforeEach(() => {
  browser = installFakeBrowser()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function note(midi: Midi, time: number, duration: number): PlayableNote {
  return { midi, time, duration, velocity: 0.8 }
}

/** A tune with single notes, chords, a repeated note, a black key and a very short note. */
const TUNE: readonly PlayableNote[] = [
  note(60, 0.5, 0.4),
  note(62, 1.0, 0.4),
  note(64, 1.5, 0.9),
  note(67, 1.5, 0.9),
  note(61, 2.2, 0.05),
  note(60, 2.6, 0.2),
  note(60, 2.8, 0.2),
  note(72, 3.3, 1.2),
  note(48, 3.31, 2.0),
  note(65, 4.9, 0.6),
  note(69, 5.6, 0.4),
]

interface Landing {
  midi: Midi
  /** How far the lower end of the note's bar was from the line when the player sounded it (pixels; + is above). */
  gap: number
}

interface Stage {
  player: SongPlayer
  bus: NoteBus
  context: FakeContext
  /** Every note the player has sounded so far, and where its bar was at that moment. */
  landings: Landing[]
  /** Lets `ms` of real time go by: the player steps, then the sky draws. */
  run(ms: number): void
  /** The lower ends of all bars on screen, as heights above the line. */
  bottoms(): number[]
}

function centreOfKey(midi: Midi): number {
  const key = keyRectOf(midi, FULL)
  if (!key) throw new Error(`note ${midi} is not on the piano`)
  return (key.left + key.width / 2) * SKY_WIDTH
}

function bottomAboveLine(bar: PaintedBar): number {
  return SKY_HEIGHT - (bar.y + bar.height)
}

function setTheStage(notes: readonly PlayableNote[] = TUNE): Stage {
  let clock = 10_000
  let step: (() => void) | null = null
  const bus = new NoteBus()
  const player = createSongPlayer({
    bus,
    now: () => clock,
    setInterval: (handler) => {
      step = handler
      return 1
    },
    clearInterval: () => {
      step = null
    },
  })
  const end = Math.max(0, ...notes.map((each) => each.time + each.duration))
  const arrangement: Arrangement = { notes, duration: end, offPianoCount: 0 }
  player.load({ id: 'tune', title: 'Tune' }, arrangement)
  // As src/ui/useSongs.ts builds it.
  const falling: FallingSource = {
    getNotes: () => arrangement.notes,
    getPosition: player.getPosition,
    isPlaying: () => player.getState().status === 'playing',
  }

  const sky = (): JSX.Element => (
    <Sky
      bus={bus}
      range={FULL}
      showBars
      barStyle="solid"
      sparks="some"
      glow={0.6}
      background="black"
      accent="red"
      customColour="#ff2a2a"
      falling={falling}
      hints={NO_HINTS}
    />
  )
  const view = render(sky())
  const context = browser.contextOf(view.container.querySelector('canvas') as HTMLCanvasElement)

  // The app draws the sky again whenever the player starts or stops.
  let wasPlaying = false
  player.subscribe(() => {
    const playing = player.getState().status === 'playing'
    if (playing !== wasPlaying) view.rerender(sky())
    wasPlaying = playing
  })

  const watch = watchLandings(bus, context)

  const run = (ms: number): void => {
    for (let passed = 0; passed < ms; passed += STEP_MS) {
      clock += STEP_MS
      ;(step as (() => void) | null)?.()
      browser.frame(STEP_MS)
      watch.look()
    }
  }

  return {
    player,
    bus,
    context,
    landings: watch.landings,
    run,
    bottoms: () => context.bars.map(bottomAboveLine),
  }
}

/**
 * Follows the notes a player sounds on `bus`. Each time `look` is called, the
 * notes sounded since the last time are added to `landings`, with where their
 * bars are in the picture on `context` at that moment.
 */
function watchLandings(
  bus: NoteBus,
  context: FakeContext,
): { landings: Landing[]; look(): void; stop(): void } {
  const sounded: Midi[] = []
  const stop = bus.subscribe((event) => {
    if (event.type === 'on' && event.source === 'playback') sounded.push(event.midi)
  })
  const landings: Landing[] = []
  const look = (): void => {
    for (const midi of sounded.splice(0)) {
      const centre = centreOfKey(midi)
      const gaps = context.bars
        .filter((bar) => Math.abs(bar.x + bar.width / 2 - centre) < 0.01)
        .map(bottomAboveLine)
        .sort((a, b) => Math.abs(a) - Math.abs(b))
      landings.push({ midi, gap: gaps[0] ?? Number.NaN })
    }
  }
  return { landings, look, stop }
}

/** The lower ends of the bars that should be on screen at `position`, as heights above the line, lowest first. */
function expectedBottoms(notes: readonly PlayableNote[], position: number): number[] {
  return notes
    .filter((each) => each.time + each.duration > position && each.time < position + SKY_SECONDS)
    .map((each) => (each.time - position) * SPEED)
    .sort((a, b) => a - b)
}

/** Checks that the bars on screen are exactly the ones in `expected`, each at its height. */
function expectBottoms(shown: readonly number[], expected: readonly number[]): void {
  const sorted = [...shown].sort((a, b) => a - b)
  expect(sorted).toHaveLength(expected.length)
  sorted.forEach((bottom, i) => expect(bottom).toBeCloseTo(expected[i] as number, 6))
}

/** One step of the player at this speed moves a bar by this many pixels at most. */
function onePlayerStep(speed: number): number {
  return (STEP_MS / 1000) * speed * SPEED
}

describe('a falling note and the moment it sounds', () => {
  it.each([0.5, 0.75, 1, 1.25, 1.5])(
    'touches the line when the player sounds it, for every note, at speed %s',
    (speed) => {
      const stage = setTheStage()
      stage.player.setSpeed(speed)
      stage.player.play()
      stage.run(7000 / speed + 500)

      expect(stage.landings.map((landing) => landing.midi)).toEqual(TUNE.map((each) => each.midi))
      for (const landing of stage.landings) {
        // The bar has reached the line, and has sunk into it by no more than one step of the player.
        expect(landing.gap, `note ${landing.midi}`).toBeLessThanOrEqual(1e-6)
        expect(landing.gap, `note ${landing.midi}`).toBeGreaterThanOrEqual(-onePlayerStep(speed) - 1e-6)
      }
      expect(stage.player.getState().status).toBe('stopped')
    },
  )

  it('still does after a pause and after jumping backwards and forwards in the song', () => {
    const stage = setTheStage()
    stage.player.play()
    stage.run(1200)
    expect(stage.landings.map((landing) => landing.midi)).toEqual([60, 62])

    stage.player.pause()
    const paused = stage.bottoms()
    stage.run(3000)
    // Three seconds later nothing has moved, and nothing new has sounded.
    expect(stage.bottoms()).toEqual(paused)
    expect(stage.landings).toHaveLength(2)

    stage.player.play()
    stage.run(600)
    // 64 and 67 at 1.5 seconds.
    expect(stage.landings.map((landing) => landing.midi)).toEqual([60, 62, 64, 67])

    stage.player.seek(3.0)
    stage.run(400)
    // 72 at 3.3 and 48 at 3.31.
    stage.player.seek(0.2)
    stage.run(1000)
    // The beginning again: 60 at 0.5 and 62 at 1.0.
    stage.player.setSpeed(1.5)
    stage.player.seek(4.5)
    stage.run(800)

    expect(stage.landings.map((landing) => landing.midi)).toEqual([60, 62, 64, 67, 72, 48, 60, 62, 65, 69])
    for (const landing of stage.landings) {
      expect(landing.gap, `note ${landing.midi}`).toBeLessThanOrEqual(1e-6)
      expect(landing.gap, `note ${landing.midi}`).toBeGreaterThanOrEqual(-onePlayerStep(1.5) - 1e-6)
    }
  })

  it('does not move the notes at the moment the speed is changed: they only fall slower or faster from there', () => {
    const stage = setTheStage()
    stage.player.play()
    stage.run(700)
    const before = stage.bottoms()
    stage.player.setSpeed(0.5)
    // A new picture without any time going by.
    browser.frame(0)
    expect(stage.bottoms()).toEqual(before)

    stage.run(1000)
    // One second at half speed: half a second of the song, 100 pixels.
    const highest = Math.max(...before)
    expect(Math.max(...stage.bottoms())).toBeCloseTo(highest - 0.5 * SPEED, 6)

    stage.player.setSpeed(1.5)
    browser.frame(0)
    const atSwitch = Math.max(...stage.bottoms())
    stage.run(200)
    expect(Math.max(...stage.bottoms())).toBeCloseTo(atSwitch - 0.2 * 1.5 * SPEED, 6)
  })

  it('shows the place the player jumped to in the very next picture, while it plays', () => {
    const stage = setTheStage()
    stage.player.play()
    stage.run(300)
    stage.player.seek(3.0)
    stage.run(STEP_MS)
    expectBottoms(stage.bottoms(), expectedBottoms(TUNE, stage.player.getPosition()))
  })

  it('comes to rest when the song is over: no frame, no glow and no spark is left, and the start is shown', () => {
    const stage = setTheStage()
    stage.player.play()
    stage.run(6100)
    expect(stage.player.getState().status).toBe('stopped')
    expect(stage.bus.getActiveNotes().size).toBe(0)

    const frames = browser.playUntilIdle()
    expect(frames).toBeLessThan(120)
    expect(browser.frames.pending.size).toBe(0)
    const pictures = stage.context.images.map((stamp) => stamp.image as HTMLCanvasElement)
    expect(pictures.filter((picture) => picture.width === BLOOM_PICTURE_SIZE)).toEqual([])
    expect(pictures.filter((picture) => picture.width === SPARK_PICTURE_SIZE)).toEqual([])
    // Back at the start: the first notes of the tune are in the air again, each
    // at its own height (seven of them come within the three seconds the sky shows).
    const atTheStart = expectedBottoms(TUNE, 0)
    expect(atTheStart).toHaveLength(7)
    expectBottoms(stage.bottoms(), atTheStart)
    // And they stand still.
    browser.frames.now += 60_000
    expectBottoms(stage.bottoms(), atTheStart)
    expect(browser.frames.pending.size).toBe(0)
  })

  it('puts out the glow of the notes that were sounding when the song is paused, and goes still', () => {
    const stage = setTheStage()
    stage.player.play()
    stage.run(1700)
    // 64 and 67 are sounding: two glows on the line.
    const blooms = (): number =>
      stage.context.images.filter(
        (stamp) => (stamp.image as HTMLCanvasElement).width === BLOOM_PICTURE_SIZE,
      ).length
    expect(blooms()).toBe(2)
    stage.player.pause()
    browser.playUntilIdle()
    expect(blooms()).toBe(0)
    expect(browser.frames.pending.size).toBe(0)
  })
})

describe('a song the app starts, with its own player and its song glue', () => {
  const TWINKLE = STARTER_SONGS.find((song) => song.id === 'starter:twinkle-twinkle-little-star')
  if (!TWINKLE) throw new Error('The starter song of these tests is gone.')
  /** Its notes as the app plays them: the tune starts on its first beat, so all of it comes later by the lead-in. */
  const PLAYED = (TWINKLE.tracks[0]?.notes ?? []).map((each) => ({
    ...each,
    time: each.time + LEAD_IN_SECONDS,
  }))

  /** How often the stand-in for the app shell was drawn. */
  let shellDrawn = 0
  let stopWatching: () => void = () => undefined

  /** What the app shell does for the sky: it asks the song glue for the falling notes and hands them on. */
  function ShellWithSky(): JSX.Element {
    shellDrawn += 1
    const song = useSongSession(FULL)
    return (
      <Sky
        bus={bus}
        range={FULL}
        showBars
        barStyle="solid"
        sparks="off"
        glow={0.6}
        background="black"
        accent="red"
        customColour="#ff2a2a"
        falling={song.falling}
        hints={NO_HINTS}
      />
    )
  }

  function drawShell(): FakeContext {
    const view = render(<ShellWithSky />)
    return browser.contextOf(view.container.querySelector('canvas') as HTMLCanvasElement)
  }

  /** Lets `ms` go by on the page's clock, 5 ms at a time: the player steps, then the sky draws. */
  function run(ms: number, afterEachStep: () => void = () => undefined): void {
    for (let passed = 0; passed < ms; passed += STEP_MS) {
      act(() => {
        vi.advanceTimersByTime(STEP_MS)
      })
      browser.frame(STEP_MS)
      afterEachStep()
    }
  }

  beforeEach(async () => {
    await resetSongs()
    shellDrawn = 0
    // The player's clock and its timer; the frames stay with the stand-in browser.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'performance'] })
  })

  afterEach(async () => {
    stopWatching()
    cleanup()
    vi.useRealTimers()
    await resetSongs()
  })

  it('shows the first note two seconds up in the sky at "Play", and sounds it when it touches the line', () => {
    const context = drawShell()
    const watch = watchLandings(bus, context)
    stopWatching = watch.stop
    act(() => {
      playSong(TWINKLE.id)
    })
    browser.frame(0)

    // Nothing sounds yet. The first bar is two seconds above the line, well inside the sky.
    expect(bus.getActiveNotes().size).toBe(0)
    const bottoms = context.bars.map(bottomAboveLine)
    expectBottoms(bottoms, expectedBottoms(PLAYED, 0))
    expect(Math.min(...bottoms)).toBeCloseTo(LEAD_IN_SECONDS * SPEED, 6)

    // It falls for all of that time without a sound…
    run(LEAD_IN_SECONDS * 1000 - STEP_MS, watch.look)
    expect(watch.landings).toEqual([])
    // …and sounds at the moment it reaches the line.
    run(2 * STEP_MS, watch.look)
    expect(watch.landings.map((landing) => landing.midi)).toEqual([PLAYED[0]?.midi])
    const [first] = watch.landings
    expect(first?.gap).toBeLessThanOrEqual(1e-6)
    expect(first?.gap).toBeGreaterThanOrEqual(-onePlayerStep(1) - 1e-6)

    // So does every note after it.
    run(3000, watch.look)
    expect(watch.landings.length).toBeGreaterThan(4)
    for (const landing of watch.landings) {
      expect(landing.gap, `note ${landing.midi}`).toBeLessThanOrEqual(1e-6)
      expect(landing.gap, `note ${landing.midi}`).toBeGreaterThanOrEqual(-onePlayerStep(1) - 1e-6)
    }
  })

  it('shows a song that stands still at its new place at once when it is moved, and at its start after "Stop"', () => {
    const context = drawShell()
    act(() => {
      playSong(TWINKLE.id)
    })
    run(500)
    act(() => player.pause())
    browser.playUntilIdle()
    const framesAsked = browser.frames.requested

    // The progress slider of a paused song, dragged: one new place after the other.
    for (const place of [10.1, 10.6, 11.1, 4.25, 20.1]) {
      act(() => player.seek(place))
      // No time has gone by and no frame was asked for: the picture is already the new one.
      expectBottoms(context.bars.map(bottomAboveLine), expectedBottoms(PLAYED, place))
    }
    act(() => player.stop())
    expectBottoms(context.bars.map(bottomAboveLine), expectedBottoms(PLAYED, 0))
    expect(browser.frames.requested).toBe(framesAsked)
  })

  it('does not draw the app shell again for a song that plays, whatever place it is moved to', () => {
    const context = drawShell()
    act(() => {
      playSong(TWINKLE.id)
    })
    run(500)
    const drawnWhilePlaying = shellDrawn

    run(1500)
    act(() => player.seek(12))
    run(1000)
    expect(shellDrawn).toBe(drawnWhilePlaying)
    // The sky needs no telling: it draws the song frame by frame, from where the player is.
    expectBottoms(context.bars.map(bottomAboveLine), expectedBottoms(PLAYED, player.getPosition()))
  })
})
