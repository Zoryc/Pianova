import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_VELOCITY, NoteBus } from '../core/noteBus'
import type { Midi, NoteEvent } from '../core/types'
import { attachKeyboardInput, isTextEntryTarget } from './keyboardInput'
import type { KeyEventTarget, KeyboardInputOptions } from './keyboardInput'

type Listener = (event: never) => void

/** Stands in for `window` (or `document`): keeps the listeners so a test can fire events at them. */
class FakeTarget implements KeyEventTarget {
  private readonly listeners = new Map<string, Set<Listener>>()

  addEventListener(type: string, listener: Listener): void {
    const listenersOfType = this.listeners.get(type) ?? new Set<Listener>()
    listenersOfType.add(listener)
    this.listeners.set(type, listenersOfType)
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener)
  }

  fire(type: string, event: unknown = {}): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event as never)
  }

  /** Event types that currently have at least one listener, sorted. */
  listenedTypes(): string[] {
    return [...this.listeners]
      .filter(([, listenersOfType]) => listenersOfType.size > 0)
      .map(([type]) => type)
      .sort()
  }
}

interface FakeKeyEvent {
  code: string
  key: string
  repeat: boolean
  ctrlKey: boolean
  altKey: boolean
  metaKey: boolean
  shiftKey: boolean
  timeStamp: number
  target: unknown
  preventDefault: ReturnType<typeof vi.fn>
}

const PAGE_BODY = { tagName: 'BODY' }
const TEXT_FIELD = { tagName: 'INPUT', type: 'text' }
const FOCUSED_BUTTON = { tagName: 'BUTTON', type: 'button' }

function keyEvent(code: string, overrides: Partial<FakeKeyEvent> = {}): FakeKeyEvent {
  return {
    code,
    key: '',
    repeat: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    shiftKey: false,
    timeStamp: 1000,
    target: PAGE_BODY,
    preventDefault: vi.fn(),
    ...overrides,
  }
}

/** What each bound key plays at the start of a test. */
const BOUND_NOTES: Readonly<Record<string, Midi>> = { KeyA: 60, KeyS: 62, KeyD: 64, Quote: 77 }

function setup(extraOptions: Partial<KeyboardInputOptions> = {}) {
  const bus = new NoteBus()
  const events: NoteEvent[] = []
  bus.subscribe((event) => events.push(event))
  const target = new FakeTarget()
  /** Tests change this to simulate a rebinding or the piano moving lower / higher. */
  const notes: Record<string, Midi> = { ...BOUND_NOTES }

  const detach = attachKeyboardInput({
    bus,
    resolveNote: (code) => notes[code] ?? null,
    target,
    ...extraOptions,
  })

  function press(code: string, overrides?: Partial<FakeKeyEvent>): FakeKeyEvent {
    const event = keyEvent(code, overrides)
    target.fire('keydown', event)
    return event
  }

  function release(code: string, overrides?: Partial<FakeKeyEvent>): FakeKeyEvent {
    const event = keyEvent(code, overrides)
    target.fire('keyup', event)
    return event
  }

  return { bus, events, target, notes, detach, press, release }
}

/** Compact view of bus events, e.g. ['on:60', 'off:60']. */
function summary(events: readonly NoteEvent[]): string[] {
  return events.map((event) => `${event.type}:${event.midi}`)
}

