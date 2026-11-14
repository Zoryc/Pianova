import { useId } from 'react'
import type { JSX } from 'react'
import { APP_NAME, APP_NAME_LIGHT_FROM } from '../app/appInfo'
import './logo.css'

/**
 * The shapes of the mark, in a square of 64 by 64: three keys under the line
 * of light, the middle one lit by a bar that has just come down onto it, and
 * a spark where it lands. public/favicon.svg, the browser tab's icon, draws
 * the same shapes in the default light; a test keeps the two the same.
 */
export const LOGO_SHAPES = {
  whiteKeys: ['M6 43h15.5v15q0 3-3 3h-9.5q-3 0-3-3Z', 'M42.5 43h15.5v15q0 3-3 3h-9.5q-3 0-3-3Z'],
  litKey: 'M24.25 43h15.5v15q0 3-3 3h-9.5q-3 0-3-3Z',
  litKeyTop: 'M24.25 43h15.5v2.5h-15.5Z',
  blackKeys: ['M18.875 43h8v9.5q0 1.5-1.5 1.5h-5q-1.5 0-1.5-1.5Z', 'M37.125 43h8v9.5q0 1.5-1.5 1.5h-5q-1.5 0-1.5-1.5Z'],
  line: 'M4 40h56v2h-56Z',
  bar: 'M32 3a5.5 5.5 0 0 1 5.5 5.5v22a5.5 5.5 0 0 1-11 0v-22A5.5 5.5 0 0 1 32 3Z',
  spark: 'M32 32Q33.7 39.3 45 41Q33.7 42.7 32 50Q30.3 42.7 19 41Q30.3 39.3 32 32Z',
  /** The little sparks thrown sideways: x, y, radius. */
  sparks: [
    [21, 35.5, 1.1],
    [44, 34.5, 1.3],
    [17.5, 38.5, 0.8],
    [47.5, 38, 0.9],
  ],
} as const

/**
 * The mark, drawn in the light the player has chosen (it follows the colour
 * set in Settings, Look). It is a picture only: the name next to it says what it is.
 */
export function LogoMark({ className }: { className?: string }): JSX.Element {
  // Ids of its own for each copy, so that two marks on screen never share a gradient.
  const id = useId().replace(/[^A-Za-z0-9_-]/g, '')
  const glow = `${id}-glow`
  const bar = `${id}-bar`
  const lit = `${id}-lit`
  const ivory = `${id}-ivory`
  const shapes = LOGO_SHAPES
  return (
    <svg className={['logo-mark', className].filter(Boolean).join(' ')} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <filter id={glow} filterUnits="userSpaceOnUse" x="-16" y="-16" width="96" height="96">
          <feGaussianBlur in="SourceGraphic" stdDeviation="1.4" result="near" />
          <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="far" />
          <feMerge>
            <feMergeNode in="far" />
            <feMergeNode in="near" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <linearGradient id={bar} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" className="logo-mark__deep" />
          <stop offset="0.45" className="logo-mark__light" />
          <stop offset="0.85" className="logo-mark__light" />
          <stop offset="1" className="logo-mark__bright" />
        </linearGradient>
        <linearGradient id={lit} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" className="logo-mark__light" />
          <stop offset="1" className="logo-mark__deep" />
        </linearGradient>
        <linearGradient id={ivory} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" className="logo-mark__ivory-shine" />
          <stop offset="1" className="logo-mark__ivory-shade" />
        </linearGradient>
      </defs>
      {shapes.whiteKeys.map((d) => (
        <path key={d} d={d} fill={`url(#${ivory})`} />
      ))}
      <path d={shapes.litKey} fill={`url(#${lit})`} />
      <path d={shapes.litKeyTop} className="logo-mark__key-shine" />
      {shapes.blackKeys.map((d) => (
        <path key={d} d={d} className="logo-mark__black" />
      ))}
      <g filter={`url(#${glow})`}>
        <path d={shapes.line} className="logo-mark__line" />
        <path d={shapes.bar} fill={`url(#${bar})`} />
        <path d={shapes.spark} className="logo-mark__spark" />
        {shapes.sparks.map(([x, y, r]) => (
          <circle key={`${x},${y}`} cx={x} cy={y} r={r} className="logo-mark__spark" />
        ))}
      </g>
    </svg>
  )
}

/**
 * The name as the logo writes it: its first part in the colour of the text,
 * the rest ("nova") in the light. Read aloud, it is the name in one word.
 */
export function Wordmark(): JSX.Element {
  const plain = APP_NAME.slice(0, APP_NAME_LIGHT_FROM)
  const lit = APP_NAME.slice(APP_NAME_LIGHT_FROM)
  return (
    <span className="wordmark">
      {plain}
      {lit !== '' && <span className="wordmark__lit">{lit}</span>}
    </span>
  )
}
