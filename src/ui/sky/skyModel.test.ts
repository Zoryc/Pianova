import { describe, expect, it } from 'vitest'
import { pianoRange } from '../../core/layout'
import type { PianoRange } from '../../core/layout'
import { keyRectOf } from '../../core/pianoGeometry'
import type { SparksLevel } from '../../core/types'
import type { PlayableNote } from '../../songs/song'
import {
  AFTERGLOW_SECONDS,
  FLASH_SECONDS,
  MAX_BACKGROUND_BOOST,
  MAX_BARS,
  MAX_FRAME_MS,
  MAX_SPARKS,
  MIN_BAR_HEIGHT,
  SKY_SECONDS,
  STAR_FIELDS,
  advanceBars,
  advanceImpacts,
  advanceSparks,
  backgroundBoost,
  barLeft,
  barRadius,
  barWidth,
  barsAreMoving,
  createSparks,
  easePresence,
  emitSparks,
  fadeHeight,
  fallingBottom,
  fallingHeight,
  firstNoteFrom,
  firstUnfinishedNote,
  frameSeconds,
  impactsAreMoving,
  indexFallingNotes,
  keepHeldBars,
  lineGlow,
  releaseBar,
  releaseImpact,
  seededRandom,
  settleImpacts,
  skySpeed,
  soundingCount,
  sparkStrength,
  starField,
  startBar,
  stillGlowHeight,
  strikeImpact,
  strikeSparks,
} from './skyModel'
import type { FallingIndex, Impact, RisingBar, Sparks } from './skyModel'

/** The full piano, A0..C8, and a small one that starts on middle C's octave below. */
const FULL = pianoRange(88, 3)
const SMALL = pianoRange(37, 3)
const MIDDLE_C = 60
const C_SHARP = 61
const D = 62
const WIDTH = 1300
const HEIGHT = 600
const FRAME = 1 / 60

function only<T>(items: readonly T[]): T {
  expect(items).toHaveLength(1)
  return items[0] as T
}

/** Runs the bars for `seconds`, one 60 fps frame at a time. */
function runBars(bars: RisingBar[], seconds: number, height = HEIGHT): void {
  for (let frame = 0; frame < Math.round(seconds / FRAME); frame++) advanceBars(bars, FRAME, height)
}

function note(midi: number, time: number, duration: number): PlayableNote {
  return { midi, time, duration, velocity: 0.8 }
}

describe('frameSeconds', () => {
  it('turns milliseconds into seconds', () => {
    expect(frameSeconds(16)).toBeCloseTo(0.016, 10)
  })

  it('clamps a long gap, such as coming back from a background tab', () => {
    expect(frameSeconds(30_000)).toBe(MAX_FRAME_MS / 1000)
    expect(frameSeconds(Number.POSITIVE_INFINITY)).toBe(MAX_FRAME_MS / 1000)
  })

  it('never goes backwards or returns NaN', () => {
    expect(frameSeconds(0)).toBe(0)
    expect(frameSeconds(-5)).toBe(0)
    expect(frameSeconds(Number.NaN)).toBe(0)
  })
})

describe('skySpeed', () => {
  it('fits SKY_SECONDS of music in the height of the sky', () => {
    expect(skySpeed(600) * SKY_SECONDS).toBeCloseTo(600, 10)
    expect(skySpeed(900)).toBeCloseTo(skySpeed(450) * 2, 10)
  })

  it('stays lively in a tiny or empty sky', () => {
    expect(skySpeed(0)).toBeGreaterThan(0)
    expect(skySpeed(10)).toBe(skySpeed(0))
  })
})

describe('the shape of a bar', () => {
  it('is a little narrower than its key and centred on it', () => {
    for (const keyWidth of [8, 16, 26, 40, 62]) {
      const width = barWidth(keyWidth)
      const left = barLeft(100, keyWidth)
      expect(width).toBeLessThan(keyWidth)
      expect(width).toBeGreaterThan(keyWidth * 0.7)
      expect(left + width / 2).toBeCloseTo(100 + keyWidth / 2, 10)
    }
  })

  it('never has no width, even on a key that is hardly there', () => {
    expect(barWidth(0)).toBeGreaterThan(0)
    expect(barWidth(1.5)).toBeGreaterThan(0)
  })

  it('has corners no rounder than the bar can hold', () => {
    expect(barRadius(22, 400)).toBeGreaterThan(0)
    expect(barRadius(22, 400)).toBeLessThanOrEqual(11)
    expect(barRadius(22, 4)).toBe(2)
    expect(barRadius(22, 0)).toBe(0)
    expect(barRadius(0, 10)).toBe(0)
  })
})

