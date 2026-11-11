/**
 * The app open in two browser tabs at once.
 *
 * Each "tab" here is its own copy of the settings module over a window of
 * its own, as each real tab has. All tabs share what the site has saved.
 * When a tab's save changes that, the other tabs (never the one that saved)
 * are sent the `storage` event a browser sends them, so a store that listens
 * for it can keep up.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SettingsStore, StorageLike } from './settings'

/** What the site has saved: one storage for every tab. */
let saved = new Map<string, string>()
/** The windows of the tabs that are open. */
let tabWindows: EventTarget[] = []

/**
 * The site's storage as one tab reaches it. A write that changes what is
 * saved is announced to every other tab, the way a browser does it.
 */
function storageOf(tabWindow: EventTarget): StorageLike {
  const tellOtherTabs = (key: string, oldValue: string | null, newValue: string | null): void => {
    for (const other of tabWindows) {
      if (other === tabWindow) continue
      other.dispatchEvent(Object.assign(new Event('storage'), { key, oldValue, newValue }))
    }
  }

  return {
    getItem: (key) => saved.get(key) ?? null,
    setItem(key, value) {
      const oldValue = saved.get(key) ?? null
      if (oldValue === value) return
      saved.set(key, value)
      tellOtherTabs(key, oldValue, value)
    },
    removeItem(key) {
      const oldValue = saved.get(key) ?? null
      if (saved.delete(key)) tellOtherTabs(key, oldValue, null)
    },
  }
}

/** Opens the app in a new tab: a fresh copy of the settings module, loaded in that tab's window. */
async function openTab(): Promise<SettingsStore> {
  const tabWindow = new EventTarget()
  tabWindows.push(tabWindow)
  vi.stubGlobal('window', Object.assign(tabWindow, { localStorage: storageOf(tabWindow) }))
  vi.resetModules()
  const { settingsStore } = await import('./settings')
  vi.unstubAllGlobals()
  return settingsStore
}

beforeEach(() => {
  saved = new Map()
  tabWindows = []
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('two tabs', () => {
  it('a tab opened later starts from what the first tab saved', async () => {
    const first = await openTab()
    first.set({ volume: 0.3, bindings: { KeyZ: 0 } })

    const second = await openTab()
    expect(second.get().volume).toBe(0.3)
    expect(second.get().bindings).toEqual({ KeyZ: 0 })
  })

  it('custom keys saved in one tab are not wiped out when the other tab changes something else', async () => {
    const first = await openTab()
    const second = await openTab()

    // The player sets up their own keys in the first tab…
    first.set({ bindings: { KeyZ: 0, KeyX: 2 }, customLabels: { KeyZ: 'Z', KeyX: 'X' } })
    // …and later taps Space (sustain) in the second tab, which was opened before that.
    second.set({ sustain: true })

    // Next visit: both changes must still be there (spec section 1, point 7:
    // "Everything the user changes is remembered next time").
    const nextVisit = await openTab()
    expect(nextVisit.get().sustain).toBe(true)
    expect(nextVisit.get().bindings).toEqual({ KeyZ: 0, KeyX: 2 })
    expect(nextVisit.get().customLabels).toEqual({ KeyZ: 'Z', KeyX: 'X' })
  })
})
