// @vitest-environment jsdom
/**
 * The floating panel on a small page: what it draws, what its close button
 * does, and where the keyboard focus goes when it opens and when it closes.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { StrictMode } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FloatingPanel } from './FloatingPanel'

afterEach(cleanup)

interface PageProps {
  open: boolean
  /** False once the button that opens the panel has been taken off the page. */
  settingsButton?: boolean
  onClose?: () => void
  headerExtra?: ReactNode
  children?: ReactNode
}

/** Two buttons of the app, and the panel while it is open. */
function Page(props: PageProps): ReactElement {
  const { open, settingsButton = true, onClose = () => undefined, headerExtra, children } = props
  return (
    <>
      {settingsButton && <button type="button">Settings</button>}
      <button type="button">Elsewhere</button>
      {open && (
        <FloatingPanel
          id="settings-panel"
          title="Settings"
          onClose={onClose}
          headerExtra={headerExtra}
        >
          {children}
        </FloatingPanel>
      )}
    </>
  )
}

const TABS = (
  <div role="tablist" aria-label="Settings">
    <button type="button" role="tab" aria-selected="false" tabIndex={-1}>
      Sound
    </button>
    <button type="button" role="tab" aria-selected="true">
      Keys
    </button>
  </div>
)

function button(name: string): HTMLElement {
  return screen.getByRole('button', { name })
}

function panel(): HTMLElement {
  return screen.getByRole('dialog', { name: 'Settings' })
}

/** Opens the panel the way someone without a mouse does: the button that opens it has the focus. */
function openFromSettingsButton(page: ReactElement): ReturnType<typeof render> {
  const view = render(<Page open={false} />)
  button('Settings').focus()
  view.rerender(page)
  return view
}