describe('startBar', () => {
  it('starts a held bar of no height on the key of the note', () => {
    const bars: RisingBar[] = []
    expect(startBar(bars, MIDDLE_C, FULL)).toBe(true)
    const key = keyRectOf(MIDDLE_C, FULL)
    expect(only(bars)).toEqual({
      midi: MIDDLE_C,
      black: false,
      left: key?.left,
      width: key?.width,
      bottom: 0,
      height: 0,
      held: true,
    })
  })

  it('makes black-key bars narrower than white-key bars', () => {
    const bars: RisingBar[] = []
    startBar(bars, MIDDLE_C, FULL)
    startBar(bars, C_SHARP, FULL)
    expect(bars[1]?.black).toBe(true)
    expect(bars[1]?.width).toBeLessThan(bars[0]?.width ?? 0)
  })

  it('places the note according to the piano on screen', () => {
    const onFull: RisingBar[] = []
    const onSmall: RisingBar[] = []
    startBar(onFull, 48, FULL)
    startBar(onSmall, 48, SMALL)
    expect(only(onSmall).left).toBe(0)
    expect(only(onFull).left).toBeGreaterThan(0)
  })

  it('ignores notes that are not on the piano', () => {
    const bars: RisingBar[] = []
    startBar(bars, MIDDLE_C, SMALL)
    expect(startBar(bars, 47, SMALL)).toBe(false)
    expect(startBar(bars, 85, SMALL)).toBe(false)
    expect(startBar(bars, 60.5, SMALL)).toBe(false)
    expect(startBar(bars, Number.NaN, SMALL)).toBe(false)
    expect(bars).toHaveLength(1)
  })

  it('lets the old bar go when a held note is struck again', () => {
    const bars: RisingBar[] = []
    startBar(bars, MIDDLE_C, FULL)
    runBars(bars, 0.5)
    const grown = only(bars).height
    startBar(bars, MIDDLE_C, FULL)
    expect(bars).toHaveLength(2)
    expect(bars[0]).toMatchObject({ held: false, height: grown })
    expect(bars[1]).toMatchObject({ midi: MIDDLE_C, held: true, height: 0, bottom: 0 })
  })

  it('never keeps more than MAX_BARS, dropping the oldest that was let go', () => {
    const bars: RisingBar[] = []
    startBar(bars, D, FULL)
    for (let i = 0; i < MAX_BARS + 50; i++) startBar(bars, MIDDLE_C, FULL)
    expect(bars).toHaveLength(MAX_BARS)
    // The D is still held: it is being looked at, so it stays.
    expect(bars.filter((bar) => bar.midi === D)).toHaveLength(1)
    expect(bars.filter((bar) => bar.held)).toHaveLength(2)
    expect(bars[bars.length - 1]?.held).toBe(true)
  })

  it('stays bounded even when every bar is held: the oldest then goes', () => {
    const bars: RisingBar[] = []
    // More held bars than a piano has keys can only be made by hand.
    for (let i = 0; i < MAX_BARS; i++) {
      bars.push({ midi: 1000 + i, black: false, left: 0, width: 0.01, bottom: 0, height: 5, held: true })
    }
    startBar(bars, D, FULL)
    expect(bars).toHaveLength(MAX_BARS)
    expect(bars[0]?.midi).toBe(1001)
    expect(bars[MAX_BARS - 1]?.midi).toBe(D)
  })
})

describe('releaseBar', () => {
  it('detaches only the bar of the released note', () => {
    const bars: RisingBar[] = []
    startBar(bars, MIDDLE_C, FULL)
    startBar(bars, D, FULL)
    runBars(bars, 0.5)
    const height = bars[0]?.height
    expect(releaseBar(bars, MIDDLE_C)).toBe(true)
    expect(bars.map((bar) => bar.held)).toEqual([false, true])
    expect(bars[0]?.height).toBe(height)
    expect(bars[0]?.bottom).toBe(0)
  })

  it('gives even the quickest tap a visible bar', () => {
    const bars: RisingBar[] = []
    startBar(bars, MIDDLE_C, FULL)
    releaseBar(bars, MIDDLE_C)
    expect(only(bars).height).toBe(MIN_BAR_HEIGHT)
  })

  it('says so when the note has no held bar, and changes nothing', () => {
    const bars: RisingBar[] = []
    startBar(bars, MIDDLE_C, FULL)
    expect(releaseBar(bars, D)).toBe(false)
    releaseBar(bars, MIDDLE_C)
    const snapshot = structuredClone(bars)
    expect(releaseBar(bars, MIDDLE_C)).toBe(false)
    expect(bars).toEqual(snapshot)
  })
})

describe('keepHeldBars', () => {
  it('drops the bars that were let go', () => {
    const bars: RisingBar[] = []
    startBar(bars, MIDDLE_C, FULL)
    startBar(bars, D, FULL)
    startBar(bars, C_SHARP, FULL)
    releaseBar(bars, MIDDLE_C)
    keepHeldBars(bars)
    expect(bars.map((bar) => bar.midi)).toEqual([D, C_SHARP])
  })
})

