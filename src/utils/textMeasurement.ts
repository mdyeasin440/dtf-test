import { DesignPreset } from '../types';

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
              if (url && url.startsWith('data:image/svg+xml')) {
                const match = url.match(/viewBox=["']0 0 ([\d.]+) ([\d.]+)["']/);
                if (match) {
                  const svgW = parseFloat(match[1]);
                  const svgH = parseFloat(match[2]);
                  if (svgW && svgH) {
                    totalWPx += hPx * (svgW / svgH) + (i < chars.length - 1 ? letterGapPx : 0);
                    return;
                  }
                }
              }
              totalWPx += hPx * 0.52 + (i < chars.length - 1 ? letterGapPx : 0);
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
          digits.forEach((d) => {
            const url = numberAssets[d];
            if (url && url.startsWith('data:image/svg+xml')) {
              const match = url.match(/viewBox=["']0 0 ([\d.]+) ([\d.]+)["']/);
              if (match) {
                const svgW = parseFloat(match[1]);
                const svgH = parseFloat(match[2]);
                if (svgW && svgH) {
                  totalWPx += hPx * (svgW / svgH);
                  return;
                }
              }
            }
            totalWPx += hPx * 0.48;
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
  const charCount = cleanText.length || 1;
  const ratio = itemType === 'number' ? 0.48 : 0.50;
  const estWidth = Math.max(0.5, charCount * (heightInches * ratio));
  return { widthInches: parseFloat(estWidth.toFixed(2)), heightInches };
}
