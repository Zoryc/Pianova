import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ARRANGE_OPTIONS,
  DEFAULT_PLAY_OPTIONS,
  MAX_SPEED,
  MAX_TITLE_LENGTH,
  MIN_SPEED,
  UNTITLED,
  cleanTitle,
  formatDuration,
  instrumentName,
  summarize,
  titleFromFileName,
} from './song'
import type { Song, SongTrack } from './song'

function part(overrides: Partial<SongTrack> = {}): SongTrack {
  return { id: 0, name: '', isPercussion: false, program: null, notes: [], ...overrides }
}

describe('cleanTitle', () => {
  it('leaves an ordinary title alone', () => {
    expect(cleanTitle('Ode to Joy')).toBe('Ode to Joy')
    expect(cleanTitle('Frère Jacques')).toBe('Frère Jacques')
  })

  it('trims the ends and collapses runs of spaces, tabs and line breaks', () => {
    expect(cleanTitle('   Moonlight \t  Sonata \r\n part 1  ')).toBe('Moonlight Sonata part 1')
  })

  it('removes control characters without gluing words together', () => {
    expect(cleanTitle('Air\u0000on\u0007the\u007fG\u0085string')).toBe('Air on the G string')
    expect(cleanTitle('\u0000\u0000Prelude\u0000\u0000')).toBe('Prelude')
  })

  it('cuts a long title to the limit and leaves no space at the cut', () => {
    expect(cleanTitle('a'.repeat(200))).toBe('a'.repeat(MAX_TITLE_LENGTH))
    const cutAtASpace = `${'b'.repeat(MAX_TITLE_LENGTH - 1)} tail`
    expect(cleanTitle(cutAtASpace)).toBe('b'.repeat(MAX_TITLE_LENGTH - 1))
  })

  it('counts whole characters, so a character outside the basic plane is never cut in half', () => {
    const title = cleanTitle('𝄞'.repeat(MAX_TITLE_LENGTH + 5))
    expect(Array.from(title)).toHaveLength(MAX_TITLE_LENGTH)
    expect(Array.from(title).every((character) => character === '𝄞')).toBe(true)
  })

  it('gives the placeholder title when nothing readable is left', () => {
    expect(cleanTitle('')).toBe(UNTITLED)
    expect(cleanTitle('   ')).toBe(UNTITLED)
    expect(cleanTitle('\u0000\t\n\u001f')).toBe(UNTITLED)
    expect(UNTITLED).toBe('Untitled song')
  })

  it('copes with a value that is not a string', () => {
    expect(cleanTitle(undefined as unknown as string)).toBe('undefined')
    expect(cleanTitle(42 as unknown as string)).toBe('42')
  })
})

describe('titleFromFileName', () => {
  it('drops the extension', () => {
    expect(titleFromFileName('fur_elise.mid')).toBe('fur_elise')
    expect(titleFromFileName('Clair de Lune.MIDI')).toBe('Clair de Lune')
    expect(titleFromFileName('song.kar')).toBe('song')
  })

  it('drops the folders, whichever way the slashes lean', () => {
    expect(titleFromFileName('C:\\music\\fur_elise.mid')).toBe('fur_elise')
    expect(titleFromFileName('music/classical/fur_elise.mid')).toBe('fur_elise')
    expect(titleFromFileName('music\\mixed/gymnopedie.mid')).toBe('gymnopedie')
  })

  it('only drops the last extension', () => {
    expect(titleFromFileName('prelude.final.mid')).toBe('prelude.final')
  })

  it('keeps a name that has no extension', () => {
    expect(titleFromFileName('nocturne')).toBe('nocturne')
    expect(titleFromFileName('a name with a very-long.ending-that-is-no-extension')).toBe(
      'a name with a very-long.ending-that-is-no-extension',
    )
  })

  it('cleans the name as a title', () => {
    expect(titleFromFileName('  two   spaces.mid')).toBe('two spaces')
    expect(titleFromFileName(`${'n'.repeat(120)}.mid`)).toBe('n'.repeat(MAX_TITLE_LENGTH))
  })

  it('gives the placeholder title when there is no name', () => {
    expect(titleFromFileName('')).toBe(UNTITLED)
    expect(titleFromFileName('.mid')).toBe(UNTITLED)
    expect(titleFromFileName('folder/')).toBe(UNTITLED)
  })
})