describe('advanceBars', () => {
  it('grows a held bar upward at the speed of the sky, standing on the line', () => {
    const bars: RisingBar[] = []
    startBar(bars, MIDDLE_C, FULL)
    advanceBars(bars, 0.25, HEIGHT)
    expect(only(bars)).toMatchObject({ bottom: 0, held: true })
    expect(only(bars).height).toBeCloseTo(skySpeed(HEIGHT) * 0.25, 10)
  })

  it('raises a released bar at the same speed without changing its height', () => {
    const bars: RisingBar[] = []
    startBar(bars, MIDDLE_C, FULL)
    runBars(bars, 0.5)
    releaseBar(bars, MIDDLE_C)
    const height = only(bars).height
    advanceBars(bars, 0.25, HEIGHT)
    expect(only(bars).bottom).toBeCloseTo(skySpeed(HEIGHT) * 0.25, 10)
    expect(only(bars).height).toBe(height)
  })

  it('moves at a constant speed, however the time is cut into frames', () => {
    const oneStep: RisingBar[] = []
    const manySteps: RisingBar[] = []
    startBar(oneStep, MIDDLE_C, FULL)
    startBar(manySteps, MIDDLE_C, FULL)
    advanceBars(oneStep, 0.5, HEIGHT)
    runBars(manySteps, 0.5)
    expect(only(manySteps).height).toBeCloseTo(only(oneStep).height, 6)
  })

  it('does nothing when no time has passed', () => {
    const bars: RisingBar[] = []
    startBar(bars, MIDDLE_C, FULL)
    runBars(bars, 0.2)
    releaseBar(bars, MIDDLE_C)
    const snapshot = structuredClone(bars)
    advanceBars(bars, 0, HEIGHT)
    expect(bars).toEqual(snapshot)
  })

  it('keeps a bar that is partly above the top and removes it once it is fully above', () => {
    const bars: RisingBar[] = []
    startBar(bars, MIDDLE_C, FULL)
    runBars(bars, 0.5)
    releaseBar(bars, MIDDLE_C)
    const climbSeconds = HEIGHT / skySpeed(HEIGHT)
    advanceBars(bars, climbSeconds * 0.99, HEIGHT)
    expect(only(bars).bottom + only(bars).height).toBeGreaterThan(HEIGHT)
    advanceBars(bars, climbSeconds * 0.02, HEIGHT)
    expect(bars).toHaveLength(0)
  })

  it('never lets a held bar grow taller than the sky', () => {
    const bars: RisingBar[] = []
    startBar(bars, MIDDLE_C, FULL)
    runBars(bars, 60)
    expect(only(bars)).toMatchObject({ height: HEIGHT, held: true })
  })

  it('cuts a held bar down when the sky gets lower', () => {
    const bars: RisingBar[] = []
    startBar(bars, MIDDLE_C, FULL)
    runBars(bars, 60)
    advanceBars(bars, FRAME, 200)
    expect(only(bars).height).toBe(200)
  })

  it('ends with an empty list after every note is released', () => {
    const bars: RisingBar[] = []
    startBar(bars, MIDDLE_C, FULL)
    startBar(bars, C_SHARP, FULL)
    runBars(bars, 0.4)
    releaseBar(bars, MIDDLE_C)
    runBars(bars, 0.3)
    expect(bars).toHaveLength(2)
    releaseBar(bars, C_SHARP)
    runBars(bars, HEIGHT / skySpeed(HEIGHT) + 0.1)
    expect(bars).toHaveLength(0)
  })
})

describe('barsAreMoving', () => {
  it('is false for no bars', () => {
    expect(barsAreMoving([], HEIGHT)).toBe(false)
  })

  it('is true while a held bar grows and false once it fills the sky', () => {
    const bars: RisingBar[] = []
    startBar(bars, MIDDLE_C, FULL)
    expect(barsAreMoving(bars, HEIGHT)).toBe(true)
    runBars(bars, SKY_SECONDS + 0.5)
    expect(barsAreMoving(bars, HEIGHT)).toBe(false)
  })

  it('is true while a released bar is on its way up', () => {
    const bars: RisingBar[] = []
    startBar(bars, MIDDLE_C, FULL)
    runBars(bars, SKY_SECONDS + 0.5)
    releaseBar(bars, MIDDLE_C)
    expect(barsAreMoving(bars, HEIGHT)).toBe(true)
  })
})

