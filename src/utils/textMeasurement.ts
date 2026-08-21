import { DesignPreset } from '../types';

// In-memory cache for asset image aspect ratios
const assetAspectRatioCache = new Map<string, number>();

export function getCachedAssetAspectRatio(url: string): number | null {
  if (!url) return null;
  if (assetAspectRatioCache.has(url)) {
    return assetAspectRatioCache.get(url)!;
  }
  if (typeof document !== 'undefined') {
    if (url.startsWith('data:image/svg+xml')) {
      const match = url.match(/viewBox=["']0 0 ([\d.]+) ([\d.]+)["']/);
      if (match) {
        const svgW = parseFloat(match[1]);
        const svgH = parseFloat(match[2]);
        if (svgW && svgH) {
          const ratio = svgW / svgH;
          assetAspectRatioCache.set(url, ratio);
          return ratio;
        }
      }
    }
  }
  return null;
}

export function registerAssetAspectRatio(url: string, ratio: number) {
  if (url && ratio > 0) {
    assetAspectRatioCache.set(url, ratio);
  }
}

/**
 * Calculates exact-fit tight bounding box dimensions (width and height in inches)
 * for names and numbers without any excess padding or dead space.
 */
export function calculateTightTextDimensions(
  text: string,
  itemType: 'name' | 'number',
  preset: DesignPreset | null | undefined,
  heightInches: number
): { widthInches: number; heightInches: number } {
  if (!text) return { widthInches: 1.0, heightInches };

  const cleanText = text.trim();
  if (!cleanText) return { widthInches: 1.0, heightInches };

  const scaleDpi = 300; // High precision measurement resolution
  const hPx = heightInches * scaleDpi;

  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    if (ctx) {
      if (itemType === 'name') {
        const fontName = preset?.fontFamily || 'Oswald';
        const letterAssets = preset?.letterAssets || {};
        const upperText = cleanText.toUpperCase();
        const chars = upperText.split('');
        const hasLetterAssets = chars.some((c) => c !== ' ' && Boolean(letterAssets[c]));

        const userSpacing = typeof preset?.letterSpacing === 'number' ? preset.letterSpacing : 3;
        const letterGapPx = Math.max(2, userSpacing * (scaleDpi / 30));

        if (hasLetterAssets) {
          const spaceWidthPx = hPx * 0.22;
          let totalWPx = 0;
          chars.forEach((c, i) => {
            if (c === ' ') {
              totalWPx += spaceWidthPx;
            } else {
              const url = letterAssets[c];
              const cachedRatio = url ? getCachedAssetAspectRatio(url) : null;
              if (cachedRatio) {
                totalWPx += hPx * cachedRatio + (i < chars.length - 1 ? letterGapPx : 0);
              } else if (url && url.startsWith('data:image/svg+xml')) {
                const match = url.match(/viewBox=["']0 0 ([\d.]+) ([\d.]+)["']/);
                if (match) {
                  const svgW = parseFloat(match[1]);
                  const svgH = parseFloat(match[2]);
                  if (svgW && svgH) {
                    const ratio = svgW / svgH;
                    registerAssetAspectRatio(url, ratio);
                    totalWPx += hPx * ratio + (i < chars.length - 1 ? letterGapPx : 0);
                    return;
                  }
                }
                totalWPx += hPx * (c === 'I' ? 0.20 : c === 'W' || c === 'M' ? 0.70 : 0.50) + (i < chars.length - 1 ? letterGapPx : 0);
              } else {
                totalWPx += hPx * (c === 'I' ? 0.20 : c === 'W' || c === 'M' ? 0.70 : 0.50) + (i < chars.length - 1 ? letterGapPx : 0);
              }
            }
          });
          const widthInches = Math.max(0.5, totalWPx / scaleDpi);
          return { widthInches: parseFloat(widthInches.toFixed(2)), heightInches };
        } else {
          // Standard vector font measurement
          const fontSize = hPx * 0.95;
          ctx.font = `700 ${fontSize}px "${fontName}", "Oswald", "Bebas Neue", sans-serif`;
          if ('letterSpacing' in ctx) {
            (ctx as any).letterSpacing = `${letterGapPx}px`;
          }
          const metrics = ctx.measureText(cleanText);

          let measuredWPx = metrics.width || 1;
          if (
            typeof metrics.actualBoundingBoxLeft === 'number' &&
            typeof metrics.actualBoundingBoxRight === 'number'
          ) {
            const inkW = metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight;
            if (inkW > 0) measuredWPx = Math.max(measuredWPx, inkW);
          }

          const rawStrokeWidth = typeof preset?.strokeWidth === 'number' ? preset.strokeWidth : 0;
          const strokeWidthPx = rawStrokeWidth > 0 ? rawStrokeWidth * (scaleDpi / 30) : 0;
          measuredWPx += strokeWidthPx * 2;

          const widthInches = Math.max(0.5, measuredWPx / scaleDpi);
          return { widthInches: parseFloat(widthInches.toFixed(2)), heightInches };
        }
      } else {
        // Number item measurement
        const style = preset?.numberStyle || {};
        const numberAssets = preset?.numberAssets;
        const digits = cleanText.replace(/[^0-9]/g, '').split('');

        const hasCustomAssets =
          numberAssets &&
          digits.length > 0 &&
          digits.every((d) => Boolean(numberAssets[d]));

        if (hasCustomAssets) {
          let totalWPx = 0;
          const gapPx = digits.length > 1 ? 0.03 * hPx : 0;

          digits.forEach((d, idx) => {
            const url = numberAssets[d];
            const cachedRatio = url ? getCachedAssetAspectRatio(url) : null;
            if (cachedRatio) {
              totalWPx += hPx * cachedRatio;
            } else if (url && url.startsWith('data:image/svg+xml')) {
              const match = url.match(/viewBox=["']0 0 ([\d.]+) ([\d.]+)["']/);
              if (match) {
                const svgW = parseFloat(match[1]);
                const svgH = parseFloat(match[2]);
                if (svgW && svgH) {
                  const ratio = svgW / svgH;
                  registerAssetAspectRatio(url, ratio);
                  totalWPx += hPx * ratio;
                  return;
                }
              }
              const defaultRatio = d === '1' ? 0.28 : d === '4' ? 0.55 : 0.48;
              totalWPx += hPx * defaultRatio;
            } else {
              // For PNG/Raster images without loaded metadata yet:
              // Digit '1' is slim (0.28 aspect ratio), digit '4' is 0.55, others are ~0.48
              const defaultRatio = d === '1' ? 0.28 : d === '4' ? 0.55 : 0.48;
              totalWPx += hPx * defaultRatio;
            }

            if (idx < digits.length - 1) {
              totalWPx += gapPx;
            }
          });
          const widthInches = Math.max(0.5, totalWPx / scaleDpi);
          return { widthInches: parseFloat(widthInches.toFixed(2)), heightInches };
        } else {
          const fontName = (style as any)?.fontFamily || preset?.fontFamily || 'Oswald';
          const fontSize = hPx * 0.95;
          ctx.font = `900 ${fontSize}px "${fontName}", "Bebas Neue", "Anton", sans-serif`;
          const metrics = ctx.measureText(cleanText);

          let measuredWPx = metrics.width || 1;
          if (
            typeof metrics.actualBoundingBoxLeft === 'number' &&
            typeof metrics.actualBoundingBoxRight === 'number'
          ) {
            const inkW = metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight;
            if (inkW > 0) measuredWPx = Math.max(measuredWPx, inkW);
          }

          const numStrokeVal = typeof (style as any)?.strokeWidth === 'number' ? (style as any).strokeWidth : (preset as any)?.strokeWidth;
          const strokeWidthPx = typeof numStrokeVal === 'number' && numStrokeVal > 0 ? numStrokeVal * (scaleDpi / 30) : 0;
          measuredWPx += strokeWidthPx * 2;

          const widthInches = Math.max(0.5, measuredWPx / scaleDpi);
          return { widthInches: parseFloat(widthInches.toFixed(2)), heightInches };
        }
      }
    }
  }

  // Fallback estimation
  if (itemType === 'number') {
    const digits = cleanText.replace(/[^0-9]/g, '').split('');
    let totalRatio = 0;
    digits.forEach((d) => {
      totalRatio += (d === '1' ? 0.28 : d === '4' ? 0.55 : 0.48);
    });
    const gap = digits.length > 1 ? (digits.length - 1) * 0.03 : 0;
    const estWidth = Math.max(0.5, heightInches * (totalRatio + gap));
    return { widthInches: parseFloat(estWidth.toFixed(2)), heightInches };
  } else {
    const charCount = cleanText.length || 1;
    const estWidth = Math.max(0.5, charCount * (heightInches * 0.50));
    return { widthInches: parseFloat(estWidth.toFixed(2)), heightInches };
  }
}
