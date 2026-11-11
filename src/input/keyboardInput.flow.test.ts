/**
 * The computer keyboard under stress: modifiers pressed before, during and
 * after a note, key presses with no code, key ups that never arrive, two keys
 * on one note, and listening twice (React StrictMode mounts everything twice).
 */
import { describe, expect, it, vi } from 'vitest'
import { NoteBus } from '../core/noteBus'
import type { Midi, NoteEvent } from '../core/types'
import { attachKeyboardInput } from './keyboardInput'
import type { KeyEventTarget, KeyboardInputOptions } from './keyboardInput'

type Listener = (event: never) => void

/** Stands in for `window`: keeps the listeners so a test can fire events at them. */
class FakeWindow implements KeyEventTarget {
  private readonly listeners = new Map<string, Set<Listener>>()

  addEventListener(type: string, listener: Listener): void {
    const ofType = this.listeners.get(type) ?? new Set<Listener>()
    ofType.add(listener)
    this.listeners.set(type, ofType)
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener)
  }

  fire(type: string, event: unknown = {}): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event as never)
  }

  listenerCount(): number {
    return [...this.listeners.values()].reduce((count, ofType) => count + ofType.size, 0)
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
    target: { tagName: 'BODY' },
    preventDefault: vi.fn(),
    ...overrides,
  }
}

const NOTES: Readonly<Record<string, Midi>> = { KeyA: 60, KeyS: 62, KeyD: 64, KeyK: 72 }

function setup(extraOptions: Partial<KeyboardInputOptions> = {}) {
  const bus = new NoteBus()
  const events: string[] = []
  bus.subscribe((event: NoteEvent) => events.push(`${event.type}:${event.midi}`))
  const target = new FakeWindow()
  const notes: Record<string, Midi> = { ...NOTES }
  const options: KeyboardInputOptions = {
    bus,
    resolveNote: (code) => notes[code] ?? null,
    target,
    ...extraOptions,
  }
  const detach = attachKeyboardInput(options)

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

  return { bus, events, target, notes, options, detach, press, release }
}

describe('modifiers around a note', () => {
  it.each(['ctrlKey', 'altKey', 'metaKey'] as const)(
    'a key pressed with %s stays silent once the modifier is let go first',
    (modifier) => {
      const { bus, events, press, release } = setup()

      press('KeyA', { [modifier]: true })
      // The modifier is up, the letter still down: these are repeats, not a new press.
      const repeat = press('KeyA', { repeat: true })
      release('KeyA')

      expect(events).toEqual([])
      expect(bus.getActiveNotes().size).toBe(0)
      // The key plays a note, so its repeats must not type or scroll either.
      expect(repeat.preventDefault).toHaveBeenCalledTimes(1)
    },
  )

  it.each(['ctrlKey', 'altKey', 'metaKey'] as const)(
    'a note keeps sounding while %s is pressed and stops on its own key up',
    (modifier) => {
      const { events, press, release } = setup()

      press('KeyA')
      // The held letter repeats with the modifier down: a browser shortcut, left alone.
      const shortcut = press('KeyA', { repeat: true, [modifier]: true })
      expect(events).toEqual(['on:60'])
      expect(shortcut.preventDefault).not.toHaveBeenCalled()

      release('KeyA', { [modifier]: true })
      expect(events).toEqual(['on:60', 'off:60'])
    },
  )

  it('plays again after a shortcut used the same key', () => {
    const { events, press, release } = setup()

    press('KeyA', { ctrlKey: true })
    release('KeyA', { ctrlKey: true })
    press('KeyA')
    release('KeyA')

    expect(events).toEqual(['on:60', 'off:60'])
  })

  it('ignores Shift going down and up in the middle of a note', () => {
    const { events, press, release } = setup()

    press('KeyA')
    const shiftDown = press('ShiftLeft', { shiftKey: true })
    press('KeyA', { repeat: true, shiftKey: true })
    press('KeyS', { shiftKey: true })
    const shiftUp = release('ShiftLeft')
    release('KeyA')
    release('KeyS')

    expect(events).toEqual(['on:60', 'on:62', 'off:60', 'off:62'])
    expect(shiftDown.preventDefault).not.toHaveBeenCalled()
    expect(shiftUp.preventDefault).not.toHaveBeenCalled()
  })

  /*
   * On macOS the browser never sends the key up of a key that is released
   * while Command is down. Spec 5.5: "Releasing the Meta key (Command /
   * Windows) releases every keyboard-held note". Without its key up, the
   * note is let go when Command itself goes up, and the key plays again the
   * next time it is pressed.
   */
  it('does not leave a note stuck when its key up was swallowed while Meta was down', () => {
    const { bus, events, press, release } = setup()

    press('KeyA')
    press('MetaLeft', { key: 'Meta', metaKey: true })
    // KeyA is released here: macOS sends nothing.
    release('MetaLeft', { key: 'Meta' })

    expect(bus.getActiveNotes().size).toBe(0)
    expect(events).toEqual(['on:60', 'off:60'])

    press('KeyA')
    expect(events).toEqual(['on:60', 'off:60', 'on:60'])
  })
})