describe('FloatingPanel: what it draws', () => {
  it('has the id it was given, and is named by its heading', () => {
    render(<Page open>Content</Page>)
    expect(panel().id).toBe('settings-panel')
    expect(screen.getByRole('heading', { level: 2, name: 'Settings' })).toBeTruthy()
  })

  it('draws the heading row, then the body', () => {
    render(
      <Page open headerExtra={TABS}>
        <p>The options</p>
      </Page>,
    )
    const [header, body] = [...panel().children]
    expect(header?.className).toBe('floating-panel__header')
    expect(body?.className).toBe('floating-panel__body')
    expect(body?.textContent).toBe('The options')

    // In the heading row: the title, what the panel was given to put after it, the close button.
    const row = [...(header?.children ?? [])]
    expect(row.map((part) => part.tagName)).toEqual(['H2', 'DIV', 'BUTTON'])
    expect(row[1]?.querySelector('[role="tablist"]')).not.toBeNull()
  })

  it('leaves the place after the title out when it is given nothing to put there', () => {
    render(<Page open>Content</Page>)
    expect(panel().querySelector('.floating-panel__extra')).toBeNull()
  })

  it('closes with its close button, and only asks once', () => {
    const onClose = vi.fn()
    render(
      <Page open onClose={onClose}>
        Content
      </Page>,
    )
    fireEvent.click(button('Close Settings'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('leaves Escape and clicks outside itself to the app', () => {
    const onClose = vi.fn()
    render(
      <Page open onClose={onClose}>
        <button type="button">Inside</button>
      </Page>,
    )
    fireEvent.keyDown(button('Inside'), { key: 'Escape', code: 'Escape' })
    fireEvent.keyDown(document.body, { key: 'Escape', code: 'Escape' })
    fireEvent.click(button('Elsewhere'))
    fireEvent.click(document.body)
    fireEvent.click(panel())
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('FloatingPanel: opened with the keyboard', () => {
  it('moves the focus to its first control', () => {
    openFromSettingsButton(
      <Page open>
        <button type="button">Import a MIDI file</button>
        <button type="button">Play</button>
      </Page>,
    )
    // Not to the close button, although it comes first on the page.
    expect(document.activeElement).toBe(button('Import a MIDI file'))
  })

  it('moves it to the chosen tab when the heading row has tabs', () => {
    openFromSettingsButton(
      <Page open headerExtra={TABS}>
        <button type="button">In the body</button>
      </Page>,
    )
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Keys' }))
  })

  it('moves it to the close button when there is no other control', () => {
    openFromSettingsButton(<Page open>Just text</Page>)
    expect(document.activeElement).toBe(button('Close Settings'))
  })

  it('skips controls that cannot be used', () => {
    openFromSettingsButton(
      <Page open>
        <button type="button" disabled>
          Lower
        </button>
        <button type="button">Higher</button>
      </Page>,
    )
    expect(document.activeElement).toBe(button('Higher'))
  })

  it('gives the focus back to the button it was opened from when it closes', () => {
    const view = openFromSettingsButton(
      <Page open>
        <button type="button">Inside</button>
      </Page>,
    )
    button('Close Settings').focus()
    view.rerender(<Page open={false} />)
    expect(document.activeElement).toBe(button('Settings'))
  })

  it('leaves the focus alone when it has gone somewhere else meanwhile', () => {
    const view = openFromSettingsButton(<Page open>Content</Page>)
    button('Elsewhere').focus()
    const takenBack = vi.fn()
    button('Settings').addEventListener('focus', takenBack)

    view.rerender(<Page open={false} />)
    expect(document.activeElement).toBe(button('Elsewhere'))
    // Not even for a moment: the button it was opened from is not told it has the focus.
    expect(takenBack).not.toHaveBeenCalled()
  })

  it('does not move the focus again when its content changes', () => {
    const view = openFromSettingsButton(
      <Page open>
        <button type="button">First</button>
        <button type="button">Second</button>
      </Page>,
    )
    button('Second').focus()
    view.rerender(
      <Page open headerExtra={TABS}>
        <button type="button">First</button>
        <button type="button">Second</button>
        <button type="button">Third</button>
      </Page>,
    )
    expect(document.activeElement).toBe(button('Second'))
  })

  it('copes with the button it was opened from being gone when it closes', () => {
    const view = openFromSettingsButton(<Page open>Content</Page>)
    expect(document.activeElement).toBe(button('Close Settings'))

    view.rerender(
      <Page open settingsButton={false}>
        Content
      </Page>,
    )
    expect(document.activeElement).toBe(button('Close Settings'))
    view.rerender(<Page open={false} settingsButton={false} />)
    expect(document.activeElement).toBe(document.body)
  })
})

describe('FloatingPanel: opened with the mouse (nothing has the focus)', () => {
  it('takes the focus itself, so that no control shows a ring and Tab goes on inside it', () => {
    const view = render(<Page open={false} />)
    view.rerender(
      <Page open headerExtra={TABS}>
        <button type="button">Inside</button>
      </Page>,
    )
    expect(document.activeElement).toBe(panel())
    // It can hold the focus, and Tab does not stop at it.
    expect(panel().tabIndex).toBe(-1)
  })

  it('leaves nothing focused when it closes', () => {
    const view = render(<Page open>Content</Page>)
    view.rerender(<Page open={false} />)
    expect(document.activeElement).toBe(document.body)
  })
})

describe('FloatingPanel: when React draws everything twice (StrictMode)', () => {
  it('still moves the focus in and gives it back', () => {
    const view = render(
      <StrictMode>
        <Page open={false} />
      </StrictMode>,
    )
    button('Settings').focus()
    view.rerender(
      <StrictMode>
        <Page open>
          <button type="button">Inside</button>
        </Page>
      </StrictMode>,
    )
    expect(document.activeElement).toBe(button('Inside'))

    view.rerender(
      <StrictMode>
        <Page open={false} />
      </StrictMode>,
    )
    expect(document.activeElement).toBe(button('Settings'))
  })

  it('still takes the focus itself after a click with the mouse', () => {
    render(
      <StrictMode>
        <Page open>
          <button type="button">Inside</button>
        </Page>
      </StrictMode>,
    )
    expect(document.activeElement).toBe(panel())
  })
})
