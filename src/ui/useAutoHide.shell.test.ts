/**
 * The rules of the hiding menu (createAutoHide) against a long, shuffled run
 * of everything that can happen to it. After each step the menu must be
 * exactly where one plain sentence says it is:
 *
 *   shown while there is a reason to stay, or for 2.5 seconds after the
 *   mouse last moved or the last reason to stay came or went.
 *
 * The shuffling is seeded, so a failure can be run again.
 */
import { describe, expect, it } from 'vitest'
import { AUTO_HIDE_DELAY_MS, createAutoHide } from './useAutoHide'
import type { AutoHideTimer } from './useAutoHide'

/** A small seeded generator of numbers from 0 up to (not including) 1. */
function seeded(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state)
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296
  }
}

/** A clock that stands still until the test moves it, and counts the countdowns that are waiting. */
function handClock(): { timer: AutoHideTimer; advance(ms: number): void; now(): number; waiting(): number } {
  let now = 0
  let lastHandle = 0
  const waiting = new Map<number, { due: number; handler: () => void }>()
  return {
    timer: {
      setTimeout(handler, ms) {
        lastHandle += 1
        waiting.set(lastHandle, { due: now + ms, handler })
        return lastHandle
      },
      clearTimeout(handle) {
        waiting.delete(handle as number)
      },
    },
    advance(ms) {
      const until = now + ms
      for (;;) {
        const next = [...waiting].filter(([, { due }]) => due <= until).sort((a, b) => a[1].due - b[1].due)[0]
        if (!next) break
        waiting.delete(next[0])
        now = next[1].due
        next[1].handler()
      }
      now = until
    },
    now: () => now,
    waiting: () => waiting.size,
  }
}

interface Reasons {
  switchedOff: boolean
  pinned: boolean
  hovered: boolean
  focused: boolean
}

function mustStay(reasons: Reasons): boolean {
  return reasons.switchedOff || reasons.pinned || reasons.hovered || reasons.focused
}

describe('createAutoHide, through 40 shuffled runs of 400 steps', () => {
  it.each(Array.from({ length: 40 }, (_, run) => run + 1))('run %i', (seed) => {
    const random = seeded(seed * 7919)
    const clock = handClock()
    const reasons: Reasons = {
      switchedOff: random() < 0.2,
      pinned: random() < 0.3,
      hovered: false,
      focused: false,
    }
    const changes: boolean[] = []
    const autoHide = createAutoHide(
      { enabled: !reasons.switchedOff, pinned: reasons.pinned },
      (visible) => changes.push(visible),
      clock.timer,
    )
    /** When the 2.5 seconds last started again. */
    let shownAt = 0

    function setReason(name: keyof Reasons, value: boolean): void {
      const stayed = mustStay(reasons)
      reasons[name] = value
      if (mustStay(reasons) !== stayed) shownAt = clock.now()
      if (name === 'switchedOff') autoHide.setEnabled(!value)
      if (name === 'pinned') autoHide.setPinned(value)
      if (name === 'hovered') autoHide.setHovered(value)
      if (name === 'focused') autoHide.setFocused(value)
    }

    for (let step = 0; step < 400; step++) {
      const dice = random()
      if (dice < 0.3) {
        clock.advance(Math.floor(random() * 3000))
      } else if (dice < 0.34) {
        // Right up to the moment it must hide, and then that moment.
        clock.advance(Math.max(0, shownAt + AUTO_HIDE_DELAY_MS - 1 - clock.now()))
      } else if (dice < 0.5) {
        autoHide.activity()
        shownAt = clock.now()
      } else if (dice < 0.62) {
        setReason('hovered', random() < 0.5)
      } else if (dice < 0.74) {
        setReason('focused', random() < 0.5)
      } else if (dice < 0.86) {
        setReason('pinned', random() < 0.5)
      } else if (dice < 0.9) {
        setReason('switchedOff', random() < 0.3)
      } else {
        clock.advance(1)
      }

      const expected = mustStay(reasons) || clock.now() - shownAt < AUTO_HIDE_DELAY_MS
      expect(autoHide.isVisible(), `step ${step}`).toBe(expected)
      // One countdown at most, and only while the menu is shown with no reason to stay.
      expect(clock.waiting(), `step ${step}`).toBe(expected && !mustStay(reasons) ? 1 : 0)
    }

    // It only ever said so when it changed: shown and hidden take turns, starting with hidden.
    changes.forEach((visible, index) => expect(visible).toBe(index % 2 === 1))

    autoHide.dispose()
    expect(clock.waiting()).toBe(0)
    const said = changes.length
    autoHide.activity()
    autoHide.setPinned(!reasons.pinned)
    clock.advance(AUTO_HIDE_DELAY_MS * 2)
    expect(changes).toHaveLength(said)
  })
})
