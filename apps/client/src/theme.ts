import { createGlobalStyle, type DefaultTheme } from 'styled-components';
import { PALETTE } from '@gd/api-contract';

/** Light theme (WorkPlan C10). Components only use these tokens, so a dark theme is a second token set. */
export const lightTheme: DefaultTheme = {
  colors: {
    bg: PALETTE.bg,
    surface: PALETTE.surface,
    surface2: PALETTE.surface2,
    border: PALETTE.border,
    text: PALETTE.text,
    muted: PALETTE.muted,
    accent: PALETTE.accent,
    accentSoft: PALETTE.accentSoft,
    danger: PALETTE.danger,
    dangerSoft: PALETTE.dangerSoft,
    warning: PALETTE.warning,
    warningSoft: PALETTE.warningSoft,
    warningBorder: PALETTE.warningBorder,
    success: PALETTE.success,
    successSoft: PALETTE.successSoft,
    white: PALETTE.white,
    black: PALETTE.black,
    frameBorder: PALETTE.frameBorder,
    hover: PALETTE.hover,
    edge: PALETTE.edge,
    canvasDots: PALETTE.canvasDots,
    unknown: PALETTE.unknown,
    incomplete: PALETTE.incomplete,
    nodeRing: PALETTE.nodeRing,
    swatchRing: PALETTE.swatchRing,
    pulseStart: PALETTE.pulseStart,
    pulseEnd: PALETTE.pulseEnd,
    dim: 0.15,
  },
  radius: '8px',
  shadow: `0 6px 24px ${PALETTE.shadow}`,
};

export const GlobalStyle = createGlobalStyle`
  *, *::before, *::after { box-sizing: border-box; }
  html, body, #root { height: 100%; margin: 0; }
  body {
    font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
    font-size: 14px;
    color: ${(p) => p.theme.colors.text};
    background: ${(p) => p.theme.colors.bg};
  }
  button, select, input, textarea { font: inherit; color: inherit; }
  .react-flow__edge.dimmed { opacity: ${(p) => p.theme.colors.dim}; }
  @keyframes gd-progress { 0% { left: -35%; } 100% { left: 100%; } }
  @keyframes gd-pulse {
    0% { box-shadow: 0 0 0 0 ${(p) => p.theme.colors.pulseStart}; }
    100% { box-shadow: 0 0 0 16px ${(p) => p.theme.colors.pulseEnd}; }
  }
`;
