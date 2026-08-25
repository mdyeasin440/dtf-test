/**
 * Letter Asset Helper Utility
 * Provides sample A-Z SVG Data URLs and image handling for DTF name letter assets
 */

export function createSampleLetterSvgDataUrl(
  letter: string,
  fontFamily: string = 'Oswald',
  fillColor: string = '#FFFFFF',
  strokeColor: string = '#000000',
  strokeWidth: number = 8
): string {
  const upper = letter.toUpperCase();
  let width = 160;
  if (['I', "'"].includes(upper)) width = 75;
  else if (['J', 'L', 'F', 'T'].includes(upper)) width = 125;
  else if (['M', 'W'].includes(upper)) width = 220;
  else if (['N', 'H', 'U', 'V', 'K', 'Ö', 'É'].includes(upper)) width = 175;
  else if (upper === "A'" || upper === "K'") width = 230;

  const height = 250;
  const cx = width / 2;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <rect width="100%" height="100%" fill="none"/>
    <text x="${cx}" y="195" text-anchor="middle" font-family="'${fontFamily}', 'Oswald', 'Bebas Neue', 'Anton', sans-serif" font-size="${upper.length > 1 ? 160 : 205}" font-weight="900" fill="${fillColor}" stroke="${strokeColor}" stroke-width="${strokeWidth}" stroke-linejoin="miter">${letter}</text>
  </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export const ALL_LETTER_KEYS = [
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''),
  'Ö',
  'É',
  "A'",
];

export function generateSampleLetterAssets(
  fontFamily = 'Oswald',
  fillColor = '#FFFFFF',
  strokeColor = '#000000'
): Record<string, string> {
  const assets: Record<string, string> = {};
  for (let i = 0; i < ALL_LETTER_KEYS.length; i++) {
    const char = ALL_LETTER_KEYS[i];
    assets[char] = createSampleLetterSvgDataUrl(char, fontFamily, fillColor, strokeColor, 8);
  }
  return assets;
}
