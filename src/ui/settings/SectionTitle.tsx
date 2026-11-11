import type { JSX } from 'react'

/** A small title, with a line on either side, that starts a new group of options in a tab. */
export function SectionTitle({ children }: { children: string }): JSX.Element {
  return <h3 className="settings-section-title">{children}</h3>
}
