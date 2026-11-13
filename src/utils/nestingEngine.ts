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
import {
  calculateTightTextDimensions,
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

const PROFILE_SLICES = 24;
const digitProfileCache = new Map<string, HorizontalSpan[]>();

/**
 * Returns a 24-slice vertical profile of horizontal ink occupancy (normalized 0..1)
 * for a single digit ('7', etc.), reading real pixel silhouettes when available and
 * falling back to conservative athletic jersey geometry otherwise.
 */
function getDigitHorizontalProfile(digit: string, preset: any): HorizontalSpan[] {
  const assetUrl = preset?.numberAssets?.[digit] || '';
  const fontFamily = preset?.numberStyle?.fontFamily || preset?.fontFamily || 'Oswald';
  const strokeWidth = preset?.numberStyle?.strokeWidth ?? preset?.strokeWidth ?? 0;
  const cacheKey = `${digit}|${assetUrl ? assetUrl.slice(0, 80) : fontFamily}|${strokeWidth}`;

  const cached = digitProfileCache.get(cacheKey);
  if (cached) return cached;

  // Attempt pixel-exact scan if running in browser
  if (typeof document !== 'undefined') {
    const W = 64;
    const H = 128;
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
        const fontSize = H * 0.92;
        ctx.font = `900 ${fontSize}px "${fontFamily}", "Bebas Neue", "Oswald", sans-serif`;
        if (strokeWidth > 0) {
          ctx.lineWidth = Math.max(1, (strokeWidth / 10) * 3);
          ctx.strokeStyle = '#ffffff';
          ctx.strokeText(digit, W / 2, H / 2);
        }
        ctx.fillStyle = '#ffffff';
        ctx.fillText(digit, W / 2, H / 2);
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
                if (alpha > 20) {
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

          if (nonEmptyCount >= 8) {
            digitProfileCache.set(cacheKey, slices);
            return slices;
          }
        } catch (_) {
          // Cross-origin image tainted canvas; fall back to geometric profile
        }
      }
    }
  }

  // Geometric athletic jersey '7' silhouette (conservative safe envelope)
  const fallback: HorizontalSpan[] = [];
  for (let s = 0; s < PROFILE_SLICES; s++) {
    const t = (s + 0.5) / PROFILE_SLICES;
    if (digit === '7') {
      if (t <= 0.25) {
        fallback.push({ xMinFrac: 0.0, xMaxFrac: 1.0 });
      } else {
        const p = (t - 0.25) / 0.75;
        const xMinFrac = Math.max(0.0, 0.50 * (1 - p) - 0.02);
        const xMaxFrac = Math.min(1.0, 0.98 - 0.52 * p + 0.02);
        fallback.push({ xMinFrac, xMaxFrac });
      }
    } else {
      fallback.push({ xMinFrac: 0.0, xMaxFrac: 1.0 });
    }
  }

  digitProfileCache.set(cacheKey, fallback);
  return fallback;
}

/**
 * Evaluates horizontal occupied interval [leftX, rightX] of digit item at normalized global Y slice
 * accounting for 0° vs 180° orientation.
 */
function getItemSliceXSpan(
  bboxX: number,
  bboxY: number,
  w: number,
  h: number,
  rotationDeg: number,
  digit: string,
  preset: any,
  queryY: number
): { minX: number; maxX: number } | null {
  if (queryY < bboxY || queryY > bboxY + h) return null;
  const profile = getDigitHorizontalProfile(digit, preset);
  const t = Math.max(0, Math.min(0.9999, (queryY - bboxY) / Math.max(0.01, h)));
  const normRot = ((rotationDeg % 360) + 360) % 360;

  if (normRot === 180) {
    const idx = PROFILE_SLICES - 1 - Math.floor(t * PROFILE_SLICES);
    const span = profile[Math.max(0, Math.min(PROFILE_SLICES - 1, idx))];
    if (span.empty) return null;
    return {
      minX: bboxX + (1 - span.xMaxFrac) * w,
      maxX: bboxX + (1 - span.xMinFrac) * w,
    };
  }

  const idx = Math.floor(t * PROFILE_SLICES);
  const span = profile[Math.max(0, Math.min(PROFILE_SLICES - 1, idx))];
  if (span.empty) return null;
  return {
    minX: bboxX + span.xMinFrac * w,
    maxX: bboxX + span.xMaxFrac * w,
  };
}