describe('key presses with no code', () => {
  it('plays nothing and prevents nothing', () => {
    const { events, press, release } = setup()

    const down = press('', { key: 'a' })
    const repeat = press('', { key: 'a', repeat: true })
    const up = release('', { key: 'a' })

    expect(events).toEqual([])
    expect(down.preventDefault).not.toHaveBeenCalled()
    expect(repeat.preventDefault).not.toHaveBeenCalled()
    expect(up.preventDefault).not.toHaveBeenCalled()
  })

  it('does not disturb the notes that real keys are holding', () => {
    const { bus, events, press, release } = setup()

    press('KeyA')
    press('')
    release('')
    expect([...bus.getActiveNotes()]).toEqual([60])

    release('KeyA')
    expect(events).toEqual(['on:60', 'off:60'])
  })

  it('does not treat a code-less space as the sustain key', () => {
    const onToggleSustain = vi.fn()
    const { press, release } = setup({ onToggleSustain })

    const down = press('', { key: ' ' })
    release('', { key: ' ' })

    expect(onToggleSustain).not.toHaveBeenCalled()
    expect(down.preventDefault).not.toHaveBeenCalled()
  })

  /*
   * Not every "keydown" a page receives is a real key press: a script or a
   * browser extension can send a bare event with none of the usual fields.
   * The types rule that out, so nothing is promised about it beyond this: it
   * must not break the keyboard, and it plays nothing.
   */
  it('survives events that are missing their fields altogether', () => {
    const { bus, target } = setup({ onToggleSustain: vi.fn() })

    expect(() => {
      target.fire('keydown', { preventDefault: vi.fn() })
      target.fire('keyup', { preventDefault: vi.fn() })
      target.fire('keydown', { code: undefined, target: null, preventDefault: vi.fn() })
      target.fire('keyup', { code: undefined, target: null, preventDefault: vi.fn() })
    }).not.toThrow()
    expect(bus.getActiveNotes().size).toBe(0)
  })
})

/*
 * The spec says that key up releases the note the key started, and nothing
 * about two held keys that ended up on the same note (after the keys were
 * changed or put back while one was down). The keyboard's own rule, checked
 * here: the note is shared, and stops when the last of the two is up.
 */
describe('two keys on one note', () => {
  it.each([
    ['the second key is let go first', 'KeyS', 'KeyA'],
    ['the first key is let go first', 'KeyA', 'KeyS'],
  ])('sounds once and stops only when both keys are up: %s', (_order, firstUp, lastUp) => {
    const { events, notes, press, release } = setup()
    notes.KeyS = 60

    press('KeyA')
    press('KeyS')
    release(firstUp)
    expect(events).toEqual(['on:60'])
    release(lastUp)
    expect(events).toEqual(['on:60', 'off:60'])
  })

  it('stops once when the window loses focus', () => {
    const { bus, events, notes, target, press, release } = setup()
    notes.KeyS = 60

    press('KeyA')
    press('KeyS')
    target.fire('blur')
    release('KeyA')
    release('KeyS')

    expect(events).toEqual(['on:60', 'off:60'])
    expect(bus.getActiveNotes().size).toBe(0)
  })

  it('keeps a note that the mouse is also holding until the mouse lets go', () => {
    const { bus, events, press, release } = setup()

    press('KeyA')
    bus.noteOn(60, 'pointer')
    release('KeyA')
    expect(bus.isActive(60)).toBe(true)

    bus.noteOff(60, 'pointer')
    expect(events).toEqual(['on:60', 'on:60', 'off:60'])
  })
})

