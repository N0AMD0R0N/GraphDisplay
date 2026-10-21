import { RESERVED_SLOTS, hueDistance } from '../../apps/dal/src/colors';
import { severityColor } from '../../apps/client/src/lib/severity';
import { lightTheme } from '../../apps/client/src/theme';

/** Hue of a #rrggbb colour in degrees. */
function hue(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

describe('route / path highlight colour (accent)', () => {
  const accent = lightTheme.colors.accent;

  it('is cyan', () => {
    expect(accent).toMatch(/^#[0-9a-f]{6}$/);
    expect(hue(accent)).toBeGreaterThan(175);
    expect(hue(accent)).toBeLessThan(205);
  });

  it('is far from every colour of the vulnerability scale (light orange to pinkish red)', () => {
    for (const position of [0, 0.25, 0.5, 0.75, 1]) {
      expect(hueDistance(hue(accent), hue(severityColor(position)))).toBeGreaterThan(100);
    }
  });

  it('has a soft variant of the same hue for backgrounds', () => {
    expect(hueDistance(hue(lightTheme.colors.accentSoft), hue(accent))).toBeLessThan(15);
  });

  it('is the hue that kind colours must keep away from (reserved in the colour assignment)', () => {
    expect(hueDistance(RESERVED_SLOTS[0].h, hue(accent))).toBeLessThan(15);
  });
});