describe('attachKeyboardInput: playing notes', () => {
  it('sends key down and key up to the bus as keyboard notes, timed by the events', () => {
    const { events, press, release } = setup()

    press('KeyA', { timeStamp: 1234.5 })
    release('KeyA', { timeStamp: 1300 })

    expect(events).toEqual([
      { type: 'on', midi: 60, velocity: DEFAULT_VELOCITY, source: 'keyboard', time: 1234.5 },
      { type: 'off', midi: 60, source: 'keyboard', time: 1300 },
    ])
  })

  it('lets the bus pick the time when the event has no usable timestamp', () => {
    const { events, press, release } = setup()

    press('KeyA', { timeStamp: Number.NaN })
    release('KeyA', { timeStamp: undefined })

    expect(summary(events)).toEqual(['on:60', 'off:60'])
    expect(events.every((event) => Number.isFinite(event.time))).toBe(true)
  })

  it('plays several keys at once and releases each one separately', () => {
    const { bus, events, press, release } = setup()

    press('KeyA')
    press('KeyD')
    release('KeyA')

    expect(summary(events)).toEqual(['on:60', 'on:64', 'off:60'])
    expect([...bus.getActiveNotes()]).toEqual([64])
  })

  it('uses getVelocity for each new note when it is provided', () => {
    let velocity = 0.3
    const { events, press } = setup({ getVelocity: () => velocity })

    press('KeyA')
    velocity = 0.95
    press('KeyS')

    expect(events).toMatchObject([
      { type: 'on', midi: 60, velocity: 0.3 },
      { type: 'on', midi: 62, velocity: 0.95 },
    ])
  })

  it('plays the same note with or without Shift', () => {
    const { events, press, release } = setup()

    const down = press('KeyA', { shiftKey: true })
    release('KeyA', { shiftKey: true })

    expect(summary(events)).toEqual(['on:60', 'off:60'])
    expect(down.preventDefault).toHaveBeenCalledTimes(1)
  })

  it('does not play on auto-repeat but still prevents the default of a bound key', () => {
    const { events, press } = setup()

    press('Quote')
    const repeat = press('Quote', { repeat: true })

    expect(summary(events)).toEqual(['on:77'])
    expect(repeat.preventDefault).toHaveBeenCalledTimes(1)
  })

  it('does not start a note from an auto-repeat whose first press was not played', () => {
    const { events, press } = setup()

    const repeat = press('KeyA', { repeat: true })

    expect(events).toEqual([])
    expect(repeat.preventDefault).toHaveBeenCalledTimes(1)
  })

  it('does not start a second note for a key that is already down', () => {
    const { events, notes, press, release } = setup()

    press('KeyA')
    notes.KeyA = 72
    const second = press('KeyA')
    release('KeyA')

    expect(summary(events)).toEqual(['on:60', 'off:60'])
    expect(second.preventDefault).toHaveBeenCalledTimes(1)
  })

  it('prevents the default of bound keys and leaves unbound keys alone', () => {
    const { events, press, release } = setup()

    const bound = press('Quote')
    const unbound = press('ArrowDown')
    const unboundUp = release('ArrowDown')

    expect(bound.preventDefault).toHaveBeenCalledTimes(1)
    expect(unbound.preventDefault).not.toHaveBeenCalled()
    expect(unboundUp.preventDefault).not.toHaveBeenCalled()
    expect(summary(events)).toEqual(['on:77'])
  })
})

describe('attachKeyboardInput: releasing notes', () => {
  it('releases the note the key started, even when the key now plays another note', () => {
    const { events, notes, press, release } = setup()

    press('KeyA')
    notes.KeyA = 72
    release('KeyA')

    expect(summary(events)).toEqual(['on:60', 'off:60'])
  })

  it('releases the original note when the key no longer plays anything', () => {
    const { bus, notes, press, release } = setup()

    press('KeyA')
    delete notes.KeyA
    const repeat = press('KeyA', { repeat: true })
    release('KeyA')

    expect(repeat.preventDefault).toHaveBeenCalledTimes(1)
    expect(bus.getActiveNotes().size).toBe(0)
  })

  it('ignores key up for a key that never started a note', () => {
    const { bus, events, press, release } = setup()

    press('KeyA')
    const strayBound = release('KeyS')
    const strayUnbound = release('Escape')
    release('KeyA')
    release('KeyA')

    expect(summary(events)).toEqual(['on:60', 'off:60'])
    expect(strayBound.preventDefault).not.toHaveBeenCalled()
    expect(strayUnbound.preventDefault).not.toHaveBeenCalled()
    expect(bus.getActiveNotes().size).toBe(0)
  })

  it('still releases when Ctrl, Alt or Meta is held at key up', () => {
    const { events, press, release } = setup()

    press('KeyA')
    press('KeyS')
    press('KeyD')
    release('KeyA', { ctrlKey: true })
    release('KeyS', { altKey: true })
    release('KeyD', { metaKey: true })

    expect(summary(events)).toEqual(['on:60', 'on:62', 'on:64', 'off:60', 'off:62', 'off:64'])
  })

  it('still releases when focus moved to a text field before key up', () => {
    const { events, press, release } = setup()

    press('KeyA')
    release('KeyA', { target: TEXT_FIELD })

    expect(summary(events)).toEqual(['on:60', 'off:60'])
  })

  it('keeps a note sounding until the last key holding it is released', () => {
    const { events, notes, press, release } = setup()

    press('KeyA')
    notes.KeyS = 60
    press('KeyS')
    release('KeyA')
    expect(summary(events)).toEqual(['on:60'])

    release('KeyS')
    expect(summary(events)).toEqual(['on:60', 'off:60'])
  })

  it('releases every held note when the window loses focus', () => {
    const { bus, events, target, press, release } = setup()

    press('KeyA')
    press('KeyS')
    target.fire('blur')

    expect(summary(events)).toEqual(['on:60', 'on:62', 'off:60', 'off:62'])
    expect(events.every((event) => event.source === 'keyboard')).toBe(true)

    press('KeyA', { repeat: true })
    release('KeyA')
    release('KeyS')

    expect(events).toHaveLength(4)
    expect(bus.getActiveNotes().size).toBe(0)
  })

  it('lets a key play again after the window lost focus', () => {
    const { events, target, press, release } = setup()

    press('KeyA')
    target.fire('blur')
    press('KeyA')
    release('KeyA')

    expect(summary(events)).toEqual(['on:60', 'off:60', 'on:60', 'off:60'])
  })

  it('only releases notes that the keyboard is holding', () => {
    const { bus, target, press } = setup()

    bus.noteOn(67, 'pointer')
    press('KeyA')
    target.fire('blur')

    expect([...bus.getActiveNotes()]).toEqual([67])
  })
})

