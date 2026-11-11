import { describe, expect, it } from 'vitest'
import { MAX_BASE_OCTAVE, MIN_BASE_OCTAVE } from '../core/layout'
import { formatPercent, formatSigned, pianoRangeLabel, toPercent } from './format'

describe('toPercent', () => {
  it('gives whole numbers', () => {
    expect(toPercent(0)).toBe(0)
    expect(toPercent(0.1)).toBe(10)
    expect(toPercent(0.15)).toBe(15)
    expect(toPercent(0.29)).toBe(29)
    expect(toPercent(0.8)).toBe(80)
    expect(toPercent(1)).toBe(100)
  })

  it('survives the trip to a slider and back for every step', () => {
    for (let percent = 0; percent <= 100; percent++) {
      expect(toPercent(percent / 100)).toBe(percent)
    }
  })
})

describe('formatPercent', () => {
  it('writes a fraction as a percentage', () => {
    expect(formatPercent(0)).toBe('0%')
    expect(formatPercent(0.8)).toBe('80%')
    expect(formatPercent(1)).toBe('100%')
  })
})

describe('formatSigned', () => {
  it('shows the sign of everything but zero', () => {
    expect(formatSigned(0)).toBe('0')
    expect(formatSigned(2)).toBe('+2')
    expect(formatSigned(12)).toBe('+12')
  })

  it('uses a real minus sign, not a hyphen', () => {
    expect(formatSigned(-3)).toBe('−3')
    expect(formatSigned(-12)).toBe('−12')
    expect(formatSigned(-3).codePointAt(0)).toBe(0x2212)
  })
})

describe('pianoRangeLabel', () => {
  it('names the lowest and highest note of the piano', () => {
    expect(pianoRangeLabel(3, 'letters')).toBe('C3 – C6')
    expect(pianoRangeLabel(MIN_BASE_OCTAVE, 'letters')).toBe('C1 – C4')
    expect(pianoRangeLabel(MAX_BASE_OCTAVE, 'letters')).toBe('C5 – C8')
  })

  it('follows the note naming', () => {
    expect(pianoRangeLabel(3, 'solfege')).toBe('Do3 – Do6')
  })
})