describe('fadeHeight and stillGlowHeight', () => {
  it('fade bars over a part of the sky, at its top', () => {
    expect(fadeHeight(HEIGHT)).toBeGreaterThan(0)
    expect(fadeHeight(HEIGHT)).toBeLessThan(HEIGHT / 2)
    expect(fadeHeight(0)).toBe(0)
  })

  it('give a short still glow: a share of the sky, never tiny, never tall, never taller than the sky', () => {
    expect(stillGlowHeight(600)).toBeGreaterThan(60)
    expect(stillGlowHeight(600)).toBeLessThan(200)
    expect(stillGlowHeight(3000)).toBe(stillGlowHeight(2000))
    expect(stillGlowHeight(60)).toBeGreaterThanOrEqual(20)
    expect(stillGlowHeight(10)).toBe(10)
    expect(stillGlowHeight(0)).toBe(0)
  })
})

describe('finding the falling notes that are on screen', () => {
  const notes = [
    note(60, 0, 1),
    note(48, 0.5, 10), // A long note that is still sounding when later ones have ended.
    note(62, 1, 0.5),
    note(64, 2, 0.5),
    note(65, 2, 1),
    note(67, 5, 1),
    note(69, 12, 1),
  ]
  const index = indexFallingNotes(notes)

  it('keeps the notes as they are and records when the last of them so far ends', () => {
    expect(index.notes).toBe(notes)
    expect([...index.latestEnd]).toEqual([1, 10.5, 10.5, 10.5, 10.5, 10.5, 13])
  })

  it('finds the first note that has not ended yet', () => {
    expect(firstUnfinishedNote(index, -1)).toBe(0)
    expect(firstUnfinishedNote(index, 0)).toBe(0)
    expect(firstUnfinishedNote(index, 0.99)).toBe(0)
    // The first note ends at exactly 1: from then on the long note is the first.
    expect(firstUnfinishedNote(index, 1)).toBe(1)
    expect(firstUnfinishedNote(index, 10.4)).toBe(1)
    expect(firstUnfinishedNote(index, 10.5)).toBe(6)
    expect(firstUnfinishedNote(index, 12.9)).toBe(6)
    expect(firstUnfinishedNote(index, 13)).toBe(7)
    expect(firstUnfinishedNote(index, 1e9)).toBe(7)
  })

  it('finds the first note that starts at a time or later', () => {
    expect(firstNoteFrom(index, -1)).toBe(0)
    expect(firstNoteFrom(index, 0)).toBe(0)
    expect(firstNoteFrom(index, 0.25)).toBe(1)
    expect(firstNoteFrom(index, 2)).toBe(3)
    expect(firstNoteFrom(index, 2.01)).toBe(5)
    expect(firstNoteFrom(index, 12)).toBe(6)
    expect(firstNoteFrom(index, 12.01)).toBe(7)
  })

  it('copes with a song that has no notes', () => {
    const empty = indexFallingNotes([])
    expect(firstUnfinishedNote(empty, 3)).toBe(0)
    expect(firstNoteFrom(empty, 3)).toBe(0)
  })

  it('agrees with a plain search through the whole song, at any position', () => {
    const random = seededRandom(42)
    const song: PlayableNote[] = []
    let time = 0
    for (let i = 0; i < 2000; i++) {
      time += random() < 0.3 ? 0 : random() * 0.4
      song.push(note(21 + Math.floor(random() * 88), time, 0.02 + random() ** 4 * 30))
    }
    const songIndex = indexFallingNotes(song)
    for (let probe = 0; probe < 400; probe++) {
      const position = random() * (time + 40) - 5
      const lookAhead = position + SKY_SECONDS
      const from = firstUnfinishedNote(songIndex, position)
      const to = firstNoteFrom(songIndex, lookAhead)
      const found = new Set<number>()
      for (let i = from; i < to; i++) {
        const candidate = song[i] as PlayableNote
        if (candidate.time + candidate.duration > position) found.add(i)
      }
      const expected = new Set<number>()
      song.forEach((candidate, i) => {
        if (candidate.time + candidate.duration > position && candidate.time < lookAhead) {
          expected.add(i)
        }
      })
      expect(found).toEqual(expected)
    }
  })

  it('looks at a handful of notes, not at the whole song', () => {
    const song: PlayableNote[] = []
    for (let i = 0; i < 50_000; i++) song.push(note(60 + (i % 12), i * 0.1, 0.09))
    const songIndex = indexFallingNotes(song)
    let looked = 0
    const watched: FallingIndex = {
      latestEnd: songIndex.latestEnd,
      notes: new Proxy(song, {
        get(target, key, receiver) {
          if (typeof key === 'string' && /^\d+$/.test(key)) looked++
          return Reflect.get(target, key, receiver) as unknown
        },
      }),
    }
    expect(firstNoteFrom(watched, 2500)).toBe(25_000)
    expect(looked).toBeLessThanOrEqual(20)
    // The other search only reads the prepared list of end times, never the notes.
    looked = 0
    expect(firstUnfinishedNote(watched, 2500)).toBe(25_000)
    expect(looked).toBe(0)
  })

})

