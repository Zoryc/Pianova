import { describe, expect, it } from 'vitest'
import { isHexColour, paletteFor } from '../core/colour'
import { DEFAULT_SETTINGS, STORAGE_KEY, createSettingsStore, sanitizeSettings } from './settings'
import type { Settings, StorageLike } from './settings'
import { LOOK_THEMES, matchingTheme } from './themes'
import type { LookTheme, ThemeId } from './themes'

type LookValues = LookTheme['values']

const LOOK_KEYS = ['accent', 'customColour', 'glow', 'background', 'barStyle', 'sparks', 'keyStyle']

/** The table of docs/INTERFACE.md section 4.2, row by row. */
const TABLE: [ThemeId, string, string, Omit<LookValues, 'customColour'>][] = [
  [
    'ember',
    'Ember',
    'Red light on black.',
    {
      accent: 'red',
      background: 'black',
      barStyle: 'solid',
      sparks: 'some',
      keyStyle: 'classic',
      glow: 0.6,
    },
  ],
  [
    'midnight',
    'Midnight',
    'Blue light under the stars.',
    {
      accent: 'blue',
      background: 'stars',
      barStyle: 'solid',
      sparks: 'some',
      keyStyle: 'midnight',
      glow: 0.7,
    },
  ],
  [
    'aurora',
    'Aurora',
    'Soft purple haze and glass keys.',
    {
      accent: 'purple',
      background: 'aurora',
      barStyle: 'neon',
      sparks: 'some',
      keyStyle: 'glass',
      glow: 0.8,
    },
  ],
  [
    'gold',
    'Gold',
    'Warm gold and plenty of sparks.',
    {
      accent: 'amber',
      background: 'night',
      barStyle: 'solid',
      sparks: 'lots',
      keyStyle: 'classic',
      glow: 0.6,
    },
  ],
  [
    'mono',
    'Mono',
    'White lines, nothing else.',
    {
      accent: 'white',
      background: 'black',
      barStyle: 'neon',
      sparks: 'off',
      keyStyle: 'midnight',
      glow: 0.4,
    },
  ],
  [
    'prism',
    'Prism',
    'Every note has its own colour.',
    {
      accent: 'rainbow',
      background: 'black',
      barStyle: 'solid',
      sparks: 'some',
      keyStyle: 'classic',
      glow: 0.6,
    },
  ],
]

/** Settings that have nothing to do with the look, all moved away from their defaults. */
const OTHER_SETTINGS: Partial<Settings> = {
  bindings: { KeyZ: 0 },
  customLabels: { KeyZ: 'W' },
  baseOctave: 2,
  volume: 0.3,
  sustain: true,
  labelMode: 'none',
  velocity: 0.4,
  transpose: 3,
  noteNaming: 'solfege',
  reverb: 0.9,
  release: 'long',
  showTrails: false,
  pianoSize: 61,
  keyboardType: 'azerty',
  showKeyHints: false,
  showNoteNames: false,
  autoHideMenu: false,
}

function themeOf(id: ThemeId): LookTheme {
  const found = LOOK_THEMES.find((theme) => theme.id === id)
  if (!found) throw new Error(`no theme called ${id}`)
  return found
}

/** The default settings with a theme applied, and then some settings changed by hand. */
function withTheme(id: ThemeId, changes: Partial<Settings> = {}): Settings {
  return { ...DEFAULT_SETTINGS, ...themeOf(id).values, ...changes }
}

function createMemoryStorage(): StorageLike & { items: Map<string, string> } {
  const items = new Map<string, string>()
  return {
    items,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    removeItem: (key) => void items.delete(key),
  }
}

describe('LOOK_THEMES', () => {
  it('lists the six themes of the spec, in its order, with its names and descriptions', () => {
    expect(LOOK_THEMES.map(({ id, name, description }) => [id, name, description])).toEqual(
      TABLE.map(([id, name, description]) => [id, name, description]),
    )
  })

  it('gives each theme exactly the look of the spec', () => {
    for (const [id, , , look] of TABLE) expect(themeOf(id).values).toMatchObject(look)
  })

  it('sets the seven look settings and nothing else', () => {
    for (const theme of LOOK_THEMES) {
      expect(Object.keys(theme).sort()).toEqual(['description', 'id', 'name', 'values'])
      expect(Object.keys(theme.values).sort()).toEqual([...LOOK_KEYS].sort())
    }
  })

  it("sets the player's own colour to the colour of the theme's light", () => {
    for (const { values } of LOOK_THEMES) {
      expect(isHexColour(values.customColour)).toBe(true)
      expect(values.customColour).toBe(paletteFor(values.accent, '#000000').light)
      expect(paletteFor('custom', values.customColour).light).toBe(values.customColour)
    }
    expect(themeOf('midnight').values.customColour).toBe('#2f8bff')
  })

  it('holds only values that the settings accept as they are', () => {
    for (const { values } of LOOK_THEMES) {
      expect(sanitizeSettings(values)).toEqual({ ...DEFAULT_SETTINGS, ...values })
      expect(sanitizeSettings(JSON.parse(JSON.stringify(values)))).toEqual({
        ...DEFAULT_SETTINGS,
        ...values,
      })
      expect(sanitizeSettings({ ...DEFAULT_SETTINGS, ...OTHER_SETTINGS, ...values })).toEqual({
        ...DEFAULT_SETTINGS,
        ...OTHER_SETTINGS,
        ...values,
      })
    }
  })

  it('has no two themes that look the same', () => {
    const looks = TABLE.map(([, , , look]) => JSON.stringify(look))
    expect(new Set(looks).size).toBe(LOOK_THEMES.length)
    expect(new Set(LOOK_THEMES.map((theme) => theme.id)).size).toBe(LOOK_THEMES.length)
    expect(new Set(LOOK_THEMES.map((theme) => theme.name)).size).toBe(LOOK_THEMES.length)
  })

  it('cannot be changed by accident', () => {
    expect(Object.isFrozen(LOOK_THEMES)).toBe(true)
    for (const theme of LOOK_THEMES) {
      expect(Object.isFrozen(theme)).toBe(true)
      expect(Object.isFrozen(theme.values)).toBe(true)
    }
  })
})