describe('attachKeyboardInput: notes released by someone else', () => {
  it('no longer counts a key as holding a note that was released on the bus', () => {
    const { bus, events, notes, press, release } = setup()

    press('KeyA')
    bus.allOff()
    // A is still down. S now plays the note A started, as after the piano moved.
    notes.KeyS = 60
    press('KeyS')
    release('KeyS')

    expect(summary(events)).toEqual(['on:60', 'off:60', 'on:60', 'off:60'])
    expect(bus.getActiveNotes().size).toBe(0)
  })

  it('forgets the note whichever source let go of it last', () => {
    const { bus, events, notes, press, release } = setup()

    press('KeyA')
    bus.noteOn(60, 'pointer')
    bus.allOff()
    expect(events.at(-1)).toMatchObject({ type: 'off', midi: 60, source: 'pointer' })

    notes.KeyS = 60
    press('KeyS')
    release('KeyS')

    expect(bus.getActiveNotes().size).toBe(0)
  })

  it('keeps counting the keys that hold other notes', () => {
    const { bus, events, press, release } = setup()

    press('KeyA')
    press('KeyS')
    bus.noteOff(60, 'keyboard')
    release('KeyS')

    expect(summary(events)).toEqual(['on:60', 'on:62', 'off:60', 'off:62'])
  })

  it('stays silent while that key is still down, and plays again at its next press', () => {
    const { bus, events, press, release } = setup()

    press('KeyA')
    bus.allOff()
    const repeat = press('KeyA', { repeat: true })
    release('KeyA')
    expect(summary(events)).toEqual(['on:60', 'off:60'])
    expect(repeat.preventDefault).toHaveBeenCalledTimes(1)

    press('KeyA')
    release('KeyA')
    expect(summary(events)).toEqual(['on:60', 'off:60', 'on:60', 'off:60'])
  })
})

