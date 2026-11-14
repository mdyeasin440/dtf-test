import {
  CanvasItem,
  DigitNestingMode,
  DigitSplitLocation,
  DigitSplitLogEntry,
  LayoutSettings,
  OrderItem,
  RollMetrics,
} from '../types';
import { getLoadedImage } from './canvasRenderer';
import { DOT_HEIGHT_RATIO } from './letterAssetHelper';
import {
  calculateTightTextDimensions,
  computeCurvedTextLayout,
  CurvedGlyphExtent,
  getCachedAssetAspectRatio,
  getDefaultLetterRatio,
  isPresetCurved,
  tokenizeNameCharacters,
} from './textMeasurement';

export function parseBulkInput(
  rawText: string,
  presetsMap: Map<string, any>
): OrderItem[] {
  const lines = rawText.split('\n');
  const items: OrderItem[] = [];

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;

    // Split by comma or tab or semicolon
    const parts = trimmed.split(/[,;\t]+/).map((p) => p.trim());
    if (parts.length < 2) return;

    const rawDesignCode = parts[0] || '';
    const customerName = (parts[1] || '').toUpperCase();
    const number = (parts[2] || '').toUpperCase();
    const sizeStr = (parts[3] || 'Adult').trim();
    const qty = parseInt(parts[4] || '1', 10) || 1;

    // Find design code preset (case insensitive search)
    const normalizedCode = rawDesignCode.toUpperCase();
    const matched = Array.from(presetsMap.values()).find(
      (p) =>
        p.code.toUpperCase() === normalizedCode ||
        p.id.toUpperCase() === normalizedCode ||
        p.teamName.toUpperCase().includes(normalizedCode)
    );

    let garmentSize: 'Adult' | 'Youth' | 'Infant' = 'Adult';
    if (/youth|kids|boy|girl|jr/i.test(sizeStr)) garmentSize = 'Youth';
    else if (/infant|baby|toddler/i.test(sizeStr)) garmentSize = 'Infant';

    // Scale defaults based on garment size
    let scale = 1.0;
    if (garmentSize === 'Youth') scale = 0.8;
    if (garmentSize === 'Infant') scale = 0.65;

    const defaultPreset = matched || presetsMap.values().next().value;

    // Calculate exact tight physical dimensions from preset specification and text
    const presetNameHeight = defaultPreset?.defaultNameHeightInches || 2.2;
    const nameHeight = presetNameHeight * scale;
    const tightName = calculateTightTextDimensions(customerName, 'name', defaultPreset, nameHeight);

    const presetNumHeight = defaultPreset?.defaultNumberHeightInches || 9.5;
    const numHeight = presetNumHeight * scale;
    const tightNum = calculateTightTextDimensions(number, 'number', defaultPreset, numHeight);

    const hasSmallChestNumber = Boolean(matched?.hasSmallChestNumber);
    const smallChestNumberHeightInches = matched?.smallChestNumberHeightInches || 3.0;

    for (let q = 0; q < qty; q++) {
      items.push({
        id: `order-${index}-${q}-${Date.now()}`,
        rawLine: trimmed,
        designCode: rawDesignCode,
        matchedPreset: matched,
        customerName,
        number,
        garmentSize,
        quantity: 1,
        nameWidthInches: tightName.widthInches,
        nameHeightInches: tightName.heightInches,
        numberHeightInches: tightNum.heightInches,
        numberWidthInches: tightNum.widthInches,
        hasSmallChestNumber,
        smallChestNumberHeightInches,
        status: matched ? 'matched' : 'unmatched_code',
        errorMessage: matched ? undefined : `Design code "${rawDesignCode}" not found in database.`,
      });
    }
  });

  return items;
}

export interface AutoNestingResult {
  items: CanvasItem[];
  metrics: RollMetrics;
  modificationLogs: DigitSplitLogEntry[];
}

export interface BBox {
  x: number;
  y: number;
  width: number;
  height: number;
  cx: number;
  cy: number;
}

/**
 * Exact rotated axis-aligned bounding box for any CanvasItem or candidate rectangle.
 */
export function getRotatedBBox(
  x: number,
  y: number,
  width: number,
  height: number,
  rotationDeg: number = 0
): BBox {
  const rad = ((rotationDeg || 0) * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));

  const aabbW = width * cos + height * sin;
  const aabbH = width * sin + height * cos;
  const cx = x + width / 2;
  const cy = y + height / 2;

  return {
    x: cx - aabbW / 2,
    y: cy - aabbH / 2,
    width: aabbW,
    height: aabbH,
    cx,
    cy,
  };
}

/**
 * Computes raw (x, y) to pass into CanvasItem so its rotated AABB starts at (targetX, targetY).
 * For rotation = 90/270, CanvasItem's render origin is centered around (x + w/2, y + h/2),
 * so (x, y) must be shifted by ((aabbW - w)/2, (aabbH - h)/2).
 */
function itemCoordsForAABBTopLeft(
  targetX: number,
  targetY: number,
  width: number,
  height: number,
  rotationDeg: number
): { x: number; y: number } {
  const rad = ((rotationDeg || 0) * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const aabbW = width * cos + height * sin;
  const aabbH = width * sin + height * cos;
  return {
    x: parseFloat((targetX + (aabbW - width) / 2).toFixed(2)),
    y: parseFloat((targetY + (aabbH - height) / 2).toFixed(2)),
  };
}

interface HorizontalSpan {
  xMinFrac: number;
  xMaxFrac: number;
  empty?: boolean;
}

const PROFILE_SLICES = 48;
const digitProfileCache = new Map<string, HorizontalSpan[]>();
const nameProfileCache = new Map<string, HorizontalSpan[]>();

/**
 * Checks whether a name contains the combined "A'" token.
 */
function isApName(name: string | undefined): boolean {
  if (!name) return false;
  return tokenizeNameCharacters(name.trim()).includes("A'");
}

/**
 * Returns a 48-slice vertical profile of horizontal ink occupancy (normalized 0..1)
 * for a single digit ('7', etc.), matching renderNumberText scaling and stroke width
 * cleanly and using a serif-safe fallback when an image hasn't loaded yet.
 */
function getDigitHorizontalProfile(digit: string, preset: any, aspectRatio: number = 0.55): HorizontalSpan[] {
  const assetUrl = preset?.numberAssets?.[digit] || '';
  const fontFamily = preset?.numberStyle?.fontFamily || preset?.fontFamily || 'Oswald';
  const rawStroke =
    typeof preset?.numberStyle?.strokeWidth === 'number'
      ? preset.numberStyle.strokeWidth
      : typeof preset?.strokeWidth === 'number'
      ? preset.strokeWidth
      : 0;
  const safeAspect = Math.max(0.25, Math.min(1.5, aspectRatio || 0.55));
  const H = 192;
  const W = Math.max(48, Math.round(H * safeAspect));
  const cacheKey = `${digit}|${assetUrl ? assetUrl.slice(0, 80) : fontFamily}|${rawStroke}|${W}x${H}`;

  const cached = digitProfileCache.get(cacheKey);
  if (cached) return cached;

  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');

    if (ctx) {
      let drewPixels = false;
      if (assetUrl) {
        const img = getLoadedImage(assetUrl);
        if (img && img.complete && img.naturalWidth > 0) {
          try {
            ctx.clearRect(0, 0, W, H);
            ctx.drawImage(img, 0, 0, W, H);
            drewPixels = true;
          } catch (_) {
            drewPixels = false;
          }
        }
      } else {
        ctx.clearRect(0, 0, W, H);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const fontSize = H * 0.95;
        ctx.font = `900 ${fontSize}px "${fontFamily}", "Bebas Neue", "Oswald", sans-serif`;

        const scalePerInch = H / 9.5;
        const strokeWidthPx = rawStroke > 0 ? rawStroke * (scalePerInch / 30) : 0;
        const metrics = ctx.measureText(digit);
        const measuredW = metrics.width || W;
        const inkW =
          typeof metrics.actualBoundingBoxLeft === 'number' && typeof metrics.actualBoundingBoxRight === 'number'
            ? Math.max(measuredW, metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight)
            : measuredW;
        const effectiveW = inkW + strokeWidthPx * 2.2;
        const scaleX = effectiveW > 0 ? W / effectiveW : 1;

        ctx.save();
        ctx.translate(W / 2, H / 2);
        ctx.scale(scaleX, 1);

        ctx.fillStyle = '#ffffff';
        ctx.fillText(digit, 0, 0);

        if (strokeWidthPx > 0) {
          ctx.globalCompositeOperation = 'destination-over';
          ctx.lineWidth = strokeWidthPx * 2;
          ctx.lineJoin = 'miter';
          ctx.miterLimit = 2;
          ctx.strokeStyle = '#ffffff';
          ctx.strokeText(digit, 0, 0);
        }
        ctx.restore();
        drewPixels = true;
      }

      if (drewPixels) {
        try {
          const data = ctx.getImageData(0, 0, W, H).data;
          const slices: HorizontalSpan[] = [];
          let nonEmptyCount = 0;

          for (let s = 0; s < PROFILE_SLICES; s++) {
            const y0 = Math.floor((s / PROFILE_SLICES) * H);
            const y1 = Math.max(y0 + 1, Math.floor(((s + 1) / PROFILE_SLICES) * H));
            let minX = W;
            let maxX = -1;

            for (let y = y0; y < y1; y++) {
              for (let x = 0; x < W; x++) {
                const alpha = data[(y * W + x) * 4 + 3];
                if (alpha > 12) {
                  if (x < minX) minX = x;
                  if (x > maxX) maxX = x;
                }
              }
            }

            if (maxX >= minX) {
              nonEmptyCount++;
              slices.push({
                xMinFrac: minX / W,
                xMaxFrac: (maxX + 1) / W,
              });
            } else {
              slices.push({ xMinFrac: 0.5, xMaxFrac: 0.5, empty: true });
            }
          }

          if (nonEmptyCount >= 12) {
            digitProfileCache.set(cacheKey, slices);
            return slices;
          }
        } catch (_) {
          // Cross-origin image tainted canvas; fall back to serif-safe geometric profile
        }
      }
    }
  }

  // Serif-aware athletic jersey '7' silhouette fallback
  const fallback: HorizontalSpan[] = [];
  for (let s = 0; s < PROFILE_SLICES; s++) {
    const t = (s + 0.5) / PROFILE_SLICES;
    if (digit === '7') {
      if (t <= 0.25) {
        fallback.push({ xMinFrac: 0.0, xMaxFrac: 1.0 });
      } else if (t >= 0.84) {
        // Bottom serif allowance so 0°/180° corners never graze before async image loads
        fallback.push({ xMinFrac: 0.0, xMaxFrac: 0.62 });
      } else {
        const p = (t - 0.25) / 0.75;
        const xMinFrac = Math.max(0.0, 0.50 * (1 - p) - 0.04);
        const xMaxFrac = Math.min(1.0, 0.98 - 0.46 * p + 0.04);
        fallback.push({ xMinFrac, xMaxFrac });
      }
    } else {
      fallback.push({ xMinFrac: 0.0, xMaxFrac: 1.0 });
    }
  }

  // Do not permanently cache un-loaded URL fallbacks so real pixels take effect once loaded
  if (!assetUrl) {
    digitProfileCache.set(cacheKey, fallback);
  }
  return fallback;
}

/**
 * Returns a 48-slice horizontal occupancy profile for a straight name item
 * (used strictly for A' 0°/180° apostrophe-pocket interlocking).
 */
