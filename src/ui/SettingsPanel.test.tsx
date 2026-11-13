// @vitest-environment jsdom
/**
 * The Settings panel as a whole: its five tabs and how the keyboard moves
 * between them, the tab it remembers, the wording of everything in it, and
 * how it turns "choosing the computer keys" on and off with the Keys tab.
 * What each tab does is tested next to the tab, in src/ui/settings/.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode, useEffect, useRef } from 'react'
import type { JSX } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { APP_NAME } from '../app/appInfo'
import { DEFAULT_SETTINGS, settingsStore, useSettings } from '../state/settings'
import { SettingsPanel } from './SettingsPanel'
import type { KeyEditorState } from './keyEditorModel'
import { expectSettings, startEachTestFromDefaults } from './settings/testSupport'
import { useKeyEditor } from './useKeyEditor'
import type { KeyEditor } from './useKeyEditor'

const TAB_NAMES = ['Sound', 'Keys', 'Piano', 'Look', 'About'] as const
type TabName = (typeof TAB_NAMES)[number]

/** Something only that tab shows, to tell which page is on screen. */
const ONLY_ON: Readonly<Record<TabName, string>> = {
  Sound: 'Room echo',
  Keys: 'Where your keys sit',
  Piano: 'Piano size',
  Look: 'Theme',
  About: 'Everything stays in your browser. Nothing is uploaded.',
}

/** A key editor that only records what the panel asks of it. */
function recordingEditor() {
  const actions = {
    open: vi.fn(),
    close: vi.fn(),
    select: vi.fn(),
    applyPreset: vi.fn(),
    resetKeys: vi.fn(),
    handleKey: vi.fn(() => false),
  }
  return {
    actions,
    /** The editor in a given state, with the same recorded actions every time. */
    in(state: Partial<KeyEditorState> = {}): KeyEditor {
      return { editing: false, selectedSlot: null, message: null, ...state, ...actions }
    },
  }
}

function panelWith(keyEditor: KeyEditor, onClose: () => void = () => undefined): JSX.Element {
  return (
    <SettingsPanel
      id="settings-panel"
      settings={DEFAULT_SETTINGS}
      keyEditor={keyEditor}
      layoutMap={null}
      onClose={onClose}
    />
  )
}

function tab(name: TabName): HTMLElement {
  return screen.getByRole('tab', { name })
}

function selectedTabs(): string[] {
  return screen
    .getAllByRole('tab')
    .filter((candidate) => candidate.getAttribute('aria-selected') === 'true')
    .map((candidate) => candidate.textContent ?? '')
}

function page(): HTMLElement {
  return screen.getByRole('tabpanel')
}

/** What the last change of a key did, as the Keys tab reports it. */
function keyChangeResult(): string {
  const changeOneKey = within(page()).getByRole('region', { name: 'Change one key' })
  return within(changeOneKey).getByRole('status').textContent ?? ''
}

/**
 * Leaves the panel on a tab and closes it, so that the panel drawn next
 * opens on that tab: the panel remembers the last tab used.
 */
function leavePanelOn(name: TabName): void {
  const view = render(panelWith(recordingEditor().in()))
  fireEvent.click(tab(name))
  view.unmount()
}

startEachTestFromDefaults()