describe('attachKeyboardInput: the Meta key (Command / Windows)', () => {
  const META_DOWN = { key: 'Meta', metaKey: true }
  const META_UP = { key: 'Meta' }

  it('releases every held note when Meta goes up, not when it goes down', () => {
    const { events, press, release } = setup()

    press('KeyA')
    press('KeyS')
    press('MetaLeft', META_DOWN)
    expect(summary(events)).toEqual(['on:60', 'on:62'])

    // The system may have kept the key ups of A and S to itself while Meta was down.
    release('MetaLeft', META_UP)
    expect(summary(events)).toEqual(['on:60', 'on:62', 'off:60', 'off:62'])
    expect(events.every((event) => event.source === 'keyboard')).toBe(true)
  })

  it('lets a key play again after its key up was lost while Meta was down', () => {
    const { events, press, release } = setup()

    press('KeyA')
    press('MetaRight', META_DOWN)
    release('MetaRight', META_UP)
    press('KeyA')
    release('KeyA')

    expect(summary(events)).toEqual(['on:60', 'off:60', 'on:60', 'off:60'])
  })

  it('stays silent for a key that is still down when Meta goes up', () => {
    const { events, press, release } = setup()

    press('KeyA')
    press('MetaLeft', META_DOWN)
    release('MetaLeft', META_UP)
    const repeat = press('KeyA', { repeat: true })
    release('KeyA')

    expect(summary(events)).toEqual(['on:60', 'off:60'])
    expect(repeat.preventDefault).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['Control', 'ControlLeft'],
    ['Alt', 'AltLeft'],
    ['Shift', 'ShiftLeft'],
  ])('keeps notes sounding when %s goes up', (key, code) => {
    const { events, press, release } = setup()

    press('KeyA')
    release(code, { key })

    expect(summary(events)).toEqual(['on:60'])
  })
})

describe('attachKeyboardInput: keys left to the browser', () => {
  it.each(['ctrlKey', 'altKey', 'metaKey'] as const)(
    'does not play and does not prevent the default while %s is held',
    (modifier) => {
      const onToggleSustain = vi.fn()
      const resolveNote = vi.fn(() => 60)
      const { events, press, release } = setup({ onToggleSustain, resolveNote })

      const note = press('KeyA', { [modifier]: true })
      const space = press('Space', { [modifier]: true })
      const spaceUp = release('Space', { [modifier]: true })

      expect(events).toEqual([])
      expect(resolveNote).not.toHaveBeenCalled()
      expect(onToggleSustain).not.toHaveBeenCalled()
      expect(note.preventDefault).not.toHaveBeenCalled()
      expect(space.preventDefault).not.toHaveBeenCalled()
      expect(spaceUp.preventDefault).not.toHaveBeenCalled()
    },
  )

  it.each([
    ['a text field', TEXT_FIELD],
    ['a textarea', { tagName: 'TEXTAREA' }],
    ['a select', { tagName: 'SELECT' }],
    ['editable content', { tagName: 'DIV', isContentEditable: true }],
  ])('leaves typing in %s alone', (_name, textTarget) => {
    const onToggleSustain = vi.fn()
    const { events, press, release } = setup({ onToggleSustain })

    const note = press('KeyA', { target: textTarget })
    const space = press('Space', { target: textTarget })
    const spaceUp = release('Space', { target: textTarget })

    expect(events).toEqual([])
    expect(onToggleSustain).not.toHaveBeenCalled()
    expect(note.preventDefault).not.toHaveBeenCalled()
    expect(space.preventDefault).not.toHaveBeenCalled()
    expect(spaceUp.preventDefault).not.toHaveBeenCalled()
  })

  it('keeps playing when a slider, a checkbox or a button has focus', () => {
    const { events, press, release } = setup()

    for (const focused of [{ tagName: 'INPUT', type: 'range' }, { tagName: 'INPUT', type: 'checkbox' }, FOCUSED_BUTTON]) {
      press('KeyA', { target: focused })
      release('KeyA', { target: focused })
    }

    expect(summary(events)).toEqual(['on:60', 'off:60', 'on:60', 'off:60', 'on:60', 'off:60'])
  })
})

describe('attachKeyboardInput: Space toggles sustain', () => {
  it('calls onToggleSustain once per tap, never for auto-repeat, and plays no note', () => {
    const onToggleSustain = vi.fn()
    const { events, press, release } = setup({ onToggleSustain })

    press('Space')
    press('Space', { repeat: true })
    press('Space', { repeat: true })
    release('Space')
    expect(onToggleSustain).toHaveBeenCalledTimes(1)

    press('Space')
    release('Space')
    expect(onToggleSustain).toHaveBeenCalledTimes(2)
    expect(events).toEqual([])
  })

  it('prevents the default on key down, auto-repeat and key up', () => {
    const { press, release } = setup({ onToggleSustain: vi.fn() })

    const down = press('Space')
    const repeat = press('Space', { repeat: true })
    const up = release('Space')

    expect(down.preventDefault).toHaveBeenCalledTimes(1)
    expect(repeat.preventDefault).toHaveBeenCalledTimes(1)
    expect(up.preventDefault).toHaveBeenCalledTimes(1)
  })

  it('toggles once without clicking the button that has focus', () => {
    const onToggleSustain = vi.fn()
    const { press, release } = setup({ onToggleSustain })

    const down = press('Space', { target: FOCUSED_BUTTON })
    const up = release('Space', { target: FOCUSED_BUTTON })

    expect(onToggleSustain).toHaveBeenCalledTimes(1)
    expect(down.preventDefault).toHaveBeenCalledTimes(1)
    expect(up.preventDefault).toHaveBeenCalledTimes(1)
  })

  it('never asks resolveNote about Space, and works without onToggleSustain', () => {
    const resolveNote = vi.fn(() => 60)
    const { events, press, release } = setup({ resolveNote })

    const down = press('Space')
    release('Space')

    expect(resolveNote).not.toHaveBeenCalled()
    expect(events).toEqual([])
    expect(down.preventDefault).toHaveBeenCalledTimes(1)
  })
})