function getNameHorizontalProfile(
  name: string,
  preset: any,
  wInches: number,
  hInches: number
): HorizontalSpan[] {
  const cleanName = (name || '').trim();
  const fontFamily = preset?.fontFamily || 'Oswald';
  const rawStroke = typeof preset?.strokeWidth === 'number' ? preset.strokeWidth : 0;
  const userSpacing = typeof preset?.letterSpacing === 'number' ? preset.letterSpacing : 3;
  const letterAssets = preset?.letterAssets || {};
  const tokens = tokenizeNameCharacters(cleanName);
  const hasLetterAssets = tokens.some((c) => c !== ' ' && Boolean(letterAssets[c]));
  const assetSig = hasLetterAssets
    ? tokens.map((c) => (letterAssets[c] ? letterAssets[c].slice(0, 24) : c)).join(',')
    : '';
  const H = 96;
  const W = Math.max(48, Math.round(H * Math.max(0.4, wInches / Math.max(0.5, hInches))));
  const cacheKey = `${cleanName}|${fontFamily}|${rawStroke}|${userSpacing}|${assetSig}|${W}x${H}`;

  const cached = nameProfileCache.get(cacheKey);
  if (cached) return cached;

  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');

    if (ctx) {
      let drewPixels = false;
      const scalePerInch = H / Math.max(0.5, hInches);
      const letterGapPx = Math.max(1, userSpacing * (scalePerInch / 30));

      if (hasLetterAssets) {
        const spaceWidthPx = H * 0.22;
        const charWidths: number[] = [];
        let allLoaded = true;

        tokens.forEach((c) => {
          if (c === ' ') {
            charWidths.push(spaceWidthPx);
          } else {
            const url = letterAssets[c];
            const effectiveCharH = c === '.' && url ? H * DOT_HEIGHT_RATIO : H;
            const img = url ? getLoadedImage(url) : null;
            if (url && (!img || !img.complete || img.naturalWidth === 0)) {
              allLoaded = false;
            }
            if (img && img.complete && img.naturalWidth > 0 && img.naturalHeight > 0) {
              charWidths.push(effectiveCharH * (img.naturalWidth / img.naturalHeight));
            } else {
              const cachedRatio = url ? getCachedAssetAspectRatio(url) : null;
              charWidths.push(cachedRatio ? effectiveCharH * cachedRatio : H * getDefaultLetterRatio(c));
            }
          }
        });

        if (allLoaded) {
          let rawTotalW = 0;
          charWidths.forEach((cw, i) => {
            rawTotalW += cw;
            if (i < charWidths.length - 1 && tokens[i] !== ' ' && tokens[i + 1] !== ' ') {
              rawTotalW += letterGapPx;
            } else if (i < charWidths.length - 1 && (tokens[i] === ' ' || tokens[i + 1] === ' ')) {
              rawTotalW += letterGapPx * 0.25;
            }
          });
          const scaleX = rawTotalW > 0 ? W / rawTotalW : 1;
          let curX = Math.max(0, (W - rawTotalW * scaleX) / 2);

          try {
            ctx.clearRect(0, 0, W, H);
            tokens.forEach((c, i) => {
              const cW = charWidths[i] * scaleX;
              if (c !== ' ') {
                const url = letterAssets[c];
                const img = url ? getLoadedImage(url) : null;
                if (img && img.complete && img.naturalWidth > 0) {
                  if (c === '.') {
                    const dotH = H * DOT_HEIGHT_RATIO;
                    ctx.drawImage(img, curX, H - dotH, cW, dotH);
                  } else {
                    ctx.drawImage(img, curX, 0, cW, H);
                  }
                } else {
                  ctx.fillStyle = '#ffffff';
                  ctx.font = `700 ${H * 0.85}px "${fontFamily}", sans-serif`;
                  ctx.textAlign = 'center';
                  ctx.textBaseline = 'middle';
                  ctx.fillText(c, curX + cW / 2, H / 2);
                }
              }
              const gapAfter =
                i < tokens.length - 1
                  ? c === ' ' || tokens[i + 1] === ' '
                    ? letterGapPx * 0.25 * scaleX
                    : letterGapPx * scaleX
                  : 0;
              curX += cW + gapAfter;
            });
            drewPixels = true;
          } catch (_) {
            drewPixels = false;
          }
        }
      } else {
        ctx.clearRect(0, 0, W, H);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const fontSize = H * 0.95;
        ctx.font = `700 ${fontSize}px "${fontFamily}", "Bebas Neue", "Oswald", sans-serif`;
        if ('letterSpacing' in ctx) {
          (ctx as any).letterSpacing = `${letterGapPx}px`;
        }
        const strokeWidthPx = rawStroke > 0 ? rawStroke * (scalePerInch / 30) : 0;
        const metrics = ctx.measureText(cleanName);
        const measuredW = metrics.width || W;
        const scaleX = measuredW > 0 ? W / measuredW : 1;

        ctx.save();
        ctx.translate(W / 2, H / 2);
        ctx.scale(scaleX, 1);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(cleanName, 0, 0);
        if (strokeWidthPx > 0) {
          ctx.globalCompositeOperation = 'destination-over';
          ctx.lineWidth = strokeWidthPx * 2;
          ctx.lineJoin = 'miter';
          ctx.miterLimit = 2;
          ctx.strokeStyle = '#ffffff';
          ctx.strokeText(cleanName, 0, 0);
        }
        ctx.restore();
        drewPixels = true;
      }

      if (drewPixels) {
        try {
          const data = ctx.getImageData(0, 0, W, H).data;
          const slices: HorizontalSpan[] = [];
          let nonEmptyCount = 0;

          for (let s = 0; s < PROFILE_SLICES; s++) {
            const y0 = Math.floor((s / PROFILE_SLICES) * H);
            const y1 = Math.max(y0 + 1, Math.floor(((s + 1) / PROFILE_SLICES) * H));
            let minX = W;
            let maxX = -1;

            for (let y = y0; y < y1; y++) {
              for (let x = 0; x < W; x++) {
                const alpha = data[(y * W + x) * 4 + 3];
                if (alpha > 12) {
                  if (x < minX) minX = x;
                  if (x > maxX) maxX = x;
                }
              }
            }

            if (maxX >= minX) {
              nonEmptyCount++;
              slices.push({ xMinFrac: minX / W, xMaxFrac: (maxX + 1) / W });
            } else {
              slices.push({ xMinFrac: 0.5, xMaxFrac: 0.5, empty: true });
            }
          }

          if (nonEmptyCount >= 12) {
            nameProfileCache.set(cacheKey, slices);
            return slices;
          }
        } catch (_) {
          // Cross-origin PNG fallback below
        }
      }
    }
  }

  // Fallback geometry when custom A' PNG hasn't finished loading yet
  const fallback: HorizontalSpan[] = [];
  const endsWithAp = tokens[tokens.length - 1] === "A'";
  const startsWithAp = tokens[0] === "A'";
  const apSetback = Math.min(0.18, 0.24 / Math.max(2, tokens.length));

  for (let s = 0; s < PROFILE_SLICES; s++) {
    const t = (s + 0.5) / PROFILE_SLICES;
    const xMinFrac = startsWithAp && t > 0.42 ? apSetback : 0.0;
    const xMaxFrac = endsWithAp && t > 0.42 ? 1.0 - apSetback : 1.0;
    fallback.push({ xMinFrac, xMaxFrac });
  }

  if (!hasLetterAssets) {
    nameProfileCache.set(cacheKey, fallback);
  }
  return fallback;
}

/**
 * Evaluates horizontal occupied interval [minX, maxX] of a profile at a specific local slice index
 * accounting for 0° vs 180° rotation.
 */
function getProfileSliceSpanByIndex(
  profile: HorizontalSpan[],
  bboxX: number,
  w: number,
  rotationDeg: number,
  sliceIdx: number
): { minX: number; maxX: number } | null {
  const normRot = ((rotationDeg % 360) + 360) % 360;
  const idx = normRot === 180 ? PROFILE_SLICES - 1 - sliceIdx : sliceIdx;
  const span = profile[Math.max(0, Math.min(PROFILE_SLICES - 1, idx))];
  if (!span || span.empty) return null;

  if (normRot === 180) {
    return {
      minX: bboxX + (1 - span.xMaxFrac) * w,
      maxX: bboxX + (1 - span.xMinFrac) * w,
    };
  }
  return {
    minX: bboxX + span.xMinFrac * w,
    maxX: bboxX + span.xMaxFrac * w,
  };
}

/**
 * Exact 2D Euclidean distance clearance solver between two profiled items (A on left, B on right).
 * Checks ALL (sliceA, sliceB) pairs within |dy| < safeGap so diagonal strokes and serif corners
 * never graze or overlap while avoiding unnecessary empty gaps.
 */
function computeProfile2DInterlockDx(
  profA: HorizontalSpan[],
  aW: number,
  aH: number,
  aRot: number,
  profB: HorizontalSpan[],
  bW: number,
  bH: number,
  bRot: number,
  yOffsetBRelToA: number,
  safeGap: number
): number {
  const sliceHA = aH / PROFILE_SLICES;
  const sliceHB = bH / PROFILE_SLICES;
  let requiredDx = -Infinity;

  for (let sA = 0; sA < PROFILE_SLICES; sA++) {
    const spanA = getProfileSliceSpanByIndex(profA, 0, aW, aRot, sA);
    if (!spanA) continue;
    const aTop = sA * sliceHA;
    const aBot = (sA + 1) * sliceHA;

    for (let sB = 0; sB < PROFILE_SLICES; sB++) {
      const bTop = yOffsetBRelToA + sB * sliceHB;
      const bBot = yOffsetBRelToA + (sB + 1) * sliceHB;
      const dy = aBot < bTop ? bTop - aBot : bBot < aTop ? aTop - bBot : 0;
      if (dy >= safeGap) continue;

      const spanB = getProfileSliceSpanByIndex(profB, 0, bW, bRot, sB);
      if (!spanB) continue;

      const horizClear = Math.sqrt(Math.max(0, safeGap * safeGap - dy * dy));
      const needed = spanA.maxX - spanB.minX + horizClear;
      if (needed > requiredDx) requiredDx = needed;
    }
  }

  if (!Number.isFinite(requiredDx)) {
    return parseFloat((aW + safeGap).toFixed(2));
  }
  return parseFloat(Math.max(0.15 * aW, Math.min(aW + safeGap, requiredDx)).toFixed(2));
}

/**
 * Checks if two already-placed profiled items violate minimum 2D Euclidean contour clearance.
 */
