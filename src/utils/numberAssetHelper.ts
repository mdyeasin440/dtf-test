/**
 * Number Asset Helper Utility
 * Provides sample 0-9 SVG Data URLs and image handling for DTF number assets
 */

export function createSampleDigitSvgDataUrl(
  digit: string,
  fontFamily: string = 'Oswald',
  fillColor: string = '#FFFFFF',
  strokeColor: string = '#000000',
  strokeWidth: number = 10
): string {
  let width = 190;
  if (digit === '1') width = 110;
  else if (digit === '4') width = 210;

  const height = 400;
  const cx = width / 2;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <rect width="100%" height="100%" fill="none"/>
    <text x="${cx}" y="295" text-anchor="middle" font-family="'${fontFamily}', 'Oswald', 'Bebas Neue', 'Anton', sans-serif" font-size="320" font-weight="900" fill="${fillColor}" stroke="${strokeColor}" stroke-width="${strokeWidth}" stroke-linejoin="miter">${digit}</text>
  </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function generateSampleNumberAssets(
  fontFamily = 'Oswald',
  fillColor = '#FFFFFF',
  strokeColor = '#000000'
): Record<string, string> {
  const assets: Record<string, string> = {};
  for (let i = 0; i <= 9; i++) {
    const digit = i.toString();
    assets[digit] = createSampleDigitSvgDataUrl(digit, fontFamily, fillColor, strokeColor, 12);
  }
  return assets;
}