describe('attachKeyboardInput: intercept', () => {
  it('blocks the note and the sustain toggle, and prevents the default', () => {
    const onToggleSustain = vi.fn()
    const resolveNote = vi.fn(() => 60)
    const { events, press } = setup({ intercept: () => true, onToggleSustain, resolveNote })

    const note = press('KeyA')
    const space = press('Space')
    const unbound = press('Enter')

    expect(events).toEqual([])
    expect(onToggleSustain).not.toHaveBeenCalled()
    expect(resolveNote).not.toHaveBeenCalled()
    expect(note.preventDefault).toHaveBeenCalledTimes(1)
    expect(space.preventDefault).toHaveBeenCalledTimes(1)
    expect(unbound.preventDefault).toHaveBeenCalledTimes(1)
  })

  it('is called first for every keydown: auto-repeat, modifiers and text fields included', () => {
    const intercept = vi.fn((_event: KeyboardEvent) => false)
    const { press } = setup({ intercept })

    const first = press('KeyA')
    const repeat = press('KeyA', { repeat: true })
    const withCtrl = press('KeyS', { ctrlKey: true })
    const inTextField = press('KeyD', { target: TEXT_FIELD })

    expect(intercept.mock.calls.map(([event]) => event)).toEqual([first, repeat, withCtrl, inTextField])
  })

  it('lets the event through when it returns false', () => {
    const onToggleSustain = vi.fn()
    const { events, press } = setup({ intercept: () => false, onToggleSustain })

    press('KeyA')
    press('Space')

    expect(summary(events)).toEqual(['on:60'])
    expect(onToggleSustain).toHaveBeenCalledTimes(1)
  })

  it('does not release another note when a consumed key goes up', () => {
    let consuming = false
    const { bus, events, press, release } = setup({ intercept: () => consuming })

    press('KeyA')
    consuming = true
    press('KeyS')
    release('KeyS')

    expect(summary(events)).toEqual(['on:60'])
    expect(bus.isActive(60)).toBe(true)

    release('KeyA')
    expect(summary(events)).toEqual(['on:60', 'off:60'])
  })

  it('does not play a consumed key when it auto-repeats after intercept stops consuming', () => {
    let consuming = true
    const { events, press, release } = setup({ intercept: () => consuming })

    press('KeyA')
    consuming = false
    press('KeyA', { repeat: true })
    release('KeyA')

    expect(events).toEqual([])
  })

  it('still prevents the default of Space key up after a consumed Space', () => {
    const onToggleSustain = vi.fn()
    const { press, release } = setup({ intercept: () => true, onToggleSustain })

    press('Space', { target: FOCUSED_BUTTON })
    const up = release('Space', { target: FOCUSED_BUTTON })

    expect(onToggleSustain).not.toHaveBeenCalled()
    expect(up.preventDefault).toHaveBeenCalledTimes(1)
  })
})