describe('a binding or the piano position changes under held keys', () => {
  it('each held key releases the note it started, and plays the new one next time', () => {
    const { events, notes, press, release } = setup()

    press('KeyA')
    press('KeyS')
    // The piano moves an octave higher.
    notes.KeyA = 72
    notes.KeyS = 74
    press('KeyA', { repeat: true })
    release('KeyA')
    press('KeyA')
    release('KeyS')
    release('KeyA')

    expect(events).toEqual(['on:60', 'on:62', 'off:60', 'on:72', 'off:62', 'off:72'])
  })

  it('a key that gets a note while it is held down stays silent until pressed again', () => {
    const { events, notes, press, release } = setup()

    press('KeyZ')
    notes.KeyZ = 48
    const repeat = press('KeyZ', { repeat: true })
    release('KeyZ')

    expect(events).toEqual([])
    expect(repeat.preventDefault).toHaveBeenCalledTimes(1)

    press('KeyZ')
    expect(events).toEqual(['on:48'])
  })
})

describe('Space', () => {
  it('toggles on every tap while notes are held, without touching them', () => {
    const onToggleSustain = vi.fn()
    const { events, press, release } = setup({ onToggleSustain })

    press('KeyA')
    press('Space', { key: ' ' })
    release('Space', { key: ' ' })
    press('Space', { key: ' ' })
    release('Space', { key: ' ' })
    release('KeyA')

    expect(onToggleSustain).toHaveBeenCalledTimes(2)
    expect(events).toEqual(['on:60', 'off:60'])
  })

  it('toggles with Shift held, like any other key', () => {
    const onToggleSustain = vi.fn()
    const { press } = setup({ onToggleSustain })

    press('Space', { key: ' ', shiftKey: true })

    expect(onToggleSustain).toHaveBeenCalledTimes(1)
  })

  it('does not toggle from the repeats of a Space that was pressed in a text field', () => {
    const onToggleSustain = vi.fn()
    const { press, release } = setup({ onToggleSustain })

    press('Space', { key: ' ', target: { tagName: 'SELECT' } })
    // Focus left the field while Space was still down.
    press('Space', { key: ' ', repeat: true })
    release('Space', { key: ' ' })

    expect(onToggleSustain).not.toHaveBeenCalled()
  })
})

describe('listening twice', () => {
  it('leaves one set of listeners after attach, detach, attach', () => {
    const bus = new NoteBus()
    const events: string[] = []
    bus.subscribe((event: NoteEvent) => events.push(`${event.type}:${event.midi}`))
    const target = new FakeWindow()
    const onToggleSustain = vi.fn()
    const options: KeyboardInputOptions = {
      bus,
      resolveNote: (code) => NOTES[code] ?? null,
      onToggleSustain,
      target,
    }

    const first = attachKeyboardInput(options)
    const countOnce = target.listenerCount()
    first()
    const second = attachKeyboardInput(options)
    expect(target.listenerCount()).toBe(countOnce)

    target.fire('keydown', keyEvent('KeyA'))
    target.fire('keydown', keyEvent('Space'))
    target.fire('keyup', keyEvent('Space'))
    target.fire('keyup', keyEvent('KeyA'))

    expect(events).toEqual(['on:60', 'off:60'])
    expect(onToggleSustain).toHaveBeenCalledTimes(1)

    second()
    expect(target.listenerCount()).toBe(0)
  })

  it('a detach from an earlier mount does not release the notes of the current one', () => {
    const bus = new NoteBus()
    const target = new FakeWindow()
    const options: KeyboardInputOptions = {
      bus,
      resolveNote: (code) => NOTES[code] ?? null,
      target,
    }

    const first = attachKeyboardInput(options)
    first()
    attachKeyboardInput(options)
    target.fire('keydown', keyEvent('KeyA'))
    // Calling the old clean-up again must be harmless.
    first()

    expect([...bus.getActiveNotes()]).toEqual([60])
  })
})