describe('where a falling note is', () => {
  const speed = skySpeed(HEIGHT)

  it('is as far above the line as its start is ahead, at the speed of the sky', () => {
    expect(fallingBottom(note(60, 5, 1), 3, speed)).toBeCloseTo(2 * speed, 10)
  })

  it('reaches the line exactly when the note sounds, then sinks into it', () => {
    expect(fallingBottom(note(60, 5, 1), 5, speed)).toBe(0)
    expect(fallingBottom(note(60, 5, 1), 5.5, speed)).toBeCloseTo(-0.5 * speed, 10)
  })

  it('is as tall as the note is long', () => {
    expect(fallingHeight(note(60, 5, 1.5), speed)).toBeCloseTo(1.5 * speed, 10)
  })

  it('is never too short to be seen', () => {
    expect(fallingHeight(note(60, 5, 0.001), speed)).toBe(MIN_BAR_HEIGHT)
  })
})

describe('the glow where a note meets the line', () => {
  it('lights up with a flash in the middle of its key', () => {
    const impacts: Impact[] = []
    const impact = strikeImpact(impacts, MIDDLE_C, FULL)
    const key = keyRectOf(MIDDLE_C, FULL)
    expect(impact).toBe(only(impacts))
    expect(impact).toMatchObject({ midi: MIDDLE_C, sounding: true, level: 1, flash: 1 })
    expect(impact?.centre).toBeCloseTo((key?.left ?? 0) + (key?.width ?? 0) / 2, 10)
    expect(impact?.width).toBe(key?.width)
  })

  it('ignores notes that are not on the piano', () => {
    const impacts: Impact[] = []
    expect(strikeImpact(impacts, 47, SMALL)).toBeNull()
    expect(strikeImpact(impacts, 60.5, SMALL)).toBeNull()
    expect(impacts).toHaveLength(0)
  })

  it('settles its flash within FLASH_SECONDS', () => {
    const impacts: Impact[] = []
    strikeImpact(impacts, MIDDLE_C, FULL)
    advanceImpacts(impacts, FLASH_SECONDS / 2)
    expect(only(impacts).flash).toBeCloseTo(0.5, 10)
    advanceImpacts(impacts, FLASH_SECONDS / 2 + 0.001)
    expect(only(impacts)).toMatchObject({ flash: 0, level: 1, sounding: true })
  })

  it('stays for as long as the note sounds', () => {
    const impacts: Impact[] = []
    strikeImpact(impacts, MIDDLE_C, FULL)
    for (let frame = 0; frame < 600; frame++) advanceImpacts(impacts, FRAME)
    expect(only(impacts)).toMatchObject({ level: 1, sounding: true })
  })

  it('fades out within AFTERGLOW_SECONDS of the note stopping, and is then removed', () => {
    const impacts: Impact[] = []
    strikeImpact(impacts, MIDDLE_C, FULL)
    advanceImpacts(impacts, 1)
    releaseImpact(impacts, MIDDLE_C)
    advanceImpacts(impacts, AFTERGLOW_SECONDS / 2)
    expect(only(impacts).level).toBeCloseTo(0.5, 10)
    advanceImpacts(impacts, AFTERGLOW_SECONDS / 2 + 0.001)
    expect(impacts).toHaveLength(0)
  })

  it('flashes again, in the same glow, when the note is struck again before it has faded', () => {
    const impacts: Impact[] = []
    const first = strikeImpact(impacts, MIDDLE_C, FULL)
    advanceImpacts(impacts, 1)
    releaseImpact(impacts, MIDDLE_C)
    advanceImpacts(impacts, AFTERGLOW_SECONDS / 2)
    const second = strikeImpact(impacts, MIDDLE_C, FULL)
    expect(second).toBe(first)
    expect(only(impacts)).toMatchObject({ sounding: true, level: 1, flash: 1 })
  })

  it('moves with its key when the piano on screen changes', () => {
    const impacts: Impact[] = []
    strikeImpact(impacts, 48, FULL)
    const onFull = only(impacts).centre
    strikeImpact(impacts, 48, SMALL)
    expect(only(impacts).centre).toBeLessThan(onFull)
  })

  it('does nothing when a note without a glow stops', () => {
    const impacts: Impact[] = []
    strikeImpact(impacts, MIDDLE_C, FULL)
    releaseImpact(impacts, D)
    expect(only(impacts).sounding).toBe(true)
  })

  it('counts the notes that are sounding, not the ones fading', () => {
    const impacts: Impact[] = []
    strikeImpact(impacts, MIDDLE_C, FULL)
    strikeImpact(impacts, D, FULL)
    strikeImpact(impacts, C_SHARP, FULL)
    releaseImpact(impacts, D)
    expect(soundingCount(impacts)).toBe(2)
    expect(soundingCount([])).toBe(0)
  })

  it('is moving while it flashes or fades, and still once it has settled', () => {
    const impacts: Impact[] = []
    expect(impactsAreMoving(impacts)).toBe(false)
    strikeImpact(impacts, MIDDLE_C, FULL)
    expect(impactsAreMoving(impacts)).toBe(true)
    advanceImpacts(impacts, FLASH_SECONDS + 0.01)
    expect(impactsAreMoving(impacts)).toBe(false)
    releaseImpact(impacts, MIDDLE_C)
    expect(impactsAreMoving(impacts)).toBe(true)
    advanceImpacts(impacts, AFTERGLOW_SECONDS + 0.01)
    expect(impactsAreMoving(impacts)).toBe(false)
  })

  it('reduced motion: keeps a steady glow for sounding notes and none for the others', () => {
    const impacts: Impact[] = []
    strikeImpact(impacts, MIDDLE_C, FULL)
    strikeImpact(impacts, D, FULL)
    releaseImpact(impacts, MIDDLE_C)
    settleImpacts(impacts)
    expect(only(impacts)).toMatchObject({ midi: D, level: 1, flash: 0, sounding: true })
    expect(impactsAreMoving(impacts)).toBe(false)
  })
})

