import { createGlobalStyle, type DefaultTheme } from 'styled-components';

/** Light theme (WorkPlan C10). Components only use these tokens, so a dark theme is a second token set. */
export const lightTheme: DefaultTheme = {
  colors: {
    bg: '#f4f6fa',
    surface: '#ffffff',
    surface2: '#f1f4f9',
    border: '#d5dbe5',
    text: '#1d2433',
    muted: '#6a7488',
    accent: '#d6336c',
    accentSoft: '#fde7ef',
    danger: '#c0392b',
    dangerSoft: '#fdeceb',
    warning: '#b7791f',
    edge: '#8c97ab',
    dim: 0.15,
  },
  radius: '8px',
  shadow: '0 6px 24px rgba(20, 30, 55, 0.16)',
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
  @keyframes gd-pulse { 0% { box-shadow: 0 0 0 0 rgba(214,51,108,.7); } 100% { box-shadow: 0 0 0 16px rgba(214,51,108,0); } }
`;
