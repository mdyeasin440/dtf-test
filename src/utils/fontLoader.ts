/**
 * Dynamic Font Loader Utility for Canvas & DOM
 * Handles custom TTF, OTF, WOFF2 fonts loaded from DataURLs or Cloudflare R2 /api/assets/file/... endpoints.
 */

const loadedFontFamilies = new Set<string>([
  'Oswald',
  'Bebas Neue',
  'Anton',
  'Teko',
  'Jersey 15',
  'Montserrat',
  'Orbitron',
  'Rajdhani',
  'Graduate',
  'Rubik Mono One',
  'Fjalla One',
  'Arial',
  'Impact',
]);

/**
 * Registers a custom font family with the browser's FontFace API.
 * Accepts both base64 DataURLs and remote R2 URLs (`/api/assets/file/...` or `https://...`).
 */
export async function registerCustomFont(
  fontName: string,
  fontSourceUrlOrData: string
): Promise<string> {
  if (!fontSourceUrlOrData) return 'Oswald';

  const sanitizedName = fontName.replace(/[^a-zA-Z0-9_-]/g, '_');
  if (loadedFontFamilies.has(sanitizedName)) {
    return sanitizedName;
  }

  try {
    const formattedUrl = fontSourceUrlOrData.startsWith('data:') || fontSourceUrlOrData.startsWith('http') || fontSourceUrlOrData.startsWith('/api/')
      ? `url('${fontSourceUrlOrData}')`
      : `url('${fontSourceUrlOrData}')`;

    const newFontFace = new FontFace(sanitizedName, formattedUrl);
    const loadedFace = await newFontFace.load();
    document.fonts.add(loadedFace);
    loadedFontFamilies.add(sanitizedName);
    console.log(`Custom font registered globally: ${sanitizedName}`);
    return sanitizedName;
  } catch (err) {
    console.error(`Failed to register custom font ${sanitizedName}:`, err);
    return 'Oswald'; // graceful fallback
  }
}

export function ensureFontAvailable(fontFamily: string, customFontUrl?: string): void {
  if (customFontUrl && !loadedFontFamilies.has(fontFamily)) {
    registerCustomFont(fontFamily, customFontUrl).catch(() => {});
  }

  if (document.fonts && document.fonts.load) {
    document.fonts.load(`16px "${fontFamily}"`).catch((e) => {
      console.warn(`Font load check warning for ${fontFamily}:`, e);
    });
  }
}