/**
 * Computes minimum safe X offset (dx) to place item B ('7' at rotB) to the right of item A ('7' at rotA)
 * while maintaining full ink + cut clearance across all vertical slices.
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
  margin: number
): number {
  const safeGap = Math.max(margin * 1.25, 0.22);
  let requiredDx = 0.50 * aW + safeGap;

  for (let s = 0; s < PROFILE_SLICES; s++) {
    const queryY = ((s + 0.5) / PROFILE_SLICES) * aH;
    const spanA = getItemSliceXSpan(0, 0, aW, aH, aRot, '7', aPreset, queryY);
    const spanB = getItemSliceXSpan(0, yOffsetBRelativeToA, bW, bH, bRot, '7', bPreset, queryY);
    if (spanA && spanB) {
      const needed = spanA.maxX - spanB.minX + safeGap;
      if (needed > requiredDx) requiredDx = needed;
    }
  }

  // Also sample B's slices near corners
  for (let s = 0; s < PROFILE_SLICES; s++) {
    const queryY = yOffsetBRelativeToA + ((s + 0.5) / PROFILE_SLICES) * bH;
    const spanA = getItemSliceXSpan(0, 0, aW, aH, aRot, '7', aPreset, queryY);
    const spanB = getItemSliceXSpan(0, yOffsetBRelativeToA, bW, bH, bRot, '7', bPreset, queryY);
    if (spanA && spanB) {
      const needed = spanA.maxX - spanB.minX + safeGap;
      if (needed > requiredDx) requiredDx = needed;
    }
  }

  return parseFloat(Math.min(aW + margin, requiredDx).toFixed(2));
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
  // Minimal safe cutting gap: minimum 0.12" (recommended 0.20"-0.25" / ~5mm)
  const margin = Math.max(0.12, settings.marginInches ?? 0.20);
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

    while (pool.length > 0) {
      const rem = maxAllowedX - currentX;
      const head = pool[0];

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

      // Priority A: If previous item on this row is an upright un-paired '7', check if we can
      // interlock a 180°-rotated '7' from pool right beside it along its diagonal contour!
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
            margin
          );

          const candRightEdge = lastRowItem.x + dx + cand7.w;
          if (candRightEdge <= maxAllowedRowWidth && dx < lastRowItem.width + margin) {
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

            currentX = candRightEdge + margin;
            if (cand7.h > shelfHeight) shelfHeight = cand7.h;
            lastRowItem = placedInv;
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
  // 3. IMPROVED ROUND (CURVED) NAME LAYOUT: BALANCED, CENTERED & RIGHT-COLUMN POCKETS
  // ============================================================================
  if (curvedTextBlocks.length > 0) {
    const curvedGap = Math.max(margin, 0.25);
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

        // First item always goes on the row
        const first = remPool.shift()!;
        rowItems.push({ block: first, w: first.w, h: first.h });
        rowW = first.w;
        rowH = first.h;

        // Greedily fill remaining row width with lookahead for shorter fitting curved names
        while (remPool.length > 0) {
          const remSpace = usableW - rowW - curvedGap;
          if (remSpace <= 0) break;

          if (remPool[0].w <= remSpace) {
            const nxt = remPool.shift()!;
            rowItems.push({ block: nxt, w: nxt.w, h: nxt.h });
            rowW += curvedGap + nxt.w;
            if (nxt.h > rowH) rowH = nxt.h;
          } else {
            const lookIdx = remPool.findIndex((b) => b.w <= remSpace);
            if (lookIdx !== -1) {
              const nxt = remPool.splice(lookIdx, 1)[0];
              rowItems.push({ block: nxt, w: nxt.w, h: nxt.h });
              rowW += curvedGap + nxt.w;
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

    const fullUsableW = rollWidth - 2 * margin;
    const baseRows = packCurvedIntoRows(curvedTextBlocks, fullUsableW);

    // Check if dedicating a narrow right-side 90° vertical column (like ALIF/SUNNY/ARAB/AIMIN/GERRARD
    // or NAYEEM in screenshots) reduces overall curved section height without squeezing rows!
    let bestPlan: {
      mainRows: CurvedRow[];
      sideItems: UnpackedBlock[];
      sideColStartX: number;
      mainLeftBound: number;
      mainRightBound: number;
      totalHeight: number;
    } | null = null;

    const baseTotalH = baseRows.reduce((acc, r, idx) => acc + r.height + (idx > 0 ? curvedGap : 0), 0);

    // Evaluate vertical right-column candidate if we have >= 4 curved names
    if (curvedTextBlocks.length >= 4) {
      const maxCurvedThick = Math.max(...curvedTextBlocks.map((b) => b.h));
      const candidateColW = maxCurvedThick;
      const sideColStartX = rollWidth - margin - candidateColW;
      const reducedMainW = sideColStartX - curvedGap - margin;

      if (reducedMainW >= 18.0) {
        // Test splitting k tail items (1..floor(N/2)) into the vertical right column
        for (let tailCount = 1; tailCount <= Math.floor(curvedTextBlocks.length / 2); tailCount++) {
          const mainPool = curvedTextBlocks.slice(0, curvedTextBlocks.length - tailCount);
          const sidePool = curvedTextBlocks.slice(curvedTextBlocks.length - tailCount);

          // Ensure every mainPool item can fit inside reducedMainW
          if (mainPool.some((b) => b.w > reducedMainW)) continue;

          const trialRows = packCurvedIntoRows(mainPool, reducedMainW);
          const trialMainH = trialRows.reduce(
            (acc, r, idx) => acc + r.height + (idx > 0 ? curvedGap : 0),
            0
          );
          const trialSideH = sidePool.reduce(
            (acc, b, idx) => acc + b.w + (idx > 0 ? curvedGap : 0),
            0
          );

          // Only use side column if the side items stack completely within (or tightly match) main rows height
          // AND total curved section height is meaningfully smaller than baseTotalH
          const effectiveTotalH = Math.max(trialMainH, trialSideH);
          if (effectiveTotalH + 0.5 < baseTotalH && (!bestPlan || effectiveTotalH < bestPlan.totalHeight)) {
            bestPlan = {
              mainRows: trialRows,
              sideItems: sidePool,
              sideColStartX,
              mainLeftBound: margin,
              mainRightBound: sideColStartX - curvedGap,
              totalHeight: effectiveTotalH,
            };
          }
        }
      }
    }

    const activeRows = bestPlan ? bestPlan.mainRows : baseRows;
    const activeLeftBound = bestPlan ? bestPlan.mainLeftBound : margin;
    const activeRightBound = bestPlan ? bestPlan.mainRightBound : maxAllowedX;

    // Track last row geometry in case extra designs (e.g. chest numbers / remaining items) fit
    let lastCurvedRowY = currentY;
    let lastCurvedRowH = 0;
    let lastCurvedRowEndX = activeLeftBound;

    activeRows.forEach((row, rIdx) => {
      const isLastRow = rIdx === activeRows.length - 1;
      const usableW = activeRightBound - activeLeftBound;
      const count = row.items.length;
      const slack = Math.max(0, usableW - row.sumW);

      // Compute symmetric balanced spacing on both sides
      let innerGap = curvedGap;
      if (count > 1) {
        innerGap = Math.min(0.80, Math.max(curvedGap, slack / (count + 1)));
      }
      const groupW = row.sumW + Math.max(0, count - 1) * innerGap;
      const sideSpace = Math.max(0, (usableW - groupW) / 2);

      let px = activeLeftBound + sideSpace;

      row.items.forEach((entry) => {
        // Vertically center items of slightly varying curvature inside their row
        const itemY = currentY + (row.height - entry.h) / 2;
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
        px += entry.w + innerGap;
      });

      if (isLastRow) {
        lastCurvedRowY = currentY;
        lastCurvedRowH = row.height;
        lastCurvedRowEndX = activeLeftBound + sideSpace + groupW;
      }

      currentY += row.height + curvedGap;
    });

    // Place vertical 90°-rotated curved names in right column (balanced vertically)
    if (bestPlan && bestPlan.sideItems.length > 0) {
      let sideY = currentY - activeRows.reduce((a, r) => a + r.height + curvedGap, 0);
      const sideColW = maxAllowedX - bestPlan.sideColStartX;

      bestPlan.sideItems.forEach((sb) => {
        // Center horizontally inside the dedicated right column
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
        sideY += sb.w + curvedGap;
      });

      if (sideY > currentY) {
        currentY = sideY;
      }
    }

    // If extra space remains on the right of the last curved row (and there are small chest numbers waiting),
    // tuck fitting chest numbers neatly into that open space if safe
    if (smallChestNumberBlocks.length > 0 && !bestPlan) {
      const availX = lastCurvedRowEndX + curvedGap;
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
 * Detect Collision between canvas items using full rotated AABBs and contour-aware
 * silhouette checking for 180°-interlocked '7' pairs.
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
        // Check if pair is an opposite-oriented (0° vs 180°) '7' diagonal interlock
        const rotA = ((a.rotation || 0) % 360 + 360) % 360;
        const rotB = ((b.rotation || 0) % 360 + 360) % 360;
        const isOpposite7Pair =
          a.itemType === 'number' &&
          b.itemType === 'number' &&
          a.number === '7' &&
          b.number === '7' &&
          ((rotA === 0 && rotB === 180) || (rotA === 180 && rotB === 0));

        if (isOpposite7Pair) {
          const minY = Math.max(bA.y, bB.y);
          const maxY = Math.min(bA.y + bA.height, bB.y + bB.height);
          let realInkCollision = false;

          if (maxY > minY) {
            const steps = 20;
            for (let s = 0; s < steps; s++) {
              const qY = minY + ((s + 0.5) / steps) * (maxY - minY);
              const sA = getItemSliceXSpan(bA.x, bA.y, bA.width, bA.height, rotA, '7', a.preset, qY);
              const sB = getItemSliceXSpan(bB.x, bB.y, bB.width, bB.height, rotB, '7', b.preset, qY);
              if (sA && sB && sA.minX < sB.maxX - 0.02 && sA.maxX > sB.minX + 0.02) {
                realInkCollision = true;
                break;
              }
            }
          }

          if (!realInkCollision) {
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