function hasProfile2DCollision(
  profA: HorizontalSpan[],
  aX: number,
  aY: number,
  aW: number,
  aH: number,
  aRot: number,
  profB: HorizontalSpan[],
  bX: number,
  bY: number,
  bW: number,
  bH: number,
  bRot: number,
  minClearance: number
): boolean {
  const sliceHA = aH / PROFILE_SLICES;
  const sliceHB = bH / PROFILE_SLICES;

  for (let sA = 0; sA < PROFILE_SLICES; sA++) {
    const spanA = getProfileSliceSpanByIndex(profA, aX, aW, aRot, sA);
    if (!spanA) continue;
    const aTop = aY + sA * sliceHA;
    const aBot = aY + (sA + 1) * sliceHA;

    for (let sB = 0; sB < PROFILE_SLICES; sB++) {
      const bTop = bY + sB * sliceHB;
      const bBot = bY + (sB + 1) * sliceHB;
      const dy = aBot < bTop ? bTop - aBot : bBot < aTop ? aTop - bBot : 0;
      if (dy >= minClearance) continue;

      const spanB = getProfileSliceSpanByIndex(profB, bX, bW, bRot, sB);
      if (!spanB) continue;

      const dx = spanA.maxX < spanB.minX ? spanB.minX - spanA.maxX : spanB.maxX < spanA.minX ? spanA.minX - spanB.maxX : 0;
      if (dx * dx + dy * dy < minClearance * minClearance) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Computes minimum safe X offset (dx) to place '7' B (at bRot) to the right of '7' A (at aRot)
 * maintaining full 2D Euclidean contour clearance across all vertical slices and serif corners.
 */
function computeInterlocked7Dx(
  aW: number,
  aH: number,
  aRot: number,
  aPreset: any,
  bW: number,
  bH: number,
  bRot: number,
  bPreset: any,
  yOffsetBRelativeToA: number,
  safeCutGap: number
): number {
  const profA = getDigitHorizontalProfile('7', aPreset, aW / Math.max(0.5, aH));
  const profB = getDigitHorizontalProfile('7', bPreset, bW / Math.max(0.5, bH));
  return computeProfile2DInterlockDx(profA, aW, aH, aRot, profB, bW, bH, bRot, yOffsetBRelativeToA, safeCutGap);
}

/**
 * Computes minimum safe X offset (dx) to interlock two consecutive A' names (0° followed by 180°).
 */
function computeInterlockedApDx(
  aName: string,
  aW: number,
  aH: number,
  aPreset: any,
  bName: string,
  bW: number,
  bH: number,
  bPreset: any,
  yOffsetBRelativeToA: number,
  safeCutGap: number
): number {
  const profA = getNameHorizontalProfile(aName, aPreset, aW, aH);
  const profB = getNameHorizontalProfile(bName, bPreset, bW, bH);
  return computeProfile2DInterlockDx(profA, aW, aH, 0, profB, bW, bH, 180, yOffsetBRelativeToA, safeCutGap);
}

interface GlyphOBB {
  cx: number;
  cy: number;
  ux: number; // local X unit axis (cos, sin)
  uy: number;
  vx: number; // local Y unit axis (-sin, cos)
  vy: number;
  hw: number; // half width in inches
  hh: number; // half height in inches
  corners: [number, number][];
}

interface XColumnSpan {
  x0: number;
  x1: number;
  topY: number;
  bottomY: number;
}

const curvedGlyphMeasureCanvas =
  typeof document !== 'undefined' ? document.createElement('canvas') : null;

/**
 * Builds local-coordinate oriented glyph bounding boxes (in inches relative to item top-left)
 * for a curved/arched name, matching canvasRenderer & textMeasurement geometry.
 */
function getCurvedGlyphOBBs(
  name: string,
  preset: any,
  itemWidth: number,
  itemHeight: number,
  capHeightInches?: number
): GlyphOBB[] {
  const cleanText = (name || '').trim();
  if (!cleanText) return [];

  const scaleDpi = 300;
  const fallbackCapH = preset?.defaultNameHeightInches || 2.2;
  const refCapH =
    typeof capHeightInches === 'number' && capHeightInches > 0
      ? capHeightInches
      : Math.min(itemHeight * 0.72, fallbackCapH);
  const hPx = refCapH * scaleDpi;

  const letterAssets = preset?.letterAssets || {};
  const tokens = tokenizeNameCharacters(cleanText);
  const hasLetterAssets = tokens.some((c) => c !== ' ' && Boolean(letterAssets[c]));
  const userSpacing = typeof preset?.letterSpacing === 'number' ? preset.letterSpacing : 3;
  const letterGapPx = Math.max(2, userSpacing * (scaleDpi / 30));
  const arcDegrees =
    typeof preset?.arcCurvature === 'number'
      ? preset.arcCurvature
      : typeof preset?.arcAmount === 'number'
      ? preset.arcAmount
      : 24;

  let activeTokens = tokens;
  const charWidthsPx: number[] = [];
  let glyphExtentsPx: CurvedGlyphExtent[] | undefined;
  let glyphHeightPx = hPx;
  let strokeWidthPx = 0;

  if (hasLetterAssets) {
    const spaceWidthPx = hPx * 0.22;
    tokens.forEach((c) => {
      if (c === ' ') {
        charWidthsPx.push(spaceWidthPx);
      } else {
        const url = letterAssets[c];
        const effectiveCharH = c === '.' && url ? hPx * DOT_HEIGHT_RATIO : hPx;
        const cachedRatio = url ? getCachedAssetAspectRatio(url) : null;
        if (cachedRatio) {
          charWidthsPx.push(effectiveCharH * cachedRatio);
        } else {
          charWidthsPx.push(hPx * getDefaultLetterRatio(c));
        }
      }
    });
  } else {
    const fontName = preset?.fontFamily || 'Oswald';
    const fontSize = hPx * 0.95;
    glyphHeightPx = fontSize;
    const rawStroke = typeof preset?.strokeWidth === 'number' ? preset.strokeWidth : 0;
    strokeWidthPx = rawStroke > 0 ? rawStroke * (scaleDpi / 30) : 0;
    const rawChars = cleanText.split('');
    activeTokens = rawChars;

    const ctx = curvedGlyphMeasureCanvas?.getContext('2d');
    if (ctx) {
      ctx.font = `700 ${fontSize}px "${fontName}", "Oswald", "Bebas Neue", "Anton", sans-serif`;
      if ('letterSpacing' in ctx) {
        (ctx as any).letterSpacing = '0px';
      }
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      glyphExtentsPx = [];

      rawChars.forEach((ch) => {
        if (ch === ' ') {
          const spW = fontSize * 0.28;
          charWidthsPx.push(spW);
          glyphExtentsPx!.push({
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
        glyphExtentsPx!.push({ leftPx, rightPx, topPx, bottomPx });
      });
    } else {
      rawChars.forEach((ch) => {
        charWidthsPx.push(ch === ' ' ? fontSize * 0.28 : fontSize * getDefaultLetterRatio(ch));
      });
    }
  }

  const layout = computeCurvedTextLayout({
    tokens: activeTokens,
    charWidthsPx,
    glyphExtentsPx,
    letterGapPx,
    glyphHeightPx,
    arcDegrees,
    strokeWidthPx,
    padPx: 0.04 * scaleDpi,
  });

  const fitScaleX = itemWidth / Math.max(1, layout.boxWidthPx);
  const fitScaleY = itemHeight / Math.max(1, layout.boxHeightPx);
  // Real stroke edge overhang around glyphs
  const strokePadPx = strokeWidthPx > 0 ? strokeWidthPx * 1.05 : 0;

  const obbs: GlyphOBB[] = [];

  layout.glyphs.forEach((g, idx) => {
    if (g.token === ' ') return;
    const ext = glyphExtentsPx?.[idx];
    const halfLeft = ((ext ? ext.leftPx : g.charWidthPx / 2) + strokePadPx) * fitScaleX;
    const halfRight = ((ext ? ext.rightPx : g.charWidthPx / 2) + strokePadPx) * fitScaleX;
    const halfTop = ((ext ? ext.topPx : glyphHeightPx / 2) + strokePadPx) * fitScaleY;
    const halfBot = ((ext ? ext.bottomPx : glyphHeightPx / 2) + strokePadPx) * fitScaleY;

    const localMidX = (halfRight - halfLeft) / 2;
    const localMidY = (halfBot - halfTop) / 2;
    const hw = (halfLeft + halfRight) / 2;
    const hh = (halfTop + halfBot) / 2;

    const cosA = Math.cos(g.angleRad);
    const sinA = Math.sin(g.angleRad);
    const cx = g.cx * fitScaleX + localMidX * cosA - localMidY * sinA;
    const cy = g.cy * fitScaleY + localMidX * sinA + localMidY * cosA;

    const corners: [number, number][] = [
      [cx - hw * cosA + hh * sinA, cy - hw * sinA - hh * cosA],
      [cx + hw * cosA + hh * sinA, cy + hw * sinA - hh * cosA],
      [cx + hw * cosA - hh * sinA, cy + hw * sinA + hh * cosA],
      [cx - hw * cosA - hh * sinA, cy - hw * sinA + hh * cosA],
    ];

    obbs.push({
      cx,
      cy,
      ux: cosA,
      uy: sinA,
      vx: -sinA,
      vy: cosA,
      hw,
      hh,
      corners,
    });
  });

  return obbs;
}

/**
 * Rasterizes curved glyph OBBs into exact X-slab vertical occupancy intervals [topY, bottomY].
 */
function rasterizeCurvedArchYSpanProfile(
  itemWidth: number,
  obbs: GlyphOBB[],
  numBins: number = 48
): XColumnSpan[] {
  const bins: XColumnSpan[] = [];
  const binW = itemWidth / numBins;

  for (let b = 0; b < numBins; b++) {
    const x0 = b * binW;
    const x1 = (b + 1) * binW;
    let minY = Infinity;
    let maxY = -Infinity;

    for (const obb of obbs) {
      const pts = obb.corners;
      for (let e = 0; e < 4; e++) {
        const [ax, ay] = pts[e];
        const [bx, by] = pts[(e + 1) % 4];
        const eMinX = Math.min(ax, bx);
        const eMaxX = Math.max(ax, bx);
        if (eMaxX < x0 || eMinX > x1) continue;

        if (ax >= x0 && ax <= x1) {
          if (ay < minY) minY = ay;
          if (ay > maxY) maxY = ay;
        }
        if (bx >= x0 && bx <= x1) {
          if (by < minY) minY = by;
          if (by > maxY) maxY = by;
        }

        const dx = bx - ax;
        if (Math.abs(dx) > 1e-6) {
          if ((ax < x0 && bx > x0) || (bx < x0 && ax > x0)) {
            const t = (x0 - ax) / dx;
            const y = ay + t * (by - ay);
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
          if ((ax < x1 && bx > x1) || (bx < x1 && ax > x1)) {
            const t = (x1 - ax) / dx;
            const y = ay + t * (by - ay);
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
    }

    if (Number.isFinite(minY) && Number.isFinite(maxY)) {
      bins.push({ x0, x1, topY: minY, bottomY: maxY });
    }
  }

  return bins;
}

/**
 * Computes minimum vertical Y coordinate at which a candidate curved row can sit
 * safely tucked into the concave arch belly of already-placed curved items above it.
 */
function computeMinNestedCurvedRowY(
  candRow: { x: number; w: number; h: number; profile: XColumnSpan[] }[],
  placedCurved: { x: number; y: number; w: number; h: number; profile: XColumnSpan[] }[],
  prevRowTopY: number,
  vertGap: number,
  minFloorY: number
): number {
  let reqY = minFloorY;

  for (const cand of candRow) {
    for (const placed of placedCurved) {
      if (cand.x + cand.w + vertGap <= placed.x || cand.x >= placed.x + placed.w + vertGap) {
        continue;
      }

      for (const cBin of cand.profile) {
        const cx0 = cand.x + cBin.x0;
        const cx1 = cand.x + cBin.x1;

        for (const pBin of placed.profile) {
          const px0 = placed.x + pBin.x0;
          const px1 = placed.x + pBin.x1;
          const dx = cx1 < px0 ? px0 - cx1 : px1 < cx0 ? cx0 - px1 : 0;
          if (dx >= vertGap) continue;

          const reqDY = Math.sqrt(Math.max(0, vertGap * vertGap - dx * dx));
          const neededTopY = placed.y + pBin.bottomY + reqDY - cBin.topY;
          if (neededTopY > reqY) reqY = neededTopY;
        }
      }
    }
  }

  // Monotonic progression below previous row top
  const monotonicMin = prevRowTopY + 0.35;
  return parseFloat(Math.max(reqY, monotonicMin).toFixed(2));
}

/**
 * 2D Separating Axis Theorem check between two oriented glyph rectangles (with safety clearance pad).
 */
function doGlyphOBBsOverlap(a: GlyphOBB, b: GlyphOBB, aOffX: number, aOffY: number, bOffX: number, bOffY: number, pad: number): boolean {
  const tx = b.cx + bOffX - (a.cx + aOffX);
  const ty = b.cy + bOffY - (a.cy + aOffY);
  const axes: [number, number][] = [
    [a.ux, a.uy],
    [a.vx, a.vy],
    [b.ux, b.uy],
    [b.vx, b.vy],
  ];

  const aHw = a.hw + pad * 0.5;
  const aHh = a.hh + pad * 0.5;
  const bHw = b.hw + pad * 0.5;
  const bHh = b.hh + pad * 0.5;

  for (const [lx, ly] of axes) {
    const distCenter = Math.abs(tx * lx + ty * ly);
    const projA = aHw * Math.abs(a.ux * lx + a.uy * ly) + aHh * Math.abs(a.vx * lx + a.vy * ly);
    const projB = bHw * Math.abs(b.ux * lx + b.uy * ly) + bHh * Math.abs(b.vx * lx + b.vy * ly);
    if (distCenter >= projA + projB) {
      return false;
    }
  }
  return true;
}

/**
 * Checks whether two upright curved names truly touch glyph-to-glyph (within minClearance inches).
 */
function doCurvedItemsCollide(a: CanvasItem, b: CanvasItem, minClearance: number): boolean {
  const obbsA = getCurvedGlyphOBBs(a.customerName, a.preset, a.width, a.height, a.letterCapHeightInches);
  const obbsB = getCurvedGlyphOBBs(b.customerName, b.preset, b.width, b.height, b.letterCapHeightInches);
  if (obbsA.length === 0 || obbsB.length === 0) return true;

  for (const ga of obbsA) {
    for (const gb of obbsB) {
      if (doGlyphOBBsOverlap(ga, gb, a.x, a.y, b.x, b.y, minClearance)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Logical name splitting helper: splits at word boundary first (e.g. "SERGIO RAMOS" -> "SERGIO" + "RAMOS"),
 * or finds the widest logical prefix of tokens (>= 2 chars, leaving >= 2 chars) fitting maxWidth.
 */
function findBestNameSplit(
  name: string,
  preset: any,
  capHeightInches: number,
  maxFitWidthInches: number
): { part1: string; part1W: number; part1H: number; part2: string; part2W: number; part2H: number } | null {
  const trimmed = name.trim();
  if (!trimmed) return null;

  // 1. Prefer clean multi-word boundary splits
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    for (let splitAt = words.length - 1; splitAt >= 1; splitAt--) {
      const p1 = words.slice(0, splitAt).join(' ');
      const p2 = words.slice(splitAt).join(' ');
      const d1 = calculateTightTextDimensions(p1, 'name', preset, capHeightInches);
      if (d1.widthInches <= maxFitWidthInches) {
        const d2 = calculateTightTextDimensions(p2, 'name', preset, capHeightInches);
        return {
          part1: p1,
          part1W: d1.widthInches,
          part1H: d1.heightInches,
          part2: p2,
          part2W: d2.widthInches,
          part2H: d2.heightInches,
        };
      }
    }
  }

  // 2. Logical letter-token prefix split (e.g., RONALDO -> RON + ALDO, MALDINI -> MAL + DINI)
  const tokens = tokenizeNameCharacters(trimmed);
  if (tokens.length < 4) return null;

  for (let k = tokens.length - 2; k >= 2; k--) {
    const leftTokens = tokens.slice(0, k);
    const rightTokens = tokens.slice(k);
    const p1 = leftTokens.join('').trim();
    const p2 = rightTokens.join('').trim();
    if (tokenizeNameCharacters(p1).length < 2 || tokenizeNameCharacters(p2).length < 2) {
      continue;
    }

    const d1 = calculateTightTextDimensions(p1, 'name', preset, capHeightInches);
    if (d1.widthInches <= maxFitWidthInches) {
      const d2 = calculateTightTextDimensions(p2, 'name', preset, capHeightInches);
      return {
        part1: p1,
        part1W: d1.widthInches,
        part1H: d1.heightInches,
        part2: p2,
        part2W: d2.widthInches,
        part2H: d2.heightInches,
      };
    }
  }

  return null;
}

/**
 * Checks whether a candidate AABB rectangle overlaps any placed item (with optional safety gap).
 */
function hasBoxOverlap(
  items: CanvasItem[],
  candX: number,
  candY: number,
  candW: number,
  candH: number,
  gap: number
): boolean {
  for (const it of items) {
    const b = getRotatedBBox(it.x, it.y, it.width, it.height, it.rotation || 0);
    if (
      candX < b.x + b.width + gap &&
      candX + candW + gap > b.x &&
      candY < b.y + b.height + gap &&
      candY + candH + gap > b.y
    ) {
      return true;
    }
  }
  return false;
}

/**
 * 2D Shelf/Bin Auto-Nesting Algorithm for 39" DTF Roll with:
 * - Smart Name Splitting & Lookahead Gap Fill
 * - Diagonal 180° Contour Interlocking for '7's & Narrow Digit Lookahead
 * - Balanced/Centered Round Name Layout & Right-Column Vertical Pocket Packing
 */
export function generateAutoNestingLayout(
  orders: OrderItem[],
  settings: LayoutSettings
): AutoNestingResult {
  const rollWidth = settings.rollWidthInches || 39.0;
  // Minimum safe DTF cutting clearance (~2.3mm floor when Tight is chosen, honoring wider gaps if selected)
  const margin = Math.max(0.09, settings.marginInches ?? 0.16);
  const safeCutGap = Math.max(0.09, margin);
  const canvasItems: CanvasItem[] = [];
  const modificationLogs: DigitSplitLogEntry[] = [];

  // Determine active digit unbundle mode
  const digitMode: DigitNestingMode =
    settings.digitNestingMode || (settings.splitDigitsForNesting === false ? 'intact' : 'smart_unbundle');

  interface UnpackedBlock {
    id: string;
    orderId: string;
    itemType: 'name' | 'number';
    customerName: string;
    number: string;
    designCode: string;
    preset: any;
    w: number;
    h: number;
    capH?: number;
    garmentSize: any;
    rawDigits?: string[];
    digitIndex?: number;
    isSplitDigit?: boolean;
    parentNumber?: string;
    isCurvedText?: boolean;
    isChestNumber?: boolean;
    isSplitNamePart?: boolean;
    parentName?: string;
    partIndex?: number;
  }

  const straightNameBlocks: UnpackedBlock[] = [];
  const curvedTextBlocks: UnpackedBlock[] = [];
  const numberBlocks: UnpackedBlock[] = [];
  const smallChestNumberBlocks: UnpackedBlock[] = [];

  orders.forEach((ord) => {
    if (!ord.matchedPreset) return;

    let scale = 1.0;
    if (ord.garmentSize === 'Youth') scale = 0.8;
    if (ord.garmentSize === 'Infant') scale = 0.65;

    const isCurved = isPresetCurved(ord.matchedPreset);

    // Name block
    if (ord.customerName) {
      const presetNameHeight = ord.matchedPreset?.defaultNameHeightInches || 2.2;
      const capHeight = presetNameHeight * scale;
      const tightName = calculateTightTextDimensions(ord.customerName, 'name', ord.matchedPreset, capHeight);

      const block: UnpackedBlock = {
        id: `${ord.id}-name`,
        orderId: ord.id,
        itemType: 'name',
        customerName: ord.customerName,
        number: ord.number,
        designCode: ord.designCode,
        preset: ord.matchedPreset,
        w: tightName.widthInches,
        h: tightName.heightInches,
        capH: capHeight,
        garmentSize: ord.garmentSize,
        isCurvedText: isCurved,
      };

      if (isCurved) {
        curvedTextBlocks.push(block);
      } else {
        straightNameBlocks.push(block);
      }
    }

    // Number block
    if (ord.number) {
      const presetNumHeight = ord.matchedPreset?.defaultNumberHeightInches || 9.5;
      const numHeight = presetNumHeight * scale;
      const cleanDigits = ord.number.trim().replace(/\s+/g, '').split('');

      if (cleanDigits.length > 1 && digitMode === 'split_all') {
        cleanDigits.forEach((digit, digitIdx) => {
          const tightDigit = calculateTightTextDimensions(digit, 'number', ord.matchedPreset, numHeight);
          numberBlocks.push({
            id: `${ord.id}-number-d${digitIdx}`,
            orderId: ord.id,
            itemType: 'number',
            customerName: `${ord.customerName} (Digit ${digit})`,
            number: digit,
            designCode: ord.designCode,
            preset: ord.matchedPreset,
            w: tightDigit.widthInches,
            h: tightDigit.heightInches,
            garmentSize: ord.garmentSize,
            isSplitDigit: true,
            digitIndex: digitIdx,
            parentNumber: ord.number,
          });
        });

        modificationLogs.push({
          id: `log-${ord.id}-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
          orderId: ord.id,
          customerName: ord.customerName,
          originalNumber: ord.number,
          reason: 'gap_optimization',
          entryType: 'number',
          digits: cleanDigits.map((d, i) => ({
            digit: d,
            itemId: `${ord.id}-number-d${i}`,
            x: 0,
            y: 0,
            width: calculateTightTextDimensions(d, 'number', ord.matchedPreset, numHeight).widthInches,
            height: numHeight,
            shelfRowIndex: 1,
          })),
          spaceSavedInches: parseFloat((calculateTightTextDimensions(ord.number, 'number', ord.matchedPreset, numHeight).widthInches * 0.35).toFixed(2)),
          timestamp: new Date().toLocaleTimeString(),
        });
      } else {
        const tightNum = calculateTightTextDimensions(ord.number, 'number', ord.matchedPreset, numHeight);
        numberBlocks.push({
          id: `${ord.id}-number`,
          orderId: ord.id,
          itemType: 'number',
          customerName: ord.customerName,
          number: ord.number,
          designCode: ord.designCode,
          preset: ord.matchedPreset,
          w: tightNum.widthInches,
          h: tightNum.heightInches,
          garmentSize: ord.garmentSize,
          rawDigits: cleanDigits.length > 1 ? cleanDigits : undefined,
        });
      }

      // Dynamic Small / Chest Number Generation
      const enableChestNumber = Boolean(
        ord.hasSmallChestNumber ?? ord.matchedPreset?.hasSmallChestNumber
      );

      if (enableChestNumber) {
        const presetChestHeight = ord.smallChestNumberHeightInches || ord.matchedPreset?.smallChestNumberHeightInches || 3.0;
        const chestNumHeight = presetChestHeight * scale;
        const tightChestNum = calculateTightTextDimensions(ord.number, 'number', ord.matchedPreset, chestNumHeight);

        smallChestNumberBlocks.push({
          id: `${ord.id}-chest-number`,
          orderId: ord.id,
          itemType: 'number',
          customerName: `${ord.customerName} (Chest #${ord.number})`,
          number: ord.number,
          designCode: ord.designCode,
          preset: ord.matchedPreset,
          w: tightChestNum.widthInches,
          h: tightChestNum.heightInches,
          garmentSize: ord.garmentSize,
          isChestNumber: true,
          parentNumber: ord.number,
        });
      }
    }
  });

  let currentY = margin;
  let currentX = margin;
  let shelfHeight = 0;
  let zCounter = 1;
  let currentRowIndex = 1;

  // ============================================================================
  // 1. PACK STRAIGHT NAMES WITH SMART NAME SPLITTING & RIGHT-STRIP POCKET FILL
  // ============================================================================
  if (straightNameBlocks.length > 0) {
    interface ShelfRowRecord {
      rowIndex: number;
      yTop: number;
      height: number;
      usedRightX: number;
      items: CanvasItem[];
    }

    const nameRows: ShelfRowRecord[] = [];
    const pool = [...straightNameBlocks];
    const maxAllowedX = rollWidth - margin;

    const pushRowItem = (item: CanvasItem, blockH: number) => {
      let row = nameRows.find((r) => r.rowIndex === currentRowIndex);
      if (!row) {
        row = {
          rowIndex: currentRowIndex,
          yTop: currentY,
          height: 0,
          usedRightX: margin,
          items: [],
        };
        nameRows.push(row);
      }
      row.items.push(item);
      row.height = Math.max(row.height, blockH);
      row.usedRightX = Math.max(row.usedRightX, item.x + item.width);
      canvasItems.push(item);
    };

    let lastStraightItem: CanvasItem | null = null;

    while (pool.length > 0) {
      const rem = maxAllowedX - currentX;
      const head = pool[0];

      // Strict A' Interlock Rule: Applies ONLY when two consecutive A' straight-name items are placed.
      // Keeps first A' upright (0°), rotates second A' by 180°, and interlocks with minimum safe cutting gap.
      if (
        lastStraightItem &&
        (lastStraightItem.rotation || 0) === 0 &&
        !lastStraightItem.interlockGroupId &&
        isApName(lastStraightItem.customerName) &&
        isApName(head.customerName) &&
        Math.abs(head.h - lastStraightItem.height) <= 0.45
      ) {
        const yOffsetRel = (lastStraightItem.height - head.h) / 2;
        const dx = computeInterlockedApDx(
          lastStraightItem.customerName,
          lastStraightItem.width,
          lastStraightItem.height,
          lastStraightItem.preset,
          head.customerName,
          head.w,
          head.h,
          head.preset,
          yOffsetRel,
          safeCutGap
        );
        const candRightEdge = lastStraightItem.x + dx + head.w;
        const minSafeLeftX = lastStraightItem.x + Math.max(0.45 * lastStraightItem.width, dx);

        if (
          candRightEdge <= maxAllowedX &&
          dx < lastStraightItem.width + safeCutGap - 0.06 &&
          minSafeLeftX > lastStraightItem.x
        ) {
          pool.shift();
          const groupId = `ilock-ap-${lastStraightItem.id}`;
          lastStraightItem.interlockGroupId = groupId;
          lastStraightItem.interlockRole = 'primary';

          const invY = lastStraightItem.y + (lastStraightItem.height - head.h) / 2;
          const invItem: CanvasItem = {
            id: head.id,
            orderId: head.orderId,
            itemType: 'name',
            customerName: head.customerName,
            number: head.number,
            designCode: head.designCode,
            preset: head.preset,
            x: parseFloat((lastStraightItem.x + dx).toFixed(2)),
            y: parseFloat(invY.toFixed(2)),
            width: parseFloat(head.w.toFixed(2)),
            height: parseFloat(head.h.toFixed(2)),
            letterCapHeightInches: head.capH,
            rotation: 180,
            zIndex: zCounter++,
            garmentSize: head.garmentSize,
            isSplitNamePart: head.isSplitNamePart,
            parentName: head.parentName,
            partIndex: head.partIndex,
            interlockGroupId: groupId,
            interlockRole: 'inverted',
          };
          pushRowItem(invItem, head.h);

          const savedW = parseFloat((lastStraightItem.width + margin - dx).toFixed(2));
          modificationLogs.push({
            id: `log-ilock-ap-${groupId}`,
            orderId: invItem.orderId,
            customerName: `${lastStraightItem.customerName} + ${invItem.customerName} (180° A')`,
            originalNumber: head.customerName,
            reason: 'interlock_ap_pair',
            entryType: 'interlock',
            digits: [
              {
                digit: "A'↑",
                itemId: lastStraightItem.id,
                x: lastStraightItem.x,
                y: lastStraightItem.y,
                width: lastStraightItem.width,
                height: lastStraightItem.height,
                shelfRowIndex: currentRowIndex,
              },
              {
                digit: "A'↓",
                itemId: invItem.id,
                x: invItem.x,
                y: invItem.y,
                width: invItem.width,
                height: invItem.height,
                shelfRowIndex: currentRowIndex,
              },
            ],
            spaceSavedInches: savedW,
            timestamp: new Date().toLocaleTimeString(),
          });

          currentX = candRightEdge + margin;
          if (head.h > shelfHeight) shelfHeight = head.h;
          lastStraightItem = invItem;
          continue;
        }
      }

      // Fits cleanly on current row (or row is fresh)
      if (head.w <= rem || currentX === margin) {
        pool.shift();
        const item: CanvasItem = {
          id: head.id,
          orderId: head.orderId,
          itemType: 'name',
          customerName: head.customerName,
          number: head.number,
          designCode: head.designCode,
          preset: head.preset,
          x: parseFloat(currentX.toFixed(2)),
          y: parseFloat(currentY.toFixed(2)),
          width: parseFloat(head.w.toFixed(2)),
          height: parseFloat(head.h.toFixed(2)),
          letterCapHeightInches: head.capH,
          rotation: 0,
          zIndex: zCounter++,
          garmentSize: head.garmentSize,
          isSplitNamePart: head.isSplitNamePart,
          parentName: head.parentName,
          partIndex: head.partIndex,
        };
        pushRowItem(item, head.h);
        currentX += head.w + margin;
        if (head.h > shelfHeight) shelfHeight = head.h;
        lastStraightItem = item;
        continue;
      }

      // Lookahead: find a whole name in pool that fits remaining gap on this row
      let fitIdx = -1;
      for (let k = 1; k < pool.length; k++) {
        if (pool[k].w <= rem) {
          fitIdx = k;
          break;
        }
      }
      if (fitIdx !== -1) {
        const chosen = pool.splice(fitIdx, 1)[0];
        const item: CanvasItem = {
          id: chosen.id,
          orderId: chosen.orderId,
          itemType: 'name',
          customerName: chosen.customerName,
          number: chosen.number,
          designCode: chosen.designCode,
          preset: chosen.preset,
          x: parseFloat(currentX.toFixed(2)),
          y: parseFloat(currentY.toFixed(2)),
          width: parseFloat(chosen.w.toFixed(2)),
          height: parseFloat(chosen.h.toFixed(2)),
          letterCapHeightInches: chosen.capH,
          rotation: 0,
          zIndex: zCounter++,
          garmentSize: chosen.garmentSize,
          isSplitNamePart: chosen.isSplitNamePart,
          parentName: chosen.parentName,
          partIndex: chosen.partIndex,
        };
        pushRowItem(item, chosen.h);
        currentX += chosen.w + margin;
        if (chosen.h > shelfHeight) shelfHeight = chosen.h;
        lastStraightItem = item;
        continue;
      }

      // Smart Name Splitting: check if remaining space is large enough for a logical prefix
      let didSplitName = false;
      if (rem >= 2.2) {
        // Try splitting pool[0] first, or another splittable candidate
        const candIdx = [0, ...pool.map((_, idx) => idx).slice(1)].find((idx) => {
          const c = pool[idx];
          if (c.isSplitNamePart) return false; // already a fragment
          return Boolean(findBestNameSplit(c.customerName, c.preset, c.capH || c.h, rem));
        });

        if (candIdx !== undefined) {
          const cand = pool.splice(candIdx, 1)[0];
          const split = findBestNameSplit(cand.customerName, cand.preset, cand.capH || cand.h, rem);
          if (split) {
            didSplitName = true;
            const part1Id = `${cand.id}-p0`;
            const part2Id = `${cand.id}-p1`;

            const p1Item: CanvasItem = {
              id: part1Id,
              orderId: cand.orderId,
              itemType: 'name',
              customerName: split.part1,
              number: cand.number,
              designCode: cand.designCode,
              preset: cand.preset,
              x: parseFloat(currentX.toFixed(2)),
              y: parseFloat(currentY.toFixed(2)),
              width: split.part1W,
              height: split.part1H,
              letterCapHeightInches: cand.capH,
              rotation: 0,
              zIndex: zCounter++,
              garmentSize: cand.garmentSize,
              isSplitNamePart: true,
              parentName: cand.parentName || cand.customerName,
              partIndex: 0,
            };
            pushRowItem(p1Item, split.part1H);

            // Re-queue remainder at the front so it places right in the next available space
            pool.unshift({
              ...cand,
              id: part2Id,
              customerName: split.part2,
              w: split.part2W,
              h: split.part2H,
              isSplitNamePart: true,
              parentName: cand.parentName || cand.customerName,
              partIndex: 1,
            });

            modificationLogs.push({
              id: `log-ns-${cand.id}-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
              orderId: cand.orderId,
              customerName: cand.parentName || cand.customerName,
              originalNumber: cand.parentName || cand.customerName,
              reason: 'smart_name_split',
              entryType: 'name',
              digits: [
                {
                  digit: split.part1,
                  itemId: part1Id,
                  x: p1Item.x,
                  y: p1Item.y,
                  width: p1Item.width,
                  height: p1Item.height,
                  shelfRowIndex: currentRowIndex,
                },
                {
                  digit: split.part2,
                  itemId: part2Id,
                  x: 0,
                  y: 0,
                  width: split.part2W,
                  height: split.part2H,
                  shelfRowIndex: currentRowIndex + 1,
                },
              ],
              spaceSavedInches: parseFloat((split.part1W + margin).toFixed(2)),
              timestamp: new Date().toLocaleTimeString(),
            });

            currentX += split.part1W + margin;
            if (split.part1H > shelfHeight) shelfHeight = split.part1H;
            lastStraightItem = p1Item;
          } else {
            pool.splice(candIdx, 0, cand);
          }
        }
      }

      if (!didSplitName) {
        currentX = margin;
        currentY += shelfHeight + margin;
        shelfHeight = 0;
        currentRowIndex++;
        lastStraightItem = null;
      }
    }

    // Post-Pass Vertical Right-Pocket Compaction for Straight Names:
    // If trailing row(s) can be moved rotated 90° into an empty vertical strip on the right of earlier rows
    // and actually eliminate a row (reducing total height), pack them vertically!
    if (nameRows.length >= 3) {
      let improved = true;
      while (improved && nameRows.length >= 3) {
        improved = false;
        const lastRow = nameRows[nameRows.length - 1];
        if (lastRow.items.length > 2) break;

        for (let rStart = 0; rStart < nameRows.length - 1; rStart++) {
          let maxRight = 0;
          let pocketBottom = nameRows[rStart].yTop;
          const pocketTop = nameRows[rStart].yTop;

          for (let rEnd = rStart; rEnd < nameRows.length - 1; rEnd++) {
            maxRight = Math.max(maxRight, nameRows[rEnd].usedRightX);
            pocketBottom = nameRows[rEnd].yTop + nameRows[rEnd].height;
            const pocketX = maxRight + margin;
            const pocketW = maxAllowedX - pocketX;
            const pocketH = pocketBottom - pocketTop;

            if (pocketW < 2.2) continue;

            // Try fitting ALL items on lastRow rotated 90° side-by-side in this pocket
            const candidates = lastRow.items;
            const totalRotW = candidates.reduce((acc, it, idx) => acc + it.height + (idx > 0 ? margin : 0), 0);
            const maxRotH = Math.max(...candidates.map((it) => it.width));

            if (totalRotW <= pocketW && maxRotH <= pocketH) {
              // Verify zero overlap before committing
              let px = pocketX;
              const placements: { item: CanvasItem; nx: number; ny: number }[] = [];
              let ok = true;
              for (const cand of candidates) {
                if (hasBoxOverlap(canvasItems.filter((c) => !candidates.includes(c)), px, pocketTop, cand.height, cand.width, margin * 0.85)) {
                  ok = false;
                  break;
                }
                const coords = itemCoordsForAABBTopLeft(px, pocketTop, cand.width, cand.height, 90);
                placements.push({ item: cand, nx: coords.x, ny: coords.y });
                px += cand.height + margin;
              }
              if (ok) {
                for (const p of placements) {
                  p.item.x = p.nx;
                  p.item.y = p.ny;
                  p.item.rotation = 90;
                }
                for (let r = rStart; r <= rEnd; r++) {
                  nameRows[r].usedRightX = Math.max(nameRows[r].usedRightX, px - margin);
                }
                nameRows.pop();
                improved = true;
                break;
              }
            } else if (candidates.length === 1 && candidates[0].height <= pocketW && pocketW >= candidates[0].height * 2 + margin) {
              // Split single trailing name into 2 rotated side-by-side vertical parts (e.g. TA + MIM)
              const only = candidates[0];
              const split = findBestNameSplit(only.customerName, only.preset, only.letterCapHeightInches || only.height, pocketH);
              if (split && split.part2W <= pocketH && !only.isSplitNamePart) {
                const others = canvasItems.filter((c) => c.id !== only.id);
                const c1Fits = !hasBoxOverlap(others, pocketX, pocketTop, split.part1H, split.part1W, margin * 0.85);
                const c2Fits = !hasBoxOverlap(others, pocketX + split.part1H + margin, pocketTop, split.part2H, split.part2W, margin * 0.85);
                if (c1Fits && c2Fits) {
                  const idx = canvasItems.findIndex((c) => c.id === only.id);
                  if (idx !== -1) canvasItems.splice(idx, 1);

                  const p1Coords = itemCoordsForAABBTopLeft(pocketX, pocketTop, split.part1W, split.part1H, 90);
                  const p2Coords = itemCoordsForAABBTopLeft(pocketX + split.part1H + margin, pocketTop, split.part2W, split.part2H, 90);
                  const p1Id = `${only.id}-vp0`;
                  const p2Id = `${only.id}-vp1`;

                  const p1Item: CanvasItem = {
                    ...only,
                    id: p1Id,
                    customerName: split.part1,
                    x: p1Coords.x,
                    y: p1Coords.y,
                    width: split.part1W,
                    height: split.part1H,
                    rotation: 90,
                    isSplitNamePart: true,
                    parentName: only.customerName,
                    partIndex: 0,
                  };
                  const p2Item: CanvasItem = {
                    ...only,
                    id: p2Id,
                    customerName: split.part2,
                    x: p2Coords.x,
                    y: p2Coords.y,
                    width: split.part2W,
                    height: split.part2H,
                    rotation: 90,
                    isSplitNamePart: true,
                    parentName: only.customerName,
                    partIndex: 1,
                    zIndex: zCounter++,
                  };
                  canvasItems.push(p1Item, p2Item);
                  modificationLogs.push({
                    id: `log-vp-${only.id}-${Date.now()}`,
                    orderId: only.orderId,
                    customerName: only.customerName,
                    originalNumber: only.customerName,
                    reason: 'smart_name_split',
                    entryType: 'name',
                    digits: [
                      { digit: split.part1, itemId: p1Id, x: p1Item.x, y: p1Item.y, width: split.part1W, height: split.part1H, shelfRowIndex: rStart + 1 },
                      { digit: split.part2, itemId: p2Id, x: p2Item.x, y: p2Item.y, width: split.part2W, height: split.part2H, shelfRowIndex: rStart + 1 },
                    ],
                    spaceSavedInches: parseFloat((lastRow.height + margin).toFixed(2)),
                    timestamp: new Date().toLocaleTimeString(),
                  });
                  for (let r = rStart; r <= rEnd; r++) {
                    nameRows[r].usedRightX = Math.max(nameRows[r].usedRightX, pocketX + split.part1H + margin + split.part2H);
                  }
                  nameRows.pop();
                  improved = true;
                  break;
                }
              }
            }
          }
          if (improved) break;
        }
      }
    }

    // Recompute exact bottom Y of straight names section
    let sectionMaxY = currentY + shelfHeight;
    canvasItems.forEach((it) => {
      const b = getRotatedBBox(it.x, it.y, it.width, it.height, it.rotation || 0);
      if (b.y + b.height > sectionMaxY) sectionMaxY = b.y + b.height;
    });

    currentX = margin;
    currentY = sectionMaxY + margin + 0.20;
    shelfHeight = 0;
    currentRowIndex++;
  }

  // ============================================================================
  // 2. SMARTER NUMBER PLACEMENT (180° INTERLOCKING '7's + LOOKAHEAD GAP FILL)
  // ============================================================================
  if (numberBlocks.length > 0) {
    const numberSectionStartY = currentY;
    const pool = [...numberBlocks];
    const maxAllowedRowWidth = rollWidth - margin;

    let lastRowItem: CanvasItem | null = null;

    const placeNumberBlock = (block: UnpackedBlock, x: number, y: number, rotation: number, interlockGroupId?: string, interlockRole?: 'primary' | 'inverted'): CanvasItem => {
      const item: CanvasItem = {
        id: block.id,
        orderId: block.orderId,
        itemType: 'number',
        customerName: block.customerName,
        number: block.number,
        designCode: block.designCode,
        preset: block.preset,
        x: parseFloat(x.toFixed(2)),
        y: parseFloat(y.toFixed(2)),
        width: parseFloat(block.w.toFixed(2)),
        height: parseFloat(block.h.toFixed(2)),
        rotation,
        zIndex: zCounter++,
        garmentSize: block.garmentSize,
        isChestNumber: block.isChestNumber,
        isSplitDigit: block.isSplitDigit,
        digitIndex: block.digitIndex,
        parentNumber: block.parentNumber,
        interlockGroupId,
        interlockRole,
      };
      canvasItems.push(item);
      return item;
    };

    const findMatching7Index = (refItem: CanvasItem): number => {
      // Prefer same preset/height first, then any compatible height '7'
      let idx = pool.findIndex(
        (b) =>
          b.number === '7' &&
          b.preset?.id === refItem.preset?.id &&
          Math.abs(b.h - refItem.height) <= 0.75
      );
      if (idx === -1) {
        idx = pool.findIndex(
          (b) => b.number === '7' && Math.abs(b.h - refItem.height) <= 1.25
        );
      }
      return idx;
    };

    while (pool.length > 0) {
      const remainingRowSpace = maxAllowedRowWidth - currentX;

      // Priority A: Consistent 2D contour interlocking for '7's:
      // - When previous item is an upright (0°) unpaired '7', rotate next matching '7' 180° and interlock cleanly
      // - When previous item is an inverted (180°) '7' and next item is a '7', place upright (0°) at exact 2D safeCutGap
      if (
        lastRowItem &&
        lastRowItem.number === '7' &&
        (lastRowItem.rotation || 0) === 0 &&
        !lastRowItem.interlockGroupId
      ) {
        const match7Idx = findMatching7Index(lastRowItem);
        if (match7Idx !== -1) {
          const cand7 = pool[match7Idx];
          const yOffsetRel = lastRowItem.height - cand7.h;
          const dx = computeInterlocked7Dx(
            lastRowItem.width,
            lastRowItem.height,
            0,
            lastRowItem.preset,
            cand7.w,
            cand7.h,
            180,
            cand7.preset,
            yOffsetRel,
            safeCutGap
          );

          const candRightEdge = lastRowItem.x + dx + cand7.w;
          if (candRightEdge <= maxAllowedRowWidth && dx < lastRowItem.width + safeCutGap) {
            pool.splice(match7Idx, 1);
            const groupId = `ilock-${lastRowItem.id}`;
            lastRowItem.interlockGroupId = groupId;
            lastRowItem.interlockRole = 'primary';

            const invY = lastRowItem.y + yOffsetRel;
            const placedInv = placeNumberBlock(
              cand7,
              lastRowItem.x + dx,
              invY,
              180,
              groupId,
              'inverted'
            );

            const savedW = parseFloat((lastRowItem.width + margin - dx).toFixed(2));
            modificationLogs.push({
              id: `log-ilock-${groupId}`,
              orderId: placedInv.orderId,
              customerName: `${lastRowItem.number} + ${placedInv.number} (180° Nested)`,
              originalNumber: '77',
              reason: 'interlock_7_pair',
              entryType: 'interlock',
              digits: [
                {
                  digit: '7↑',
                  itemId: lastRowItem.id,
                  x: lastRowItem.x,
                  y: lastRowItem.y,
                  width: lastRowItem.width,
                  height: lastRowItem.height,
                  shelfRowIndex: currentRowIndex,
                },
                {
                  digit: '7↓',
                  itemId: placedInv.id,
                  x: placedInv.x,
                  y: placedInv.y,
                  width: placedInv.width,
                  height: placedInv.height,
                  shelfRowIndex: currentRowIndex,
                },
              ],
              spaceSavedInches: savedW,
              timestamp: new Date().toLocaleTimeString(),
            });

            currentX = candRightEdge + safeCutGap;
            if (cand7.h > shelfHeight) shelfHeight = cand7.h;
            lastRowItem = placedInv;
            continue;
          }
        }
      } else if (
        lastRowItem &&
        lastRowItem.number === '7' &&
        (lastRowItem.rotation || 0) === 180
      ) {
        const matchNext7Idx = findMatching7Index(lastRowItem);
        if (matchNext7Idx !== -1) {
          const next7 = pool[matchNext7Idx];
          const yOffsetRel = lastRowItem.height - next7.h;
          const dxFromInv = computeInterlocked7Dx(
            lastRowItem.width,
            lastRowItem.height,
            180,
            lastRowItem.preset,
            next7.w,
            next7.h,
            0,
            next7.preset,
            yOffsetRel,
            safeCutGap
          );
          const minSafeXFromPrev = Math.max(
            lastRowItem.x + dxFromInv,
            ...canvasItems
              .filter((it) => {
                const b = getRotatedBBox(it.x, it.y, it.width, it.height, it.rotation || 0);
                return (
                  b.y < currentY + next7.h + safeCutGap &&
                  b.y + b.height + safeCutGap > currentY &&
                  b.x <= lastRowItem!.x
                );
              })
              .map((it) => {
                if (it.id === lastRowItem!.id) return lastRowItem!.x + dxFromInv;
                const b = getRotatedBBox(it.x, it.y, it.width, it.height, it.rotation || 0);
                return b.x + b.width + safeCutGap;
              })
          );
          const candRight = minSafeXFromPrev + next7.w;
          if (candRight <= maxAllowedRowWidth && minSafeXFromPrev < lastRowItem.x + lastRowItem.width + safeCutGap) {
            pool.splice(matchNext7Idx, 1);
            const placedNext = placeNumberBlock(next7, minSafeXFromPrev, currentY, 0);
            currentX = candRight + safeCutGap;
            if (next7.h > shelfHeight) shelfHeight = next7.h;
            lastRowItem = placedNext;
            continue;
          }
        }
      }

      const block = pool[0];

      // Priority B: Normal sequential placement if pool[0] fits
      if (block.w <= remainingRowSpace || currentX === margin) {
        pool.shift();
        const placed = placeNumberBlock(block, currentX, currentY, 0);
        currentX += block.w + margin;
        if (block.h > shelfHeight) shelfHeight = block.h;
        lastRowItem = placed;
        continue;
      }

      // Priority C: Lookahead Best-Fit — find a narrower intact number/digit in pool
      // (e.g., '1', '4', '7', '8') that fits remainingRowSpace!
      let bestFitIdx = -1;
      let bestFitW = -1;
      for (let i = 1; i < pool.length; i++) {
        const cand = pool[i];
        if (cand.w <= remainingRowSpace && cand.w > bestFitW) {
          bestFitW = cand.w;
          bestFitIdx = i;
        }
      }

      if (bestFitIdx !== -1) {
        const chosen = pool.splice(bestFitIdx, 1)[0];
        const placed = placeNumberBlock(chosen, currentX, currentY, 0);
        currentX += chosen.w + margin;
        if (chosen.h > shelfHeight) shelfHeight = chosen.h;
        lastRowItem = placed;
        continue;
      }

      // Priority D: Smart Unbundle (split a multi-digit number in pool so leading digit fits gap)
      let didSmartUnbundle = false;
      if (digitMode === 'smart_unbundle' && remainingRowSpace >= 1.8) {
        const candIdx = pool.findIndex((c) => {
          if (!c.rawDigits || c.rawDigits.length <= 1) return false;
          const tightFirst = calculateTightTextDimensions(c.rawDigits[0], 'number', c.preset, c.h);
          return tightFirst.widthInches <= remainingRowSpace;
        });

        if (candIdx !== -1) {
          const chosen = pool.splice(candIdx, 1)[0];
          didSmartUnbundle = true;
          const firstDigit = chosen.rawDigits![0];
          const firstTight = calculateTightTextDimensions(firstDigit, 'number', chosen.preset, chosen.h);
          const splitDigitsPlaced: DigitSplitLocation[] = [];

          const d0Id = `${chosen.orderId}-number-d0-${Date.now()}-${zCounter}`;
          const d0Block: UnpackedBlock = {
            ...chosen,
            id: d0Id,
            customerName: `${chosen.customerName} (Digit ${firstDigit})`,
            number: firstDigit,
            w: firstTight.widthInches,
            h: chosen.h,
            isSplitDigit: true,
            digitIndex: 0,
            parentNumber: chosen.number,
            rawDigits: undefined,
          };
          const d0Item = placeNumberBlock(d0Block, currentX, currentY, 0);
          splitDigitsPlaced.push({
            digit: firstDigit,
            itemId: d0Id,
            x: d0Item.x,
            y: d0Item.y,
            width: d0Item.width,
            height: d0Item.height,
            shelfRowIndex: currentRowIndex,
          });

          currentX += firstTight.widthInches + margin;
          if (chosen.h > shelfHeight) shelfHeight = chosen.h;

          // Push remaining digits to front of pool for immediate next-row placement
          const remBlocks: UnpackedBlock[] = [];
          for (let dIdx = 1; dIdx < chosen.rawDigits!.length; dIdx++) {
            const remDigit = chosen.rawDigits![dIdx];
            const remTight = calculateTightTextDimensions(remDigit, 'number', chosen.preset, chosen.h);
            const remId = `${chosen.orderId}-number-d${dIdx}-${Date.now()}-${zCounter + dIdx}`;
            remBlocks.push({
              ...chosen,
              id: remId,
              customerName: `${chosen.customerName} (Digit ${remDigit})`,
              number: remDigit,
              w: remTight.widthInches,
              h: chosen.h,
              isSplitDigit: true,
              digitIndex: dIdx,
              parentNumber: chosen.number,
              rawDigits: undefined,
            });
            splitDigitsPlaced.push({
              digit: remDigit,
              itemId: remId,
              x: 0,
              y: 0,
              width: remTight.widthInches,
              height: chosen.h,
              shelfRowIndex: currentRowIndex + 1,
            });
          }
          pool.unshift(...remBlocks);

          modificationLogs.push({
            id: `log-${chosen.orderId}-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
            orderId: chosen.orderId,
            customerName: chosen.customerName,
            originalNumber: chosen.number,
            reason: candIdx === 0 ? 'shelf_end_fill' : 'smart_pocket_fill',
            entryType: 'number',
            digits: splitDigitsPlaced,
            spaceSavedInches: parseFloat((firstTight.widthInches + margin).toFixed(2)),
            timestamp: new Date().toLocaleTimeString(),
          });

          // Advance to next row after filling end gap
          currentX = margin;
          currentY += shelfHeight + margin;
          shelfHeight = 0;
          currentRowIndex++;
          lastRowItem = null;
        }
      }

      if (!didSmartUnbundle) {
        currentX = margin;
        currentY += shelfHeight + margin;
        shelfHeight = 0;
        currentRowIndex++;
        lastRowItem = null;
      }
    }

    // Check if the last number shelf row left a generous right-side vertical pocket
    // where a fitting curved or straight name (rotated 90°) OR small chest numbers can tuck cleanly
    // (like RONALDO rotated 90° next to 7 7 7 2 4 in reference screenshot)
    if (shelfHeight >= 7.0 && maxAllowedRowWidth - currentX >= 3.5) {
      const pocketX = currentX;
      const pocketY = currentY;
      const pocketW = maxAllowedRowWidth - pocketX;
      const pocketH = shelfHeight;

      // Try fitting a curved name rotated 90° that fits inside this number row end pocket
      const cIdx = curvedTextBlocks.findIndex(
        (cb) => cb.h <= pocketW && cb.w <= pocketH
      );
      if (cIdx !== -1 && !hasBoxOverlap(canvasItems, pocketX, pocketY, curvedTextBlocks[cIdx].h, curvedTextBlocks[cIdx].w, margin * 0.85)) {
        const cb = curvedTextBlocks.splice(cIdx, 1)[0];
        const coords = itemCoordsForAABBTopLeft(pocketX, pocketY, cb.w, cb.h, 90);
        canvasItems.push({
          id: cb.id,
          orderId: cb.orderId,
          itemType: 'name',
          customerName: cb.customerName,
          number: cb.number,
          designCode: cb.designCode,
          preset: cb.preset,
          x: coords.x,
          y: coords.y,
          width: parseFloat(cb.w.toFixed(2)),
          height: parseFloat(cb.h.toFixed(2)),
          letterCapHeightInches: cb.capH,
          rotation: 90,
          zIndex: zCounter++,
          garmentSize: cb.garmentSize,
        });
        currentX += cb.h + margin;
      }
    }

    // Also try filling any leftover horizontal/vertical chest number gaps along number rows if any
    let numMaxY = numberSectionStartY;
    canvasItems.forEach((it) => {
      const b = getRotatedBBox(it.x, it.y, it.width, it.height, it.rotation || 0);
      if (b.y + b.height > numMaxY) numMaxY = b.y + b.height;
    });

    currentX = margin;
    currentY = numMaxY + margin + 0.25;
    shelfHeight = 0;
    currentRowIndex++;
  }

  // ============================================================================
  // 3. IMPROVED ROUND (CURVED) NAME LAYOUT: ARCH CONTOUR VERTICAL NESTING + CENTERED BALANCE
  // ============================================================================
  if (curvedTextBlocks.length > 0) {
    const curvedHorizGap = Math.max(0.10, margin);
    const curvedVertGap = safeCutGap;
    const maxAllowedX = rollWidth - margin;

    interface CurvedRow {
      items: { block: UnpackedBlock; w: number; h: number }[];
      height: number;
      sumW: number;
    }

    // Helper: pack list of curved blocks into rows for a given usable horizontal width
    const packCurvedIntoRows = (blocks: UnpackedBlock[], usableW: number): CurvedRow[] => {
      const remPool = [...blocks];
      const rows: CurvedRow[] = [];

      while (remPool.length > 0) {
        const rowItems: { block: UnpackedBlock; w: number; h: number }[] = [];
        let rowW = 0;
        let rowH = 0;

        const first = remPool.shift()!;
        rowItems.push({ block: first, w: first.w, h: first.h });
        rowW = first.w;
        rowH = first.h;

        while (remPool.length > 0) {
          const remSpace = usableW - rowW - curvedHorizGap;
          if (remSpace <= 0) break;

          if (remPool[0].w <= remSpace) {
            const nxt = remPool.shift()!;
            rowItems.push({ block: nxt, w: nxt.w, h: nxt.h });
            rowW += curvedHorizGap + nxt.w;
            if (nxt.h > rowH) rowH = nxt.h;
          } else {
            const lookIdx = remPool.findIndex((b) => b.w <= remSpace);
            if (lookIdx !== -1) {
              const nxt = remPool.splice(lookIdx, 1)[0];
              rowItems.push({ block: nxt, w: nxt.w, h: nxt.h });
              rowW += curvedHorizGap + nxt.w;
              if (nxt.h > rowH) rowH = nxt.h;
            } else {
              break;
            }
          }
        }

        rows.push({
          items: rowItems,
          height: rowH,
          sumW: rowItems.reduce((s, r) => s + r.w, 0),
        });
      }
      return rows;
    };

    // Helper: simulate arch-nested row Y coordinates and total height
    const computeArchNestedRowLayout = (
      rows: CurvedRow[],
      leftBound: number,
      rightBound: number,
      startY: number
    ) => {
      const placedRecords: { x: number; y: number; w: number; h: number; profile: XColumnSpan[]; rowIndex: number }[] = [];
      const rowPositions: { rowY: number; rowEndX: number; itemXs: number[] }[] = [];
      const usableW = rightBound - leftBound;
      let maxBottom = startY;
      let prevRowY = startY - 0.35;

      rows.forEach((row, rIdx) => {
        const count = row.items.length;
        const slack = Math.max(0, usableW - row.sumW);
        let innerGap = curvedHorizGap;
        if (count > 1) {
          innerGap = Math.min(0.65, Math.max(curvedHorizGap, slack / (count + 1)));
        }
        const groupW = row.sumW + Math.max(0, count - 1) * innerGap;
        const sideSpace = Math.max(0, (usableW - groupW) / 2);

        let px = leftBound + sideSpace;
        const itemXs: number[] = [];
        const candSpecs = row.items.map((entry) => {
          const x = parseFloat(px.toFixed(2));
          itemXs.push(x);
          px += entry.w + innerGap;
          const obbs = getCurvedGlyphOBBs(
            entry.block.customerName,
            entry.block.preset,
            entry.w,
            entry.h,
            entry.block.capH
          );
          const profile = rasterizeCurvedArchYSpanProfile(entry.w, obbs, 48);
          return { x, w: entry.w, h: entry.h, profile };
        });

        const rowY =
          rIdx === 0
            ? startY
            : computeMinNestedCurvedRowY(candSpecs, placedRecords, prevRowY, curvedVertGap, startY);

        candSpecs.forEach((spec) => {
          placedRecords.push({
            x: spec.x,
            y: rowY,
            w: spec.w,
            h: spec.h,
            profile: spec.profile,
            rowIndex: rIdx,
          });
          if (rowY + spec.h > maxBottom) {
            maxBottom = rowY + spec.h;
          }
        });

        prevRowY = rowY;
        rowPositions.push({
          rowY,
          rowEndX: leftBound + sideSpace + groupW,
          itemXs,
        });
      });

      return {
        rowPositions,
        totalHeight: Math.max(0, maxBottom - startY),
        maxBottomY: maxBottom,
      };
    };

    const fullUsableW = rollWidth - 2 * margin;
    const curvedSectionStartY = currentY;
    const baseRows = packCurvedIntoRows(curvedTextBlocks, fullUsableW);
    const baseLayout = computeArchNestedRowLayout(baseRows, margin, maxAllowedX, curvedSectionStartY);

    let bestPlan: {
      mainRows: CurvedRow[];
      mainLayout: ReturnType<typeof computeArchNestedRowLayout>;
      sideItems: UnpackedBlock[];
      sideColStartX: number;
      mainLeftBound: number;
      mainRightBound: number;
      totalHeight: number;
    } | null = null;

    if (curvedTextBlocks.length >= 4) {
      const maxCurvedThick = Math.max(...curvedTextBlocks.map((b) => b.h));
      const candidateColW = maxCurvedThick;
      const sideColStartX = rollWidth - margin - candidateColW;
      const reducedMainW = sideColStartX - curvedHorizGap - margin;

      if (reducedMainW >= 18.0) {
        for (let tailCount = 1; tailCount <= Math.floor(curvedTextBlocks.length / 2); tailCount++) {
          const mainPool = curvedTextBlocks.slice(0, curvedTextBlocks.length - tailCount);
          const sidePool = curvedTextBlocks.slice(curvedTextBlocks.length - tailCount);

          if (mainPool.some((b) => b.w > reducedMainW)) continue;

          const trialRows = packCurvedIntoRows(mainPool, reducedMainW);
          const trialLayout = computeArchNestedRowLayout(
            trialRows,
            margin,
            sideColStartX - curvedHorizGap,
            curvedSectionStartY
          );
          const trialSideH = sidePool.reduce(
            (acc, b, idx) => acc + b.w + (idx > 0 ? curvedHorizGap : 0),
            0
          );

          const effectiveTotalH = Math.max(trialLayout.totalHeight, trialSideH);
          if (effectiveTotalH + 0.5 < baseLayout.totalHeight && (!bestPlan || effectiveTotalH < bestPlan.totalHeight)) {
            bestPlan = {
              mainRows: trialRows,
              mainLayout: trialLayout,
              sideItems: sidePool,
              sideColStartX,
              mainLeftBound: margin,
              mainRightBound: sideColStartX - curvedHorizGap,
              totalHeight: effectiveTotalH,
            };
          }
        }
      }
    }

    const activeRows = bestPlan ? bestPlan.mainRows : baseRows;
    const activeLayout = bestPlan ? bestPlan.mainLayout : baseLayout;

    let lastCurvedRowY = curvedSectionStartY;
    let lastCurvedRowH = 0;
    let lastCurvedRowEndX = bestPlan ? bestPlan.mainLeftBound : margin;

    activeRows.forEach((row, rIdx) => {
      const isLastRow = rIdx === activeRows.length - 1;
      const pos = activeLayout.rowPositions[rIdx];

      row.items.forEach((entry, iIdx) => {
        const px = pos.itemXs[iIdx];
        const itemY = pos.rowY;
        canvasItems.push({
          id: entry.block.id,
          orderId: entry.block.orderId,
          itemType: 'name',
          customerName: entry.block.customerName,
          number: entry.block.number,
          designCode: entry.block.designCode,
          preset: entry.block.preset,
          x: parseFloat(px.toFixed(2)),
          y: parseFloat(itemY.toFixed(2)),
          width: parseFloat(entry.w.toFixed(2)),
          height: parseFloat(entry.h.toFixed(2)),
          letterCapHeightInches: entry.block.capH,
          rotation: 0,
          zIndex: zCounter++,
          garmentSize: entry.block.garmentSize,
        });
      });

      if (isLastRow) {
        lastCurvedRowY = pos.rowY;
        lastCurvedRowH = row.height;
        lastCurvedRowEndX = pos.rowEndX;
      }
    });

    currentY = activeLayout.maxBottomY + curvedVertGap;

    // Place vertical 90°-rotated curved names in right column starting cleanly from curvedSectionStartY
    if (bestPlan && bestPlan.sideItems.length > 0) {
      let sideY = curvedSectionStartY;
      const sideColW = maxAllowedX - bestPlan.sideColStartX;

      bestPlan.sideItems.forEach((sb) => {
        const targetX = bestPlan!.sideColStartX + (sideColW - sb.h) / 2;
        const coords = itemCoordsForAABBTopLeft(targetX, sideY, sb.w, sb.h, 90);
        canvasItems.push({
          id: sb.id,
          orderId: sb.orderId,
          itemType: 'name',
          customerName: sb.customerName,
          number: sb.number,
          designCode: sb.designCode,
          preset: sb.preset,
          x: coords.x,
          y: coords.y,
          width: parseFloat(sb.w.toFixed(2)),
          height: parseFloat(sb.h.toFixed(2)),
          letterCapHeightInches: sb.capH,
          rotation: 90,
          zIndex: zCounter++,
          garmentSize: sb.garmentSize,
        });
        sideY += sb.w + curvedHorizGap;
      });

      if (sideY > currentY) {
        currentY = sideY;
      }
    }

    // If extra space remains on the right of the last curved row (and there are small chest numbers waiting),
    // tuck fitting chest numbers neatly into that open space if safe
    if (smallChestNumberBlocks.length > 0 && !bestPlan) {
      const availX = lastCurvedRowEndX + curvedHorizGap;
      const availW = maxAllowedX - availX;
      if (availW >= 2.0) {
        let tx = availX;
        for (let i = 0; i < smallChestNumberBlocks.length; ) {
          const cb = smallChestNumberBlocks[i];
          if (cb.w <= maxAllowedX - tx && cb.h <= lastCurvedRowH + 0.5 && !hasBoxOverlap(canvasItems, tx, lastCurvedRowY, cb.w, cb.h, margin * 0.85)) {
            smallChestNumberBlocks.splice(i, 1);
            canvasItems.push({
              id: cb.id,
              orderId: cb.orderId,
              itemType: 'number',
              customerName: cb.customerName,
              number: cb.number,
              designCode: cb.designCode,
              preset: cb.preset,
              x: parseFloat(tx.toFixed(2)),
              y: parseFloat(lastCurvedRowY.toFixed(2)),
              width: parseFloat(cb.w.toFixed(2)),
              height: parseFloat(cb.h.toFixed(2)),
              rotation: 0,
              zIndex: zCounter++,
              garmentSize: cb.garmentSize,
              isChestNumber: true,
              parentNumber: cb.parentNumber,
            });
            tx += cb.w + margin;
          } else {
            i++;
          }
        }
      }
    }

    currentX = margin;
    currentY += 0.15;
    shelfHeight = 0;
    currentRowIndex++;
  }

  // ============================================================================
  // 4. PACK REMAINING SMALL / FRONT CHEST NUMBERS IN DEDICATED BOTTOM ROWS
  // ============================================================================
  if (smallChestNumberBlocks.length > 0) {
    if (currentX > margin || shelfHeight > 0) {
      currentX = margin;
      currentY += shelfHeight + margin + 0.25;
      shelfHeight = 0;
      currentRowIndex++;
    }

    const pool = [...smallChestNumberBlocks];
    const chestGap = Math.max(margin, 0.20);

    while (pool.length > 0) {
      const rem = rollWidth - margin - currentX;
      let block = pool[0];

      if (block.w > rem && currentX > margin) {
        const fitIdx = pool.findIndex((c) => c.w <= rem);
        if (fitIdx !== -1) {
          block = pool.splice(fitIdx, 1)[0];
        } else {
          currentX = margin;
          currentY += shelfHeight + chestGap;
          shelfHeight = 0;
          currentRowIndex++;
          block = pool.shift()!;
        }
      } else {
        pool.shift();
      }

      canvasItems.push({
        id: block.id,
        orderId: block.orderId,
        itemType: block.itemType,
        customerName: block.customerName,
        number: block.number,
        designCode: block.designCode,
        preset: block.preset,
        x: parseFloat(currentX.toFixed(2)),
        y: parseFloat(currentY.toFixed(2)),
        width: parseFloat(block.w.toFixed(2)),
        height: parseFloat(block.h.toFixed(2)),
        rotation: 0,
        zIndex: zCounter++,
        garmentSize: block.garmentSize,
        isChestNumber: true,
        parentNumber: block.parentNumber,
      });

      currentX += block.w + chestGap;
      if (block.h > shelfHeight) {
        shelfHeight = block.h;
      }
    }
  }

  // Compute exact true roll bottom from rotated bounding boxes
  let maxBottomY = currentY + shelfHeight;
  canvasItems.forEach((it) => {
    const b = getRotatedBBox(it.x, it.y, it.width, it.height, it.rotation || 0);
    if (b.y + b.height > maxBottomY) {
      maxBottomY = b.y + b.height;
    }
  });
  const totalRollHeight = Math.max(12.0, maxBottomY + margin);

  // Sync final item coordinates back into modificationLogs
  modificationLogs.forEach((log) => {
    log.digits.forEach((d) => {
      const it = canvasItems.find((ci) => ci.id === d.itemId);
      if (it) {
        d.x = it.x;
        d.y = it.y;
        d.width = it.width;
        d.height = it.height;
      }
    });
  });

  // Calculate Roll Metrics
  let totalUsedArea = 0;
  canvasItems.forEach((it) => {
    totalUsedArea += it.width * it.height;
  });

  const totalCapacityArea = rollWidth * totalRollHeight;
  const efficiencyPercentage = Math.min(
    100,
    parseFloat(((totalUsedArea / (totalCapacityArea || 1)) * 100).toFixed(1))
  );
  const wastePercentage = parseFloat((100 - efficiencyPercentage).toFixed(1));

  const estimatedPrintTimeMinutes = Math.ceil(totalRollHeight / 12.5);
  const estimatedFilmCostUSD = parseFloat((totalRollHeight * 0.18).toFixed(2));

  const namesCount = canvasItems.filter((i) => i.itemType === 'name').length;
  const numbersCount = canvasItems.filter((i) => i.itemType === 'number').length;

  const totalSpaceSaved = modificationLogs.reduce((acc, l) => acc + (l.spaceSavedInches || 0), 0);

  return {
    items: canvasItems,
    modificationLogs,
    metrics: {
      totalRollLengthInches: parseFloat(totalRollHeight.toFixed(2)),
      totalRollLengthMeters: parseFloat((totalRollHeight * 0.0254).toFixed(2)),
      usedAreaSquareInches: parseFloat(totalUsedArea.toFixed(1)),
      totalCapacitySquareInches: parseFloat(totalCapacityArea.toFixed(1)),
      wastePercentage,
      efficiencyPercentage,
      totalNamesCount: namesCount,
      totalNumbersCount: numbersCount,
      totalOrdersCount: orders.length,
      estimatedPrintTimeMinutes,
      estimatedFilmCostUSD,
      totalUnbundledDigitsCount: modificationLogs.length,
      totalSpaceSavedInches: parseFloat(totalSpaceSaved.toFixed(2)),
    },
  };
}

/**
 * Detect Collision between canvas items using full rotated AABBs and exact 2D contour/OBB
 * checking for 180°-interlocked '7' pairs, 180°-interlocked A' pairs, and arch-nested round names.
 */
export function checkCollisions(
  items: CanvasItem[],
  _margin: number
): Map<string, boolean> {
  const collisions = new Map<string, boolean>();

  for (let i = 0; i < items.length; i++) {
    const a = items[i];
    const bA = getRotatedBBox(a.x, a.y, a.width, a.height, a.rotation || 0);

    for (let j = i + 1; j < items.length; j++) {
      const b = items[j];
      const bB = getRotatedBBox(b.x, b.y, b.width, b.height, b.rotation || 0);

      const overlapX = bA.x < bB.x + bB.width && bA.x + bA.width > bB.x;
      const overlapY = bA.y < bB.y + bB.height && bA.y + bA.height > bB.y;

      if (overlapX && overlapY) {
        const rotA = ((a.rotation || 0) % 360 + 360) % 360;
        const rotB = ((b.rotation || 0) % 360 + 360) % 360;

        // 1. 180°-interlocked '7' pair contour clearance check
        const isOpposite7Pair =
          a.itemType === 'number' &&
          b.itemType === 'number' &&
          a.number === '7' &&
          b.number === '7' &&
          ((rotA === 0 && rotB === 180) || (rotA === 180 && rotB === 0));

        if (isOpposite7Pair) {
          const profA = getDigitHorizontalProfile('7', a.preset, bA.width / Math.max(0.5, bA.height));
          const profB = getDigitHorizontalProfile('7', b.preset, bB.width / Math.max(0.5, bB.height));
          if (!hasProfile2DCollision(profA, bA.x, bA.y, bA.width, bA.height, rotA, profB, bB.x, bB.y, bB.width, bB.height, rotB, 0.03)) {
            continue;
          }
        }

        // 2. 180°-interlocked A' pair contour clearance check
        const isOppositeApPair =
          a.itemType === 'name' &&
          b.itemType === 'name' &&
          isApName(a.customerName) &&
          isApName(b.customerName) &&
          ((rotA === 0 && rotB === 180) || (rotA === 180 && rotB === 0));

        if (isOppositeApPair) {
          const profA = getNameHorizontalProfile(a.customerName, a.preset, bA.width, bA.height);
          const profB = getNameHorizontalProfile(b.customerName, b.preset, bB.width, bB.height);
          if (!hasProfile2DCollision(profA, bA.x, bA.y, bA.width, bA.height, rotA, profB, bB.x, bB.y, bB.width, bB.height, rotB, 0.03)) {
            continue;
          }
        }

        // 3. Arch-nested curved round names (exact oriented glyph SAT check)
        const isCurvedNamePair =
          a.itemType === 'name' &&
          b.itemType === 'name' &&
          rotA === 0 &&
          rotB === 0 &&
          isPresetCurved(a.preset) &&
          isPresetCurved(b.preset);

        if (isCurvedNamePair) {
          if (!doCurvedItemsCollide(a, b, 0.02)) {
            continue;
          }
        }

        collisions.set(a.id, true);
        collisions.set(b.id, true);
      }
    }
  }

  return collisions;
}