describe('how much is sounding', () => {
  it('follows the number of notes, quickly up and more slowly down', () => {
    const up = easePresence(0, 4, FRAME)
    const down = easePresence(4, 0, FRAME)
    expect(up).toBeGreaterThan(0)
    expect(up).toBeLessThan(4)
    expect(down).toBeLessThan(4)
    expect(up - 0).toBeGreaterThan(4 - down)
  })

  it('arrives, exactly, so that the sky can go still', () => {
    let presence = 0
    let frames = 0
    while (presence !== 3 && frames < 600) {
      presence = easePresence(presence, 3, FRAME)
      frames++
    }
    expect(presence).toBe(3)
    expect(frames).toBeLessThan(60)

    frames = 0
    while (presence !== 0 && frames < 600) {
      presence = easePresence(presence, 0, FRAME)
      frames++
    }
    expect(presence).toBe(0)
    expect(frames).toBeLessThan(180)
  })

  it('never overshoots, whatever the step', () => {
    for (const seconds of [0, 0.001, FRAME, 0.05, 5]) {
      const up = easePresence(1, 6, seconds)
      const down = easePresence(6, 1, seconds)
      expect(up).toBeGreaterThanOrEqual(1)
      expect(up).toBeLessThanOrEqual(6)
      expect(down).toBeGreaterThanOrEqual(1)
      expect(down).toBeLessThanOrEqual(6)
    }
  })

  it('makes the line glow more with every note, gently, and never past 1', () => {
    expect(lineGlow(0)).toBe(0)
    let previous = 0
    for (let notes = 1; notes <= 30; notes++) {
      const glow = lineGlow(notes)
      expect(glow).toBeGreaterThan(previous)
      expect(glow).toBeLessThanOrEqual(1)
      previous = glow
    }
    // A chord is clearly brighter than a single note…
    expect(lineGlow(4)).toBeGreaterThan(lineGlow(1) * 2)
    // …but the tenth note adds much less than the second did.
    expect(lineGlow(10) - lineGlow(9)).toBeLessThan((lineGlow(2) - lineGlow(1)) / 4)
    expect(lineGlow(-3)).toBe(0)
  })

  it('brightens the background by up to a quarter, reached at eight notes', () => {
    expect(backgroundBoost(0)).toBe(0)
    expect(backgroundBoost(4)).toBeCloseTo(MAX_BACKGROUND_BOOST / 2, 10)
    expect(backgroundBoost(8)).toBe(MAX_BACKGROUND_BOOST)
    expect(backgroundBoost(40)).toBe(MAX_BACKGROUND_BOOST)
    expect(backgroundBoost(-1)).toBe(0)
    expect(MAX_BACKGROUND_BOOST).toBe(0.25)
  })
})

