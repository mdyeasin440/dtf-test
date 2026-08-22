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
 * Preloads asset images to register their exact naturalWidth / naturalHeight
 */
export function preloadAssetImage(url: string) {
  if (!url || typeof Image === 'undefined' || assetAspectRatioCache.has(url)) return;
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    if (img.naturalWidth > 0 && img.naturalHeight > 0) {
      registerAssetAspectRatio(url, img.naturalWidth / img.naturalHeight);
    }
  };
  img.src = url;
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
        const letterGapPx = Math.max(2, userSpacing * (scaleDpi / 35));

        if (hasLetterAssets) {
          const spaceWidthPx = hPx * 0.20;
          let totalWPx = 0;
          chars.forEach((c, i) => {
            if (c === ' ') {
              totalWPx += spaceWidthPx;
            } else {
              const url = letterAssets[c];
              if (url) preloadAssetImage(url);
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
                const defaultRatio = c === 'I' ? 0.18 : c === 'W' || c === 'M' ? 0.52 : c === 'J' || c === 'L' ? 0.30 : 0.35;
                totalWPx += hPx * defaultRatio + (i < chars.length - 1 ? letterGapPx : 0);
              } else {
                // Typical condensed athletic jersey letter aspect ratio (tight bounding box)
                const defaultRatio = c === 'I' ? 0.18 : c === 'W' || c === 'M' ? 0.52 : c === 'J' || c === 'L' ? 0.30 : 0.35;
                totalWPx += hPx * defaultRatio + (i < chars.length - 1 ? letterGapPx : 0);
              }
            }
          });
          const isCurved = Boolean(preset?.curvedTextArch || preset?.enableArcPath || preset?.textEffect === 'arc');
          const arcDeg = typeof preset?.arcCurvature === 'number' ? preset.arcCurvature : (typeof preset?.arcAmount === 'number' ? preset.arcAmount : 24);
          let finalHInches = heightInches;
          let finalWInches = Math.max(0.5, totalWPx / scaleDpi);
          if (isCurved && chars.length > 1) {
            const arcRad = (Math.max(10, Math.min(60, arcDeg)) * Math.PI) / 180;
            const radiusInches = Math.max(finalWInches * 0.70, finalWInches / (2 * Math.sin(arcRad / 2 || 0.2)));
            const sagittaInches = radiusInches * (1 - Math.cos(arcRad / 2));
            const extraEndTiltW = (heightInches * 0.5) * Math.sin(arcRad / 2) * 2;
            finalWInches = parseFloat((finalWInches + extraEndTiltW + 0.10).toFixed(2));
            finalHInches = parseFloat((heightInches * Math.cos(arcRad / 2) + sagittaInches + 0.15).toFixed(2));
          }

          return { widthInches: parseFloat(finalWInches.toFixed(2)), heightInches: finalHInches };
        } else {
          // Standard vector font measurement
          const fontSize = hPx * 0.95;
          ctx.font = `700 ${fontSize}px "${fontName}", "Oswald", "Bebas Neue", "Anton", sans-serif`;
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

          let widthInches = Math.max(0.5, measuredWPx / scaleDpi);

          const isCurved = Boolean(preset?.curvedTextArch || preset?.enableArcPath || preset?.textEffect === 'arc');
          const arcDeg = typeof preset?.arcCurvature === 'number' ? preset.arcCurvature : (typeof preset?.arcAmount === 'number' ? preset.arcAmount : 24);
          let finalHInches = heightInches;
          if (isCurved && cleanText.length > 1) {
            const arcRad = (Math.max(10, Math.min(60, arcDeg)) * Math.PI) / 180;
            const radiusInches = Math.max(widthInches * 0.70, widthInches / (2 * Math.sin(arcRad / 2 || 0.2)));
            const sagittaInches = radiusInches * (1 - Math.cos(arcRad / 2));
            const extraEndTiltW = (heightInches * 0.5) * Math.sin(arcRad / 2) * 2;
            widthInches = parseFloat((widthInches + extraEndTiltW + 0.10).toFixed(2));
            finalHInches = parseFloat((heightInches * Math.cos(arcRad / 2) + sagittaInches + 0.15).toFixed(2));
          }

          return { widthInches: parseFloat(widthInches.toFixed(2)), heightInches: finalHInches };
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
            if (url) preloadAssetImage(url);
            const cachedRatio = url ? getCachedAssetAspectRatio(url) : null;
            let digitW = 0;

            if (cachedRatio) {
              digitW = hPx * cachedRatio;
            } else if (url && url.startsWith('data:image/svg+xml')) {
              const match = url.match(/viewBox=["']0 0 ([\d.]+) ([\d.]+)["']/);
              if (match) {
                const svgW = parseFloat(match[1]);
                const svgH = parseFloat(match[2]);
                if (svgW && svgH) {
                  const ratio = svgW / svgH;
                  registerAssetAspectRatio(url, ratio);
                  digitW = hPx * ratio;
                }
              }
            }

            if (!digitW) {
              // Accurate aspect ratios for condensed athletic jersey numbers:
              // '1' is 0.25, '4' is 0.44, other standard digits are 0.36-0.38
              const defaultRatio = d === '1' ? 0.25 : d === '4' ? 0.44 : 0.38;
              digitW = hPx * defaultRatio;
            }

            totalWPx += digitW;
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
      totalRatio += (d === '1' ? 0.25 : d === '4' ? 0.44 : 0.38);
    });
    const gap = digits.length > 1 ? (digits.length - 1) * 0.03 : 0;
    const estWidth = Math.max(0.5, heightInches * (totalRatio + gap));
    return { widthInches: parseFloat(estWidth.toFixed(2)), heightInches };
  } else {
    const chars = cleanText.toUpperCase().split('');
    let totalRatio = 0;
    chars.forEach((c) => {
      if (c === ' ') totalRatio += 0.20;
      else totalRatio += (c === 'I' ? 0.18 : c === 'W' || c === 'M' ? 0.52 : c === 'J' || c === 'L' ? 0.30 : 0.35);
    });
    const estWidth = Math.max(0.5, heightInches * totalRatio);
    return { widthInches: parseFloat(estWidth.toFixed(2)), heightInches };
  }
}

