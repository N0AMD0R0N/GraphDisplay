/**
 * Every colour of the product, in one place. The UI theme (apps/client/src/theme.ts) builds its tokens from this
 * palette, the DAL derives the colour of unknown kinds from it and the query-builder package uses it where no theme is
 * available. No other file may contain a colour literal.
 */

type Rgb = readonly [number, number, number];

/** `rgba(r, g, b, alpha)` from an rgb triple. */
export const rgba = ([r, g, b]: Rgb, alpha: number): string => `rgba(${r}, ${g}, ${b}, ${alpha})`;

const ACCENT_RGB: Rgb = [8, 145, 178];
const SHADOW_RGB: Rgb = [20, 30, 55];
const BLACK_RGB: Rgb = [0, 0, 0];

export const PALETTE = {
  white: '#ffffff',
  black: '#000000',

  /** Page and panels. */
  bg: '#f4f6fa',
  surface: '#ffffff',
  surface2: '#f1f4f9',
  border: '#d5dbe5',
  /** Border of the code editor and of the query-builder controls. */
  frameBorder: '#cdd3dd',
  /** Hover background of the query-builder buttons. */
  hover: '#eef2fb',

  text: '#1d2433',
  muted: '#6a7488',

  /** Cyan: pink and red are reserved for vulnerability severity. */
  accent: '#0891b2',
  accentSoft: '#e0f7fb',
  accentRgb: ACCENT_RGB,

  danger: '#c0392b',
  dangerSoft: '#fdeceb',
  warning: '#b7791f',
  warningSoft: '#fff4d6',
  warningBorder: '#e8c36a',
  success: '#1e6b3a',
  successSoft: '#e6f4ea',

  /** Graph canvas. */
  edge: '#8c97ab',
  canvasDots: '#dfe4ee',
  /** Colour of a node whose kind has none assigned. */
  unknown: '#9aa0a6',
  /** Dashed border of an incomplete node. */
  incomplete: '#8d949e',
  /** Thin ring around a node dot and around a legend swatch. */
  nodeRing: rgba(BLACK_RGB, 0.18),
  swatchRing: rgba(BLACK_RGB, 0.2),

  shadow: rgba(SHADOW_RGB, 0.16),
  /** Ripple of a node that was just focused. */
  pulseStart: rgba(ACCENT_RGB, 0.7),
  pulseEnd: rgba(ACCENT_RGB, 0),

  /** Vulnerability scale: lowest severity (light orange) to highest (pinkish red), as rgb for interpolation. */
  severityLow: [255, 192, 120] as Rgb,
  severityHigh: [230, 73, 128] as Rgb,
} as const;