describe('sparks', () => {
  function soundingImpacts(count: number): Impact[] {
    const impacts: Impact[] = []
    for (let i = 0; i < count; i++) strikeImpact(impacts, 40 + i * 4, FULL)
    return impacts
  }

  /** Lets `seconds` pass with these notes sounding. Returns the most sparks alive at any moment. */
  function run(
    sparks: Sparks,
    impacts: Impact[],
    level: SparksLevel,
    seconds: number,
    random: () => number,
  ): number {
    let most = sparks.count
    for (let frame = 0; frame < Math.round(seconds / FRAME); frame++) {
      emitSparks(sparks, impacts, level, FRAME, WIDTH, random)
      advanceSparks(sparks, FRAME)
      most = Math.max(most, sparks.count)
    }
    return most
  }

  it('are born on the line, within the key of their note, flying upward', () => {
    const sparks = createSparks()
    const impacts = soundingImpacts(1)
    const impact = only(impacts)
    strikeSparks(sparks, impact, 'lots', WIDTH, seededRandom(1))
    expect(sparks.count).toBeGreaterThan(0)
    const keyLeft = (impact.centre - impact.width / 2) * WIDTH
    const keyRight = (impact.centre + impact.width / 2) * WIDTH
    for (let i = 0; i < sparks.count; i++) {
      expect(sparks.y[i]).toBe(0)
      expect(sparks.x[i]).toBeGreaterThan(keyLeft)
      expect(sparks.x[i]).toBeLessThan(keyRight)
      expect(sparks.vy[i]).toBeGreaterThan(0)
      expect(Math.abs(sparks.vx[i] ?? 0)).toBeLessThan(sparks.vy[i] ?? 0)
      expect(sparks.midi[i]).toBe(impact.midi)
      expect(sparks.age[i]).toBe(0)
    }
  })

  it('rise, slow down, and are gone within about a second', () => {
    const sparks = createSparks()
    strikeSparks(sparks, only(soundingImpacts(1)), 'some', WIDTH, seededRandom(2))
    const born = sparks.count
    const startSpeed = sparks.vy[0] ?? 0
    advanceSparks(sparks, 0.2)
    expect(sparks.count).toBe(born)
    expect(sparks.y[0]).toBeGreaterThan(0)
    expect(sparks.vy[0]).toBeLessThan(startSpeed)
    expect(sparks.vy[0]).toBeGreaterThan(0)
    for (let frame = 0; frame < 70; frame++) advanceSparks(sparks, FRAME)
    expect(sparks.count).toBe(0)
  })

  it('fade over their life', () => {
    const sparks = createSparks()
    strikeSparks(sparks, only(soundingImpacts(1)), 'some', WIDTH, seededRandom(3))
    expect(sparkStrength(sparks, 0)).toBe(1)
    advanceSparks(sparks, 0.2)
    const later = sparkStrength(sparks, 0)
    expect(later).toBeLessThan(1)
    expect(later).toBeGreaterThan(0)
    expect(sparkStrength(sparks, MAX_SPARKS - 1)).toBe(0)
  })

  it('trickle steadily from every sounding note, at a rate that does not depend on the frame rate', () => {
    const impacts = soundingImpacts(2)
    const smooth = createSparks()
    const choppy = createSparks()
    for (let frame = 0; frame < 120; frame++) emitSparks(smooth, impacts, 'some', 1 / 120, WIDTH, seededRandom(4))
    for (const impact of impacts) impact.sparkDebt = 0
    for (let frame = 0; frame < 20; frame++) emitSparks(choppy, impacts, 'some', 1 / 20, WIDTH, seededRandom(4))
    expect(smooth.count).toBeGreaterThan(10)
    expect(Math.abs(smooth.count - choppy.count)).toBeLessThanOrEqual(2)
  })

  it('come from sounding notes only', () => {
    const sparks = createSparks()
    const impacts = soundingImpacts(1)
    releaseImpact(impacts, only(impacts).midi)
    emitSparks(sparks, impacts, 'lots', 1, WIDTH, seededRandom(5))
    expect(sparks.count).toBe(0)
  })

  it('are about three times as many with "lots" as with "some", and none with "off"', () => {
    const count = (level: SparksLevel): number => {
      const sparks = createSparks()
      emitSparks(sparks, soundingImpacts(3), level, 2, WIDTH, seededRandom(6))
      return sparks.count
    }
    expect(count('off')).toBe(0)
    expect(count('some')).toBeGreaterThan(0)
    expect(count('lots') / count('some')).toBeGreaterThan(2.5)
    expect(count('lots') / count('some')).toBeLessThan(3.5)

    const struck = createSparks()
    strikeSparks(struck, only(soundingImpacts(1)), 'off', WIDTH, seededRandom(6))
    expect(struck.count).toBe(0)
  })

  it('stay inside the budget with ten notes held at the highest level, without any being turned away', () => {
    const sparks = createSparks()
    const impacts = soundingImpacts(10)
    const random = seededRandom(7)
    for (const impact of impacts) strikeSparks(sparks, impact, 'lots', WIDTH, random)
    const most = run(sparks, impacts, 'lots', 10, random)
    expect(most).toBeGreaterThan(200)
    expect(most).toBeLessThan(MAX_SPARKS)
  })

  it('never pass MAX_SPARKS, whatever is played', () => {
    const sparks = createSparks()
    const impacts: Impact[] = []
    for (let midi = FULL.first; midi <= FULL.last; midi++) strikeImpact(impacts, midi, FULL)
    const random = seededRandom(8)
    let most = 0
    for (let round = 0; round < 20; round++) {
      for (const impact of impacts) strikeSparks(sparks, impact, 'lots', WIDTH, random)
      most = Math.max(most, run(sparks, impacts, 'lots', 0.2, random))
    }
    expect(most).toBe(MAX_SPARKS)
    expect(sparks.count).toBeLessThanOrEqual(MAX_SPARKS)
  })

  it('all go out once the notes stop', () => {
    const sparks = createSparks()
    const impacts = soundingImpacts(5)
    const random = seededRandom(9)
    run(sparks, impacts, 'lots', 2, random)
    expect(sparks.count).toBeGreaterThan(0)
    for (const impact of impacts) releaseImpact(impacts, impact.midi)
    run(sparks, impacts, 'lots', 1.2, random)
    expect(sparks.count).toBe(0)
  })

  it('keep every spark whole when others are removed around it', () => {
    const sparks = createSparks()
    const impacts = soundingImpacts(6)
    const random = seededRandom(10)
    run(sparks, impacts, 'lots', 3, random)
    for (let i = 0; i < sparks.count; i++) {
      expect(sparks.age[i]).toBeLessThan(sparks.life[i] ?? 0)
      expect(sparks.life[i]).toBeGreaterThan(0.4)
      expect(sparks.life[i]).toBeLessThan(1.1)
      expect(sparks.radius[i]).toBeGreaterThan(0)
      expect(sparks.y[i]).toBeGreaterThanOrEqual(0)
      expect(impacts.some((impact) => impact.midi === sparks.midi[i])).toBe(true)
    }
  })
})