describe('summarize', () => {
  const song: Song = {
    id: 'abc',
    title: 'Two parts',
    duration: 12.5,
    createdAt: 1_700_000_000_000,
    tracks: [
      part({
        id: 0,
        notes: [
          { midi: 60, time: 0, duration: 1, velocity: 0.8 },
          { midi: 64, time: 1, duration: 1, velocity: 0.8 },
        ],
      }),
      part({
        id: 1,
        isPercussion: true,
        notes: [{ midi: 36, time: 0, duration: 0.1, velocity: 1 }],
      }),
    ],
  }

  it('copies what the song list shows and counts the notes of every part', () => {
    expect(summarize(song)).toEqual({
      id: 'abc',
      title: 'Two parts',
      duration: 12.5,
      noteCount: 3,
      createdAt: 1_700_000_000_000,
    })
  })

  it('counts no notes for a song with no parts', () => {
    expect(summarize({ ...song, tracks: [] }).noteCount).toBe(0)
  })
})

describe('instrumentName', () => {
  it('names the family of each group of eight instruments', () => {
    const families = [
      'Piano',
      'Chimes',
      'Organ',
      'Guitar',
      'Bass',
      'Strings',
      'Ensemble',
      'Brass',
      'Reed',
      'Flute',
      'Synth lead',
      'Synth pad',
      'Synth effects',
      'World',
      'Percussion',
      'Sound effects',
    ]
    for (let program = 0; program <= 127; program++) {
      expect(instrumentName(part({ program }))).toBe(families[Math.floor(program / 8)])
    }
  })

  it('says "Drums" for a percussion part, whatever its instrument number', () => {
    expect(instrumentName(part({ isPercussion: true, program: 0 }))).toBe('Drums')
    expect(instrumentName(part({ isPercussion: true }))).toBe('Drums')
  })

  it('says "Instrument" when the file does not say, or says something impossible', () => {
    expect(instrumentName(part({ program: null }))).toBe('Instrument')
    for (const program of [-1, 128, 3.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(instrumentName(part({ program }))).toBe('Instrument')
    }
  })
})

describe('formatDuration', () => {
  it('writes minutes and seconds', () => {
    expect(formatDuration(0)).toBe('0:00')
    expect(formatDuration(42)).toBe('0:42')
    expect(formatDuration(187)).toBe('3:07')
    expect(formatDuration(600)).toBe('10:00')
    expect(formatDuration(3599)).toBe('59:59')
  })

  it('adds the hours when there are any', () => {
    expect(formatDuration(3600)).toBe('1:00:00')
    expect(formatDuration(3735)).toBe('1:02:15')
    expect(formatDuration(360_000)).toBe('100:00:00')
  })

  it('drops the part of a second, so a time never shows before it is reached', () => {
    expect(formatDuration(59.999)).toBe('0:59')
    expect(formatDuration(0.4)).toBe('0:00')
  })

  it('is never negative and never "NaN"', () => {
    for (const odd of [-5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(formatDuration(odd)).toBe('0:00')
    }
    expect(formatDuration(undefined as unknown as number)).toBe('0:00')
  })
})

describe('the default options', () => {
  it('play every part that is not percussion, as written, at the song’s own speed', () => {
    expect(DEFAULT_ARRANGE_OPTIONS).toEqual({
      trackIds: 'auto',
      melodyOnly: false,
      fitToPiano: false,
    })
    expect(DEFAULT_PLAY_OPTIONS).toEqual({ ...DEFAULT_ARRANGE_OPTIONS, speed: 1 })
  })

  it('cannot be changed by accident', () => {
    expect(Object.isFrozen(DEFAULT_ARRANGE_OPTIONS)).toBe(true)
    expect(Object.isFrozen(DEFAULT_PLAY_OPTIONS)).toBe(true)
  })

  it('allow half speed to one and a half times the speed', () => {
    expect(MIN_SPEED).toBe(0.5)
    expect(MAX_SPEED).toBe(1.5)
    expect(DEFAULT_PLAY_OPTIONS.speed).toBeGreaterThanOrEqual(MIN_SPEED)
    expect(DEFAULT_PLAY_OPTIONS.speed).toBeLessThanOrEqual(MAX_SPEED)
  })
})
