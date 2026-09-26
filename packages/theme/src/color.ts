const HEX = /^#[0-9a-f]{6}$/i;

/** True for a `#RRGGBB` colour: the only form the contrast floor can measure, and the only form a client may save. */
export const isHex = (value: unknown): value is string => typeof value === "string" && HEX.test(value);

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * The WCAG 2 contrast ratio of two `#RRGGBB` colours, from 1 to 21. Anything else throws: a shorthand or named
 * colour would otherwise measure as NaN, and NaN is never below a floor, so an unreadable pair would pass.
 */
export function contrast(a: string, b: string): number {
  if (!isHex(a) || !isHex(b)) {
    throw new TypeError(`contrast() needs two #RRGGBB colours, got ${JSON.stringify(a)} and ${JSON.stringify(b)}`);
  }
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** A colour at a percentage of its strength over transparent, for washes and shadows: `tint("#C8AE7E", 26)`. */
export const tint = (color: string, percent: number): string => `color-mix(in srgb, ${color} ${percent}%, transparent)`;