describe('seededRandom', () => {
  it('gives the same numbers for the same seed, and others for another seed', () => {
    const first = seededRandom(123)
    const second = seededRandom(123)
    const other = seededRandom(124)
    const numbers = Array.from({ length: 20 }, () => first())
    expect(Array.from({ length: 20 }, () => second())).toEqual(numbers)
    expect(Array.from({ length: 20 }, () => other())).not.toEqual(numbers)
  })

  it('stays between 0 and 1 and is spread over all of it', () => {
    const random = seededRandom(99)
    let low = 0
    for (let i = 0; i < 4000; i++) {
      const value = random()
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
      if (value < 0.5) low++
    }
    expect(low).toBeGreaterThan(1800)
    expect(low).toBeLessThan(2200)
  })
})

describe('starField', () => {
  it('gives the same stars every time for the same seed', () => {
    expect(starField(300, 5)).toEqual(starField(300, 5))
    expect(starField(300, 5)).not.toEqual(starField(300, 6))
  })

  it('gives the number of stars asked for, each inside the sky', () => {
    const stars = starField(250, 1)
    expect(stars).toHaveLength(250 * STAR_FIELDS)
    for (let at = 0; at < stars.length; at += STAR_FIELDS) {
      expect(stars[at]).toBeGreaterThanOrEqual(0)
      expect(stars[at]).toBeLessThan(1)
      expect(stars[at + 1]).toBeGreaterThanOrEqual(0)
      expect(stars[at + 1]).toBeLessThan(1)
      expect(stars[at + 2]).toBeGreaterThan(0)
      expect(stars[at + 2]).toBeLessThan(2)
      expect(stars[at + 3]).toBeGreaterThan(0)
      expect(stars[at + 3]).toBeLessThanOrEqual(1)
    }
  })

  it('puts more stars near the top of the sky than near the line', () => {
    const stars = starField(2000, 3)
    let upperHalf = 0
    for (let at = 0; at < stars.length; at += STAR_FIELDS) {
      if ((stars[at + 1] ?? 1) < 0.5) upperHalf++
    }
    expect(upperHalf).toBeGreaterThan(1300)
  })

  it('makes most stars faint and a few bright', () => {
    const stars = starField(2000, 4)
    let bright = 0
    for (let at = 0; at < stars.length; at += STAR_FIELDS) {
      if ((stars[at + 3] ?? 0) > 0.6) bright++
    }
    expect(bright).toBeGreaterThan(20)
    expect(bright).toBeLessThan(700)
  })

  it('copes with odd counts', () => {
    expect(starField(0, 1)).toHaveLength(0)
    expect(starField(-4, 1)).toHaveLength(0)
    expect(starField(2.9, 1)).toHaveLength(2 * STAR_FIELDS)
  })
})

describe('the two pianos used here', () => {
  it('are the ones the tests assume', () => {
    const full: PianoRange = FULL
    expect(full).toEqual({ first: 21, last: 108 })
    expect(SMALL).toEqual({ first: 48, last: 84 })
  })
})
