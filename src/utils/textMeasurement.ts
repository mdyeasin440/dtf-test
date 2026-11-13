import { DesignPreset } from '../types';
import { DOT_HEIGHT_RATIO } from './letterAssetHelper';

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

// Tokenize customer names into character tokens including multi-char tokens like "A'" or "K'"
export function tokenizeNameCharacters(text: string): string[] {
  const upper = text.toUpperCase();
  const tokens: string[] = [];
  let i = 0;
  while (i < upper.length) {
    if (
      (upper[i] === 'A' || upper[i] === 'K') &&
      (upper[i + 1] === "'" || upper[i + 1] === '’' || upper[i + 1] === '`')
    ) {
      const tok = upper[i] === 'A' ? "A'" : "K'";
      tokens.push(tok);
      i += 2;
      continue;
    }
    tokens.push(upper[i]);
    i++;
  }
  return tokens;
}

export function isPresetCurved(preset: DesignPreset | null | undefined): boolean {
  if (!preset) return false;
  return Boolean(preset.curvedTextArch || preset.enableArcPath || preset.textEffect === 'arc');
}

export interface CurvedGlyphPlacement {
  token: string;
  cx: number;
  cy: number;
  angleRad: number;
  charWidthPx: number;
}

export interface CurvedTextLayout {
  boxWidthPx: number;
  boxHeightPx: number;
  glyphs: CurvedGlyphPlacement[];
  radiusPx: number;
  arcRad: number;
  glyphHeightPx: number;
}

export interface CurvedGlyphExtent {
  leftPx: number;
  rightPx: number;
  topPx: number;
  bottomPx: number;
}

/**
 * Computes exact tight outer bounding box for curved/arched text by rotating all
 * 4 corners of every glyph (including stroke miter overhang) along the arch.
 * Shared identically by both measurement and canvas rendering so curved artwork
 * never overflows or clips its bounding box.
 */
export function computeCurvedTextLayout(params: {
  tokens: string[];
  charWidthsPx: number[];
  glyphExtentsPx?: CurvedGlyphExtent[];
  letterGapPx: number;
  glyphHeightPx: number;
  arcDegrees: number;
  strokeWidthPx: number;
  padPx?: number;
}): CurvedTextLayout {
  const {
    tokens,
    charWidthsPx,
    glyphExtentsPx,
    letterGapPx,
    glyphHeightPx,
    arcDegrees,
    strokeWidthPx,
    padPx = 2,
  } = params;

  const count = tokens.length;
  const arcRad = (Math.max(10, Math.min(60, arcDegrees)) * Math.PI) / 180;

  let accumW = 0;
  const midpoints: number[] = [];
  for (let i = 0; i < count; i++) {
    const cW = charWidthsPx[i] || 0;
    midpoints.push(accumW + cW / 2);
    accumW += cW + (i < count - 1 ? letterGapPx : 0);
  }
  const totalArcLen = Math.max(1, accumW);

  const halfChord = totalArcLen / (2 * Math.sin(arcRad / 2) || 0.2);
  const radiusPx = Math.max(totalArcLen * 0.72, halfChord);

  // Stroke expands outer contour by strokeWidthPx (miterLimit=2 adds ~1.4x on sharp corners)
  const strokeMarginPx = strokeWidthPx > 0 ? strokeWidthPx * 1.35 + padPx : padPx;

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  const rawGlyphs: CurvedGlyphPlacement[] = [];

  for (let i = 0; i < count; i++) {
    const progress = count > 1 ? midpoints[i] / totalArcLen : 0.5;
    const angleRad = count > 1 ? -arcRad / 2 + progress * arcRad : 0;

    // Position relative to arc circle center (0, 0)
    const cx = radiusPx * Math.sin(angleRad);
    const cy = -radiusPx * Math.cos(angleRad);

    rawGlyphs.push({
      token: tokens[i],
      cx,
      cy,
      angleRad,
      charWidthPx: charWidthsPx[i] || 0,
    });

    if (tokens[i] === ' ') continue;

    const ext = glyphExtentsPx?.[i];
    const halfWLeft = (ext ? ext.leftPx : (charWidthsPx[i] || 0) / 2) + strokeMarginPx;
    const halfWRight = (ext ? ext.rightPx : (charWidthsPx[i] || 0) / 2) + strokeMarginPx;
    const halfTop = (ext ? ext.topPx : glyphHeightPx / 2) + strokeMarginPx;
    const halfBot = (ext ? ext.bottomPx : glyphHeightPx / 2) + strokeMarginPx;

    const cosA = Math.cos(angleRad);
    const sinA = Math.sin(angleRad);

    const corners: [number, number][] = [
      [-halfWLeft, -halfTop],
      [halfWRight, -halfTop],
      [halfWRight, halfBot],
      [-halfWLeft, halfBot],
    ];

    for (const [lx, ly] of corners) {
      const rx = cx + lx * cosA - ly * sinA;
      const ry = cy + lx * sinA + ly * cosA;
      if (rx < minX) minX = rx;
      if (rx > maxX) maxX = rx;
      if (ry < minY) minY = ry;
      if (ry > maxY) maxY = ry;
    }
  }

  if (!Number.isFinite(minX)) {
    minX = -totalArcLen / 2;
    maxX = totalArcLen / 2;
    minY = -radiusPx - glyphHeightPx / 2;
    maxY = -radiusPx + glyphHeightPx / 2;
  }

  const offsetX = -minX;
  const offsetY = -minY;

  const glyphs = rawGlyphs.map((g) => ({
    ...g,
    cx: g.cx + offsetX,
    cy: g.cy + offsetY,
  }));

  return {
    boxWidthPx: Math.max(1, maxX - minX),
    boxHeightPx: Math.max(1, maxY - minY),
    glyphs,
    radiusPx,
    arcRad,
    glyphHeightPx,
  };
}