describe('the default settings', () => {
  it('are the Ember theme', () => {
    expect(matchingTheme(DEFAULT_SETTINGS)).toBe('ember')
    expect(LOOK_THEMES[0]?.id).toBe('ember')
    expect({ ...DEFAULT_SETTINGS, ...themeOf('ember').values }).toEqual(DEFAULT_SETTINGS)
  })
})

describe('matchingTheme', () => {
  it('recognizes every theme once it is applied', () => {
    for (const { id } of LOOK_THEMES) expect(matchingTheme(withTheme(id))).toBe(id)
  })

  it('looks only at the look: the other settings do not matter', () => {
    for (const { id } of LOOK_THEMES) expect(matchingTheme(withTheme(id, OTHER_SETTINGS))).toBe(id)
  })

  it('says "no theme" as soon as one look setting is changed by hand', () => {
    const changes: Partial<Settings>[] = [
      { accent: 'green' },
      { accent: 'custom' },
      { glow: 0.05 },
      { glow: 1 },
      { background: 'aurora' },
      { background: 'night' },
      { barStyle: 'neon' },
      { barStyle: 'solid' },
      { sparks: 'lots' },
      { sparks: 'off' },
      { keyStyle: 'glass' },
      { keyStyle: 'midnight' },
    ]
    for (const { id, values } of LOOK_THEMES) {
      for (const change of changes) {
        const changed = (Object.keys(change) as (keyof LookValues)[]).some(
          (key) => change[key] !== values[key],
        )
        if (changed) expect(matchingTheme(withTheme(id, change))).not.toBe(id)
      }
    }
    expect(matchingTheme(withTheme('ember', { accent: 'green' }))).toBeNull()
    expect(matchingTheme(withTheme('mono', { sparks: 'some' }))).toBeNull()
    expect(matchingTheme(withTheme('aurora', { keyStyle: 'classic' }))).toBeNull()
  })

  it('finds the other theme when a change turns one theme into another', () => {
    expect(matchingTheme(withTheme('ember', { accent: 'rainbow' }))).toBe('prism')
    expect(matchingTheme(withTheme('prism', { accent: 'red' }))).toBe('ember')
  })

  it('compares the glow with a small tolerance', () => {
    expect(matchingTheme(withTheme('ember', { glow: 0.1 + 0.2 + 0.3 }))).toBe('ember')
    expect(matchingTheme(withTheme('ember', { glow: 0.6000004 }))).toBe('ember')
    expect(matchingTheme(withTheme('ember', { glow: 0.5999996 }))).toBe('ember')
    expect(matchingTheme(withTheme('midnight', { glow: 0.7 + 1e-9 }))).toBe('midnight')
  })

  it('tells apart two glows that the slider tells apart', () => {
    expect(matchingTheme(withTheme('ember', { glow: 0.61 }))).toBeNull()
    expect(matchingTheme(withTheme('ember', { glow: 0.59 }))).toBeNull()
    expect(matchingTheme(withTheme('mono', { glow: 0.41 }))).toBeNull()
  })

  it("ignores the player's own colour while the light is not set to it", () => {
    for (const { id } of LOOK_THEMES) {
      for (const customColour of ['#00ffcc', '#000000', '#FFFFFF']) {
        expect(matchingTheme(withTheme(id, { customColour }))).toBe(id)
      }
    }
  })

  it("matches no theme when the light is the player's own colour, whatever that colour is", () => {
    for (const { id, values } of LOOK_THEMES) {
      expect(matchingTheme(withTheme(id, { accent: 'custom' }))).toBeNull()
      const sameColour = { accent: 'custom', customColour: values.customColour } as const
      expect(matchingTheme(withTheme(id, sameColour))).toBeNull()
    }
  })

  it('recognizes a theme applied through the settings store, also on the next visit', () => {
    const storage = createMemoryStorage()
    const store = createSettingsStore(storage)
    store.set(OTHER_SETTINGS)

    for (const { id, values } of LOOK_THEMES) {
      store.set(values)
      expect(matchingTheme(store.get())).toBe(id)
      expect(store.get()).toMatchObject(OTHER_SETTINGS)
      expect(matchingTheme(createSettingsStore(storage).get())).toBe(id)
    }
    expect(storage.items.has(STORAGE_KEY)).toBe(true)

    store.set({ glow: 0.33 })
    expect(matchingTheme(store.get())).toBeNull()
  })

  it('goes back to Ember when all settings are reset', () => {
    const store = createSettingsStore()
    store.set(themeOf('aurora').values)
    expect(matchingTheme(store.get())).toBe('aurora')

    store.reset()
    expect(matchingTheme(store.get())).toBe('ember')
  })
})
