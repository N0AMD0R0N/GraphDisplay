import 'styled-components';

/** The light theme tokens (WorkPlan C10): every colour in the UI comes from here, so a dark theme is a new token set. */
declare module 'styled-components' {
  export interface DefaultTheme {
    colors: {
      bg: string;
      surface: string;
      surface2: string;
      border: string;
      text: string;
      muted: string;
      accent: string;
      accentSoft: string;
      danger: string;
      dangerSoft: string;
      warning: string;
      edge: string;
      dim: number;
    };
    radius: string;
    shadow: string;
  }
}