/**
 * Helper to resolve default width ratio for a letter asset token
 */
export function getDefaultLetterRatio(token: string): number {
  if (token === 'I' || token === "'" || token === '.' || token === '-') return 0.18;
  if (token === 'W' || token === 'M') return 0.52;
  if (token === "A'" || token === "K'") return 0.58;
  if (token === 'J' || token === 'L') return 0.30;
  return 0.35;
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
        const chars = tokenizeNameCharacters(cleanText);
        const hasLetterAssets = chars.some((c) => c !== ' ' && Boolean(letterAssets[c]));

        const userSpacing = typeof preset?.letterSpacing === 'number' ? preset.letterSpacing : 3;
        const letterGapPx = Math.max(2, userSpacing * (scaleDpi / 30));
        const isCurved = isPresetCurved(preset);
        const arcDeg =
          typeof preset?.arcCurvature === 'number'
            ? preset.arcCurvature
            : typeof preset?.arcAmount === 'number'
            ? preset.arcAmount
            : 24;

        if (hasLetterAssets) {
          const spaceWidthPx = hPx * 0.22;
          const charWidthsPx: number[] = [];

          chars.forEach((c) => {
            if (c === ' ') {
              charWidthsPx.push(spaceWidthPx);
            } else {
              const url = letterAssets[c];
              const effectiveCharHPx = c === '.' && url ? hPx * DOT_HEIGHT_RATIO : hPx;
              if (url) preloadAssetImage(url);
              const cachedRatio = url ? getCachedAssetAspectRatio(url) : null;
              if (cachedRatio) {
                charWidthsPx.push(effectiveCharHPx * cachedRatio);
              } else if (url && url.startsWith('data:image/svg+xml')) {
                const match = url.match(/viewBox=["']0 0 ([\d.]+) ([\d.]+)["']/);
                if (match) {
                  const svgW = parseFloat(match[1]);
                  const svgH = parseFloat(match[2]);
                  if (svgW && svgH) {
                    const ratio = svgW / svgH;
                    registerAssetAspectRatio(url, ratio);
                    charWidthsPx.push(effectiveCharHPx * ratio);
                    return;
                  }
                }
                charWidthsPx.push(hPx * getDefaultLetterRatio(c));
              } else {
                charWidthsPx.push(hPx * getDefaultLetterRatio(c));
              }
            }
          });

          if (isCurved && chars.length > 1) {
            const layout = computeCurvedTextLayout({
              tokens: chars,
              charWidthsPx,
              letterGapPx,
              glyphHeightPx: hPx,
              arcDegrees: arcDeg,
              strokeWidthPx: 0,
              padPx: 0.04 * scaleDpi,
            });
            return {
              widthInches: parseFloat(Math.max(0.5, layout.boxWidthPx / scaleDpi).toFixed(2)),
              heightInches: parseFloat(Math.max(heightInches, layout.boxHeightPx / scaleDpi).toFixed(2)),
            };
          }

          let totalWPx = 0;
          charWidthsPx.forEach((w, i) => {
            totalWPx += w;
            if (i < charWidthsPx.length - 1 && chars[i] !== ' ' && chars[i + 1] !== ' ') {
              totalWPx += letterGapPx;
            } else if (i < charWidthsPx.length - 1 && (chars[i] === ' ' || chars[i + 1] === ' ')) {
              totalWPx += letterGapPx * 0.25;
            }
          });
          const finalWInches = Math.max(0.4, totalWPx / scaleDpi);
          return { widthInches: parseFloat(finalWInches.toFixed(2)), heightInches };
        } else {
          // Standard vector font measurement
          const fontSize = hPx * 0.95;
          ctx.font = `700 ${fontSize}px "${fontName}", "Oswald", "Bebas Neue", "Anton", sans-serif`;
          if ('letterSpacing' in ctx) {
            (ctx as any).letterSpacing = `${letterGapPx}px`;
          }

          const rawStrokeWidth = typeof preset?.strokeWidth === 'number' ? preset.strokeWidth : 0;
          const strokeWidthPx = rawStrokeWidth > 0 ? rawStrokeWidth * (scaleDpi / 30) : 0;

          if (isCurved && cleanText.length > 1) {
            const rawChars = cleanText.split('');
            if ('letterSpacing' in ctx) {
              (ctx as any).letterSpacing = '0px';
            }
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            const charWidthsPx: number[] = [];
            const glyphExtentsPx: CurvedGlyphExtent[] = [];

            rawChars.forEach((ch) => {
              if (ch === ' ') {
                const spW = fontSize * 0.28;
                charWidthsPx.push(spW);
                glyphExtentsPx.push({
                  leftPx: spW / 2,
                  rightPx: spW / 2,
                  topPx: fontSize * 0.48,
                  bottomPx: fontSize * 0.48,
                });
                return;
              }
              const m = ctx.measureText(ch);
              const advW = m.width || fontSize * 0.5;
              const leftPx = Math.max(advW / 2, m.actualBoundingBoxLeft || advW / 2);
              const rightPx = Math.max(advW / 2, m.actualBoundingBoxRight || advW / 2);
              const topPx = Math.max(fontSize * 0.5, m.actualBoundingBoxAscent || fontSize * 0.5);
              const bottomPx = Math.max(fontSize * 0.5, m.actualBoundingBoxDescent || fontSize * 0.5);
              charWidthsPx.push(Math.max(advW, leftPx + rightPx));
              glyphExtentsPx.push({ leftPx, rightPx, topPx, bottomPx });
            });

            const layout = computeCurvedTextLayout({
              tokens: rawChars,
              charWidthsPx,
              glyphExtentsPx,
              letterGapPx,
              glyphHeightPx: fontSize,
              arcDegrees: arcDeg,
              strokeWidthPx,
              padPx: 0.04 * scaleDpi,
            });

            return {
              widthInches: parseFloat(Math.max(0.5, layout.boxWidthPx / scaleDpi).toFixed(2)),
              heightInches: parseFloat(Math.max(heightInches, layout.boxHeightPx / scaleDpi).toFixed(2)),
            };
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

          measuredWPx += strokeWidthPx * 2.5;
          const widthInches = Math.max(0.35, measuredWPx / scaleDpi);
          return { widthInches: parseFloat(widthInches.toFixed(2)), heightInches };
        }
      } else {
        // Number item measurement
        const style = preset?.numberStyle || {};
        const numberAssets = preset?.numberAssets;
        const digits = cleanText.replace(/[^0-9]/g, '').split('');

        const hasCustomAssets =
          numberAssets && digits.length > 0 && digits.every((d) => Boolean(numberAssets[d]));

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

          const numStrokeVal =
            typeof (style as any)?.strokeWidth === 'number'
              ? (style as any).strokeWidth
              : (preset as any)?.strokeWidth;
          const strokeWidthPx =
            typeof numStrokeVal === 'number' && numStrokeVal > 0
              ? numStrokeVal * (scaleDpi / 30)
              : 0;
          measuredWPx += strokeWidthPx * 2.2;

          const widthInches = Math.max(0.5, measuredWPx / scaleDpi);
          return { widthInches: parseFloat(widthInches.toFixed(2)), heightInches };
        }
      }
    }
  }

  // Fallback estimation (Node / SSR)
  if (itemType === 'number') {
    const digits = cleanText.replace(/[^0-9]/g, '').split('');
    let totalRatio = 0;
    digits.forEach((d) => {
      totalRatio += d === '1' ? 0.25 : d === '4' ? 0.44 : 0.38;
    });
    const gap = digits.length > 1 ? (digits.length - 1) * 0.03 : 0;
    const estWidth = Math.max(0.5, heightInches * (totalRatio + gap));
    return { widthInches: parseFloat(estWidth.toFixed(2)), heightInches };
  } else {
    const chars = tokenizeNameCharacters(cleanText);
    let totalRatio = 0;
    chars.forEach((c) => {
      if (c === ' ') totalRatio += 0.2;
      else totalRatio += getDefaultLetterRatio(c);
    });
    const estWidth = Math.max(0.4, heightInches * totalRatio);
    if (isPresetCurved(preset) && chars.length > 1) {
      const arcDeg =
        typeof preset?.arcCurvature === 'number'
          ? preset.arcCurvature
          : typeof preset?.arcAmount === 'number'
          ? preset.arcAmount
          : 24;
      const layout = computeCurvedTextLayout({
        tokens: chars,
        charWidthsPx: chars.map((c) => (c === ' ' ? heightInches * 60 : heightInches * 300 * getDefaultLetterRatio(c))),
        letterGapPx: Math.max(2, (preset?.letterSpacing ?? 3) * (300 / 30)),
        glyphHeightPx: heightInches * 300,
        arcDegrees: arcDeg,
        strokeWidthPx: (preset?.strokeWidth || 0) * 10,
        padPx: 12,
      });
      return {
        widthInches: parseFloat((layout.boxWidthPx / 300).toFixed(2)),
        heightInches: parseFloat((layout.boxHeightPx / 300).toFixed(2)),
      };
    }
    return { widthInches: parseFloat(estWidth.toFixed(2)), heightInches };
  }
}