describe('attachKeyboardInput: detach', () => {
  it('listens for keydown, keyup and blur on the target', () => {
    const { target } = setup()

    expect(target.listenedTypes()).toEqual(['blur', 'keydown', 'keyup'])
  })

  it('releases held notes and removes every listener', () => {
    const { bus, events, target, detach, press, release } = setup()

    press('KeyA')
    press('KeyS')
    detach()

    expect(summary(events)).toEqual(['on:60', 'on:62', 'off:60', 'off:62'])
    expect(target.listenedTypes()).toEqual([])

    press('KeyD')
    release('KeyA')
    expect(events).toHaveLength(4)
    expect(bus.getActiveNotes().size).toBe(0)
  })

  it('can be called twice', () => {
    const { events, detach, press } = setup()

    press('KeyA')
    detach()
    detach()

    expect(summary(events)).toEqual(['on:60', 'off:60'])
  })

  it('stops listening to the bus', () => {
    const bus = new NoteBus()
    const stopListening = vi.fn()
    vi.spyOn(bus, 'subscribe').mockReturnValue(stopListening)

    const detach = attachKeyboardInput({ bus, resolveNote: () => null, target: new FakeTarget() })
    expect(stopListening).not.toHaveBeenCalled()

    detach()
    expect(stopListening).toHaveBeenCalledTimes(1)
  })
})

describe('attachKeyboardInput: page hidden', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function stubDocument() {
    const page = Object.assign(new FakeTarget(), { visibilityState: 'visible' })
    vi.stubGlobal('document', page)
    return page
  }

  it('releases every held note when the page becomes hidden', () => {
    const page = stubDocument()
    const { events, press } = setup()

    press('KeyA')
    press('KeyS')
    page.visibilityState = 'hidden'
    page.fire('visibilitychange')

    expect(summary(events)).toEqual(['on:60', 'on:62', 'off:60', 'off:62'])
  })

  it('keeps notes when the page becomes visible again', () => {
    const page = stubDocument()
    const { events, press } = setup()

    press('KeyA')
    page.fire('visibilitychange')

    expect(summary(events)).toEqual(['on:60'])
  })

  it('removes the visibilitychange listener on detach', () => {
    const page = stubDocument()
    const { detach } = setup()
    expect(page.listenedTypes()).toEqual(['visibilitychange'])

    detach()

    expect(page.listenedTypes()).toEqual([])
  })
})

describe('isTextEntryTarget', () => {
  it.each(['text', 'search', 'url', 'tel', 'email', 'password', 'number', 'date'])(
    'is true for <input type="%s">',
    (type) => {
      expect(isTextEntryTarget({ tagName: 'INPUT', type })).toBe(true)
    },
  )

  it('is true for an <input> with no type', () => {
    expect(isTextEntryTarget({ tagName: 'INPUT' })).toBe(true)
    expect(isTextEntryTarget({ tagName: 'INPUT', type: '' })).toBe(true)
  })

  it('is true for <textarea>, <select> and editable content', () => {
    expect(isTextEntryTarget({ tagName: 'TEXTAREA' })).toBe(true)
    expect(isTextEntryTarget({ tagName: 'SELECT' })).toBe(true)
    expect(isTextEntryTarget({ tagName: 'DIV', isContentEditable: true })).toBe(true)
  })

  it('does not depend on the case of the tag name or type', () => {
    expect(isTextEntryTarget({ tagName: 'input', type: 'TEXT' })).toBe(true)
    expect(isTextEntryTarget({ tagName: 'textarea' })).toBe(true)
    expect(isTextEntryTarget({ tagName: 'input', type: 'RANGE' })).toBe(false)
  })

  it.each(['range', 'checkbox', 'radio', 'button', 'submit', 'reset', 'color', 'file'])(
    'is false for <input type="%s">',
    (type) => {
      expect(isTextEntryTarget({ tagName: 'INPUT', type })).toBe(false)
    },
  )

  it('is false for buttons and other elements', () => {
    expect(isTextEntryTarget({ tagName: 'BUTTON', type: 'submit' })).toBe(false)
    expect(isTextEntryTarget({ tagName: 'BUTTON' })).toBe(false)
    expect(isTextEntryTarget({ tagName: 'DIV', isContentEditable: false })).toBe(false)
    expect(isTextEntryTarget(PAGE_BODY)).toBe(false)
  })

  it('is false for things that are not elements', () => {
    expect(isTextEntryTarget(null)).toBe(false)
    expect(isTextEntryTarget(undefined)).toBe(false)
    expect(isTextEntryTarget('input')).toBe(false)
    expect(isTextEntryTarget(42)).toBe(false)
    expect(isTextEntryTarget({})).toBe(false)
  })
})
