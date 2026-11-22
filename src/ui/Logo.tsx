import { useId } from 'react'
import type { JSX } from 'react'
import '@fontsource-variable/fraunces/opsz.css'
import '@fontsource-variable/fraunces/opsz-italic.css'
import { APP_NAME, APP_NAME_LIGHT_FROM } from '../app/appInfo'
import './logo.css'

/**
 * The shapes of the mark, in a square of 64 by 64: a black grand piano seen
 * from above, drawn round with one line of light that also runs over its keys,
 * so that the case and the keys set into its front are one piece.
 */
export const LOGO_SHAPES = {
  /** The case: long straight left side, rounded tail, the curved side, short right side, the front. */
  case: 'M8 57.5V16C8 8.5 13 4.5 19.5 4.5 26 4.5 29.3 8.8 30.8 14.5 32.8 22.5 37.5 27.5 45.5 30.2 52.5 32.6 56 35 56 39V57.5Q56 59 54.5 59H9.5Q8 59 8 57.5Z',
  /** The line of light over the keys. */
  fallboard: 'M8 43H56',
  /** The white keys: one ivory band, cut to the case, and the lines between them. */
  keys: 'M8 43H56V59H8Z',
  seams: 'M16.29 43V59M22.57 43V59M28.86 43V59M35.14 43V59M41.43 43V59M47.71 43V59',
  /** Five black keys, in a group of two and a group of three. */
  blackKeys: [
    'M14.69 42h2.5q.6 0 .6.6v9.2q0 .6-.6.6h-2.5q-.6 0-.6-.6v-9.2q0-.6.6-.6Z',
    'M21.67 42h2.5q.6 0 .6.6v9.2q0 .6-.6.6h-2.5q-.6 0-.6-.6v-9.2q0-.6.6-.6Z',
    'M33.44 42h2.5q.6 0 .6.6v9.2q0 .6-.6.6h-2.5q-.6 0-.6-.6v-9.2q0-.6.6-.6Z',
    'M40.18 42h2.5q.6 0 .6.6v9.2q0 .6-.6.6h-2.5q-.6 0-.6-.6v-9.2q0-.6.6-.6Z',
    'M46.91 42h2.5q.6 0 .6.6v9.2q0 .6-.6.6h-2.5q-.6 0-.6-.6v-9.2q0-.6.6-.6Z',
  ],
} as const

/**
 * The browser tab's icon, public/favicon.svg: the same piano made simpler for
 * 16 px, with a thicker line and three black keys, every straight edge on a
 * pixel (4 units of the square). A test keeps the file and these the same.
 */
export const TAB_ICON_SHAPES = {
  case: 'M10 55V17C10 9.8 15 6 21.5 6 28 6 31.3 10.1 32.8 15.5 34.8 23.2 39.5 27.9 47.5 30.5 54.5 32.8 58 35.1 58 39V55Q58 58 55 58H13Q10 58 10 55Z',
  fallboard: 'M10 42H58',
  keys: 'M12 44H56V56H12Z',
  blackKeys: ['M20 44h4v8h-4Z', 'M28 44h4v8h-4Z', 'M44 44h4v8h-4Z'],
} as const

/**
 * The mark, drawn in the light the player has chosen (it follows the colour
 * set in Settings, Look). It is a picture only: the name next to it says what it is.
 */
export function LogoMark({ className }: { className?: string }): JSX.Element {
  // Ids of its own for each copy, so that two marks on screen never share a gradient.
  const id = useId().replace(/[^A-Za-z0-9_-]/g, '')
  const glow = `${id}-glow`
  const ivory = `${id}-ivory`
  const inCase = `${id}-case`
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
        <linearGradient id={ivory} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" className="logo-mark__ivory-shine" />
          <stop offset="1" className="logo-mark__ivory-shade" />
        </linearGradient>
        <clipPath id={inCase}>
          <path d={shapes.case} />
        </clipPath>
      </defs>
      <path d={shapes.case} className="logo-mark__body" />
      {/* The line's soft glow, under the keys so that it never tints them. */}
      <g className="logo-mark__line logo-mark__halo" filter={`url(#${glow})`}>
        <path d={shapes.case} />
        <path d={shapes.fallboard} />
      </g>
      <g clipPath={`url(#${inCase})`}>
        <path d={shapes.keys} fill={`url(#${ivory})`} />
        <path d={shapes.seams} className="logo-mark__seams" />
        {shapes.blackKeys.map((d) => (
          <path key={d} d={d} className="logo-mark__black" />
        ))}
      </g>
      <g className="logo-mark__line">
        <path d={shapes.case} />
        <path d={shapes.fallboard} />
      </g>
    </svg>
  )
}

/**
 * The name as the logo writes it, in the logo's own typeface: its first part
 * in the colour of the text, the rest ("nova") in italics in the light. Read
 * aloud, it is the name in one word.
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