describe('the Settings panel', () => {
  // This has to stay the first test of the file: the panel remembers the tab
  // it was last on for as long as the page (here, the file) is loaded.
  it('opens on the Sound tab the first time', () => {
    render(panelWith(recordingEditor().in()))
    expect(selectedTabs()).toEqual(['Sound'])
    expect(within(page()).getByText(ONLY_ON.Sound)).toBeTruthy()
  })

  it('is the floating panel "Settings", closed by its close button', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(panelWith(recordingEditor().in(), onClose))
    const panel = screen.getByRole('dialog', { name: 'Settings' })

    expect(panel.id).toBe('settings-panel')
    expect(within(panel).getByRole('heading', { name: 'Settings' })).toBeTruthy()

    await user.click(within(panel).getByRole('button', { name: 'Close Settings' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('has its five tabs in the heading row, in order', () => {
    render(panelWith(recordingEditor().in()))
    const tabs = within(screen.getByRole('tablist', { name: 'Settings' })).getAllByRole('tab')
    expect(tabs.map((candidate) => candidate.textContent)).toEqual([...TAB_NAMES])
  })

  it.each(TAB_NAMES)('shows the page of the %s tab when it is clicked', async (name) => {
    const user = userEvent.setup()
    render(panelWith(recordingEditor().in()))

    await user.click(tab(name))

    expect(selectedTabs()).toEqual([name])
    expect(within(page()).getByText(ONLY_ON[name])).toBeTruthy()
    for (const other of TAB_NAMES.filter((candidate) => candidate !== name)) {
      expect(within(page()).queryByText(ONLY_ON[other]), other).toBeNull()
    }
  })

  it('ties each tab to the page it shows, for screen readers', async () => {
    const user = userEvent.setup()
    render(panelWith(recordingEditor().in()))

    for (const name of TAB_NAMES) {
      await user.click(tab(name))
      // The page is named after its tab, and the tab says which page it controls.
      expect(page().getAttribute('aria-labelledby'), name).toBe(tab(name).id)
      expect(tab(name).getAttribute('aria-controls'), name).toBe(page().id)
    }
    expect(new Set(TAB_NAMES.map((name) => tab(name).id)).size).toBe(TAB_NAMES.length)
  })

  it('remembers the tab it was on when it is opened again', () => {
    leavePanelOn('Look')
    render(panelWith(recordingEditor().in()))
    expect(selectedTabs()).toEqual(['Look'])
    expect(within(page()).getByText(ONLY_ON.Look)).toBeTruthy()

    cleanup()
    leavePanelOn('About')
    render(panelWith(recordingEditor().in()))
    expect(selectedTabs()).toEqual(['About'])
  })

  it('shows a tab from its top, wherever the tab before it was scrolled to', async () => {
    const user = userEvent.setup()
    leavePanelOn('Look')
    render(panelWith(recordingEditor().in()))
    // What scrolls is the body of the floating panel, around the page.
    const scrollingBody = page().parentElement
    if (!scrollingBody) throw new Error('The page of the tab is not inside the panel.')
    scrollingBody.scrollTop = 240

    await user.click(tab('Sound'))

    expect(scrollingBody.scrollTop).toBe(0)
  })

  it('writes every change straight to the settings', async () => {
    const user = userEvent.setup()
    leavePanelOn('Sound')
    render(panelWith(recordingEditor().in()))

    await user.click(screen.getByRole('switch', { name: 'Sustain' }))
    await user.click(tab('Piano'))
    await user.click(screen.getByRole('button', { name: 'Do Ré Mi' }))
    await user.click(tab('Look'))
    await user.click(screen.getByRole('button', { name: 'Glass' }))
    await user.click(screen.getByRole('radio', { name: 'Blue' }))

    expectSettings({ sustain: true, noteNaming: 'solfege', keyStyle: 'glass', accent: 'blue' })
  })
})

describe('the tabs, with the keyboard', () => {
  function drawOn(name: TabName): void {
    leavePanelOn(name)
    render(panelWith(recordingEditor().in()))
    tab(name).focus()
  }

  it('are one stop for the Tab key: the tab that is showing', () => {
    drawOn('Piano')
    const stops = screen.getAllByRole('tab').filter((candidate) => candidate.tabIndex === 0)
    expect(stops).toEqual([tab('Piano')])
  })

  it('puts the focus on the tab that is showing when it is opened with the keyboard', () => {
    leavePanelOn('Look')
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()

    render(panelWith(recordingEditor().in()))

    expect(document.activeElement).toBe(tab('Look'))
    opener.remove()
  })

  it('moves to the next tab with the right arrow, and shows its page at once', async () => {
    const user = userEvent.setup()
    drawOn('Sound')

    await user.keyboard('{ArrowRight}')

    expect(selectedTabs()).toEqual(['Keys'])
    expect(document.activeElement).toBe(tab('Keys'))
    expect(within(page()).getByText(ONLY_ON.Keys)).toBeTruthy()
    expect(tab('Keys').tabIndex).toBe(0)
    expect(tab('Sound').tabIndex).toBe(-1)
  })

  it('moves to the previous tab with the left arrow', async () => {
    const user = userEvent.setup()
    drawOn('Look')

    await user.keyboard('{ArrowLeft}')

    expect(selectedTabs()).toEqual(['Piano'])
    expect(document.activeElement).toBe(tab('Piano'))
  })

  it('goes all the way along the row, one tab at a time', async () => {
    const user = userEvent.setup()
    drawOn('Sound')
    const seen: string[] = []

    for (let press = 0; press < TAB_NAMES.length - 1; press++) {
      await user.keyboard('{ArrowRight}')
      seen.push(...selectedTabs())
    }

    expect(seen).toEqual(['Keys', 'Piano', 'Look', 'About'])
  })

  it('goes round at either end', async () => {
    const user = userEvent.setup()
    drawOn('About')

    await user.keyboard('{ArrowRight}')
    expect(selectedTabs()).toEqual(['Sound'])
    expect(document.activeElement).toBe(tab('Sound'))

    await user.keyboard('{ArrowLeft}')
    expect(selectedTabs()).toEqual(['About'])
    expect(document.activeElement).toBe(tab('About'))
  })

  it('jumps to the first tab with Home and to the last with End', async () => {
    const user = userEvent.setup()
    drawOn('Piano')

    await user.keyboard('{End}')
    expect(selectedTabs()).toEqual(['About'])
    expect(document.activeElement).toBe(tab('About'))

    await user.keyboard('{Home}')
    expect(selectedTabs()).toEqual(['Sound'])
    expect(document.activeElement).toBe(tab('Sound'))
  })

  it('remembers a tab reached with the keyboard too', async () => {
    const user = userEvent.setup()
    drawOn('Sound')
    await user.keyboard('{ArrowRight}{ArrowRight}')
    cleanup()

    render(panelWith(recordingEditor().in()))

    expect(selectedTabs()).toEqual(['Piano'])
  })

  it('uses the keys it acts on up, and no other', () => {
    drawOn('Piano')
    const pianoTab = tab('Piano')

    // fireEvent returns false when the default action of the key was stopped.
    for (const key of ['ArrowRight', 'ArrowLeft', 'Home', 'End']) {
      expect(fireEvent.keyDown(document.activeElement ?? pianoTab, { key }), key).toBe(false)
    }
    fireEvent.click(pianoTab)
    for (const key of ['ArrowDown', 'ArrowUp', 'a', ' ', 'Enter', 'Escape', 'Tab']) {
      expect(fireEvent.keyDown(pianoTab, { key }), key).toBe(true)
    }
    expect(selectedTabs()).toEqual(['Piano'])
  })

  it('leaves the arrows to the browser when Alt, Ctrl or the Windows key is held', () => {
    drawOn('Piano')

    for (const modifier of ['altKey', 'ctrlKey', 'metaKey']) {
      const press = { key: 'ArrowRight', [modifier]: true }
      expect(fireEvent.keyDown(tab('Piano'), press), modifier).toBe(true)
    }
    expect(selectedTabs()).toEqual(['Piano'])
  })
})

describe('the wording', () => {
  /** Everything a player can read or be told by a screen reader in the panel. */
  function everyWordInThePanel(): string {
    const panel = screen.getByRole('dialog')
    const parts: string[] = [panel.textContent ?? '']
    for (const attribute of ['aria-label', 'aria-valuetext', 'title', 'placeholder', 'alt']) {
      for (const element of panel.querySelectorAll(`[${attribute}]`)) {
        parts.push(element.getAttribute(attribute) ?? '')
      }
    }
    return parts.join(' \n ')
  }

  /**
   * The words the product rules keep away from the player: "MIDI", "binding"
   * (in any of its forms), "slot" and "octave shift".
   */
  const JARGON = [/midi/i, /\bbind/i, /\bbound\b/i, /\bslots?\b/i, /octave shift/i]

  it.each(TAB_NAMES)('uses no jargon in the %s tab', (name) => {
    leavePanelOn(name)
    render(panelWith(recordingEditor().in({ editing: true, selectedSlot: 12 })))
    const words = everyWordInThePanel()

    expect(words).toContain(ONLY_ON[name])
    for (const word of JARGON) expect(words).not.toMatch(word)
  })

  it('names the app only by its one name', () => {
    leavePanelOn('About')
    render(panelWith(recordingEditor().in()))
    expect(screen.getByRole('heading', { name: APP_NAME })).toBeTruthy()
  })
})

describe('choosing the computer keys', () => {
  it('is turned on when the Keys tab becomes the tab that is showing', async () => {
    const user = userEvent.setup()
    leavePanelOn('Sound')
    const editor = recordingEditor()
    render(panelWith(editor.in()))
    expect(editor.actions.open).not.toHaveBeenCalled()

    await user.click(tab('Keys'))

    expect(editor.actions.open).toHaveBeenCalledTimes(1)
    expect(editor.actions.close).not.toHaveBeenCalled()
  })

  it('is turned on at once when the panel opens on the Keys tab', () => {
    leavePanelOn('Keys')
    const editor = recordingEditor()

    render(panelWith(editor.in()))

    expect(editor.actions.open).toHaveBeenCalledTimes(1)
    expect(editor.actions.close).not.toHaveBeenCalled()
  })

  it('is turned off when another tab is chosen', async () => {
    const user = userEvent.setup()
    leavePanelOn('Keys')
    const editor = recordingEditor()
    render(panelWith(editor.in()))

    await user.click(tab('Piano'))

    expect(editor.actions.close).toHaveBeenCalledTimes(1)
    expect(editor.actions.open).toHaveBeenCalledTimes(1)
  })

  it('is turned off when the panel goes away while the Keys tab is showing', () => {
    leavePanelOn('Keys')
    const editor = recordingEditor()
    const view = render(panelWith(editor.in()))

    view.unmount()

    expect(editor.actions.close).toHaveBeenCalledTimes(1)
  })

  it.each(['Sound', 'Piano', 'Look', 'About'] as const)(
    'is left alone by the %s tab, also when the panel goes away',
    (name) => {
      leavePanelOn(name)
      const editor = recordingEditor()
      const view = render(panelWith(editor.in()))
      view.unmount()

      expect(editor.actions.open).not.toHaveBeenCalled()
      expect(editor.actions.close).not.toHaveBeenCalled()
    },
  )

  it('is not turned on again each time the panel is drawn', () => {
    leavePanelOn('Keys')
    const editor = recordingEditor()
    const view = render(panelWith(editor.in()))

    // The editor is a new object with a new state at every render of the app.
    view.rerender(panelWith(editor.in({ editing: true })))
    view.rerender(panelWith(editor.in({ editing: true, selectedSlot: 12 })))
    view.rerender(panelWith(editor.in({ editing: true, message: '"K" now plays C4.' })))

    expect(editor.actions.open).toHaveBeenCalledTimes(1)
    expect(editor.actions.close).not.toHaveBeenCalled()
  })

  it('uses the latest editor it was given when it turns it off', async () => {
    const user = userEvent.setup()
    leavePanelOn('Keys')
    const first = recordingEditor()
    const latest = recordingEditor()
    const view = render(panelWith(first.in()))
    view.rerender(panelWith(latest.in({ editing: true })))

    await user.click(tab('About'))

    expect(latest.actions.close).toHaveBeenCalledTimes(1)
    expect(first.actions.close).not.toHaveBeenCalled()
  })

  it('shows what the editor says on the Keys tab', () => {
    leavePanelOn('Keys')
    const editor = recordingEditor()
    const view = render(panelWith(editor.in({ editing: true, selectedSlot: 12 })))
    expect(within(page()).getByText('Press a key for C4…')).toBeTruthy()

    view.rerender(panelWith(editor.in({ editing: true, message: '"K" now plays C4.' })))
    expect(keyChangeResult()).toBe('"K" now plays C4.')
  })

  // Closing the panel is the app's decision (its close button, Escape, a click
  // on the sky). The panel never closes itself because of what the editor does.
  it('does not close the panel when the editor stops, whatever stopped it', () => {
    leavePanelOn('Keys')
    const editor = recordingEditor()
    const onClose = vi.fn()
    const view = render(panelWith(editor.in(), onClose))
    view.rerender(panelWith(editor.in({ editing: true }), onClose))

    view.rerender(panelWith(editor.in({ editing: false }), onClose))

    expect(onClose).not.toHaveBeenCalled()
  })

  it('does not close the panel when the editor is turned off by leaving the tab', async () => {
    const user = userEvent.setup()
    leavePanelOn('Keys')
    const editor = recordingEditor()
    const onClose = vi.fn()
    const view = render(panelWith(editor.in(), onClose))
    view.rerender(panelWith(editor.in({ editing: true }), onClose))

    await user.click(tab('Sound'))
    view.rerender(panelWith(editor.in({ editing: false }), onClose))

    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('with the real key editor', () => {
  /**
   * The panel with the app's own key editor: the settings are live, the
   * editor is offered every key press, and a button stands for the piano key
   * that is clicked to select it. The app itself is not here: what it does
   * with a key the editor leaves alone (Escape closes the panel) is tested
   * with the app.
   */
  function LivePanel({ onClose }: { onClose(): void }): JSX.Element {
    const settings = useSettings()
    const keyEditor = useKeyEditor(null)
    const latestEditor = useRef(keyEditor)

    useEffect(() => {
      latestEditor.current = keyEditor
    })

    useEffect(() => {
      const onKeyDown = (event: KeyboardEvent): void => {
        if (latestEditor.current.handleKey(event)) event.preventDefault()
      }
      window.addEventListener('keydown', onKeyDown)
      return () => window.removeEventListener('keydown', onKeyDown)
    }, [])

    return (
      <>
        <SettingsPanel
          id="settings-panel"
          settings={settings}
          keyEditor={keyEditor}
          layoutMap={null}
          onClose={onClose}
        />
        <button type="button" onClick={() => keyEditor.select(12)}>
          the piano key C4
        </button>
        <output data-testid="editing">{keyEditor.editing ? 'on' : 'off'}</output>
      </>
    )
  }

  function editing(): string {
    return screen.getByTestId('editing').textContent ?? ''
  }

  /** Presses Escape. True when the editor used the press up. */
  function pressEscape(repeat = false): boolean {
    // fireEvent returns false when the default action of the key was stopped.
    return !fireEvent.keyDown(document.body, { code: 'Escape', key: 'Escape', repeat })
  }

  it('lets piano keys be selected exactly while the Keys tab is showing', async () => {
    const user = userEvent.setup()
    leavePanelOn('Sound')
    render(<LivePanel onClose={() => undefined} />)
    expect(editing()).toBe('off')

    await user.click(tab('Keys'))
    expect(editing()).toBe('on')

    await user.click(tab('Look'))
    expect(editing()).toBe('off')
  })

  it('works when everything is drawn twice, as in development', async () => {
    const user = userEvent.setup()
    leavePanelOn('Keys')
    const onClose = vi.fn()
    render(
      <StrictMode>
        <LivePanel onClose={onClose} />
      </StrictMode>,
    )
    expect(editing()).toBe('on')

    await user.click(tab('Sound'))
    expect(editing()).toBe('off')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('changes a key from start to finish on the Keys tab', async () => {
    const user = userEvent.setup()
    leavePanelOn('Keys')
    render(<LivePanel onClose={() => undefined} />)

    await user.click(screen.getByRole('button', { name: 'the piano key C4' }))
    expect(within(page()).getByText('Press a key for C4…')).toBeTruthy()
    fireEvent.keyDown(document.body, { code: 'KeyK', key: 'k' })

    expect(keyChangeResult()).toBe(
      '"K" now plays C4. "A" no longer plays a note. C5 has no key now.',
    )
    expect(settingsStore.get().bindings.KeyK).toBe(12)
    expect(within(page()).getByText('Custom')).toBeTruthy()
  })

  it('cancels the selected piano key on Escape, and stays open', async () => {
    const user = userEvent.setup()
    leavePanelOn('Keys')
    const onClose = vi.fn()
    render(<LivePanel onClose={onClose} />)
    await user.click(screen.getByRole('button', { name: 'the piano key C4' }))

    expect(pressEscape()).toBe(true)
    // Escape is still down. The selection is gone, so its repeats are not for the editor.
    expect(pressEscape(true)).toBe(false)

    expect(onClose).not.toHaveBeenCalled()
    expect(editing()).toBe('on')
    expect(within(page()).getByText(/^Click a piano key below/)).toBeTruthy()
  })

  // What Escape does then is decided in one place, the app shell
  // (docs/INTERFACE.md, section 5.0): the editor must not answer it too.
  it('leaves Escape alone when no piano key is selected, pressed or still held', () => {
    leavePanelOn('Keys')
    const onClose = vi.fn()
    render(<LivePanel onClose={onClose} />)

    expect(pressEscape()).toBe(false)
    expect(pressEscape(true)).toBe(false)

    expect(onClose).not.toHaveBeenCalled()
    expect(editing()).toBe('on')
  })

  it('forgets a piano key that was waiting when the tab is left and come back to', async () => {
    const user = userEvent.setup()
    leavePanelOn('Keys')
    render(<LivePanel onClose={() => undefined} />)
    await user.click(screen.getByRole('button', { name: 'the piano key C4' }))

    await user.click(tab('Sound'))
    await user.click(tab('Keys'))

    expect(within(page()).getByText(/^Click a piano key below/)).toBeTruthy()
    // The next key plays: it is not given to the piano key that was waiting.
    fireEvent.keyDown(document.body, { code: 'KeyK', key: 'k' })
    expectSettings({})
  })
})
