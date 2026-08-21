import {
  CanvasItem,
  LayoutSettings,
  OrderItem,
  RollMetrics,
} from '../types';
import { calculateTightTextDimensions } from './textMeasurement';

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
        status: matched ? 'matched' : 'unmatched_code',
        errorMessage: matched ? undefined : `Design code "${rawDesignCode}" not found in database.`,
      });
    }
  });

  return items;
}

/**
 * 2D Shelf/Bin Auto-Nesting Algorithm for 39" DTF Roll
 */
export function generateAutoNestingLayout(
  orders: OrderItem[],
  settings: LayoutSettings
): { items: CanvasItem[]; metrics: RollMetrics } {
  const rollWidth = settings.rollWidthInches || 39.0;
  // Minimal safe cutting gap: 0.10" (~2.5mm / 1-2mm)
  const margin = settings.marginInches ?? 0.10;
  const canvasItems: CanvasItem[] = [];

  // Step 1: Unroll OrderItems into individual name and number blocks
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
    garmentSize: any;
  }

  const rawBlocks: UnpackedBlock[] = [];

  orders.forEach((ord) => {
    if (!ord.matchedPreset) return;

    // Add Name block if customerName exists
    if (ord.customerName) {
      rawBlocks.push({
        id: `${ord.id}-name`,
        orderId: ord.id,
        itemType: 'name',
        customerName: ord.customerName,
        number: ord.number,
        designCode: ord.designCode,
        preset: ord.matchedPreset,
        w: ord.nameWidthInches,
        h: ord.nameHeightInches,
        garmentSize: ord.garmentSize,
      });
    }

    // Add Number block if number exists
    if (ord.number) {
      rawBlocks.push({
        id: `${ord.id}-number`,
        orderId: ord.id,
        itemType: 'number',
        customerName: ord.customerName,
        number: ord.number,
        designCode: ord.designCode,
        preset: ord.matchedPreset,
        w: ord.numberWidthInches,
        h: ord.numberHeightInches,
        garmentSize: ord.garmentSize,
      });
    }
  });

  const packingMode = settings.packingMode || 'row_by_row_structured';

  let currentY = margin;
  let currentX = margin;
  let shelfHeight = 0;
  let zCounter = 1;

  const packBlocksList = (blocks: UnpackedBlock[]) => {
    const pool = [...blocks];

    while (pool.length > 0) {
      let blockIdx = 0;
      let block = pool[blockIdx];

      let itemW = block.w;
      let itemH = block.h;

      // Check if block fits in current row with Smart Packing Buffer & Margin Tolerance
      const overflow = currentX + itemW + margin - rollWidth;
      const TOLERANCE_WINDOW = 2.8; // Smart packing buffer (2.8" margin tolerance window)

      if (overflow > 0) {
        let fitInRow = false;

        // If overflow is within tolerance window, keep item in current row to prevent awkward line breaks
        if (overflow <= TOLERANCE_WINDOW) {
          fitInRow = true;
        } else {
          // Attempt to fill remaining right edge gap with any smaller/shorter candidate in pool
          let bestCandidateIdx = -1;
          const remainingSpace = rollWidth - currentX - margin;

          if (remainingSpace > 0.4) {
            for (let i = 0; i < pool.length; i++) {
              const candidate = pool[i];
              if (candidate.w + margin <= remainingSpace + TOLERANCE_WINDOW) {
                if (shelfHeight === 0 || candidate.h <= shelfHeight + 0.5) {
                  bestCandidateIdx = i;
                  break;
                } else if (bestCandidateIdx === -1) {
                  bestCandidateIdx = i;
                }
              }
            }
          }

          if (bestCandidateIdx !== -1) {
            blockIdx = bestCandidateIdx;
            block = pool[blockIdx];
            itemW = block.w;
            itemH = block.h;
            fitInRow = true;
          }
        }

        if (!fitInRow) {
          // Wrap cleanly to next shelf row down
          currentX = margin;
          currentY += shelfHeight + margin;
          shelfHeight = 0;
        }
      }

      // Remove chosen block from pool
      pool.splice(blockIdx, 1);

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
      });

      currentX += itemW + margin;
      if (itemH > shelfHeight) {
        shelfHeight = itemH;
      }
    }
  };

  if (
    packingMode === 'row_by_row_structured' ||
    packingMode === 'separate_names_and_numbers'
  ) {
    // 1. Pack ALL Names first in horizontal structured rows
    const nameBlocks = rawBlocks.filter((b) => b.itemType === 'name');
    packBlocksList(nameBlocks);

    // Advance Y to start Numbers section with a clean horizontal separation line
    if (nameBlocks.length > 0) {
      currentX = margin;
      currentY += shelfHeight + margin + 0.15;
      shelfHeight = 0;
    }

    // 2. Pack ALL Numbers in horizontal structured rows
    const numberBlocks = rawBlocks.filter((b) => b.itemType === 'number');
    packBlocksList(numberBlocks);
  } else {
    // Paired / Compact / Rotated mode
    if (settings.nestingStrategy === 'compact' || settings.nestingStrategy === 'rotated_max_density') {
      rawBlocks.sort((a, b) => b.h - a.h || b.w - a.w);
    } else if (settings.nestingStrategy === 'grouped_by_order') {
      rawBlocks.sort((a, b) => a.orderId.localeCompare(b.orderId));
    }
    packBlocksList(rawBlocks);
  }

  const totalRollHeight = Math.max(12.0, currentY + shelfHeight + margin);

  // Calculate Roll Metrics
  let totalUsedArea = 0;
  canvasItems.forEach((it) => {
    totalUsedArea += it.width * it.height;
  });

  const totalCapacityArea = rollWidth * totalRollHeight;
  const wasteArea = Math.max(0, totalCapacityArea - totalUsedArea);
  const efficiencyPercentage = Math.min(
    100,
    parseFloat(((totalUsedArea / (totalCapacityArea || 1)) * 100).toFixed(1))
  );
  const wastePercentage = parseFloat((100 - efficiencyPercentage).toFixed(1));

  // Print speed estimate: approx 15 inches per minute for DTF roll printer
  const estimatedPrintTimeMinutes = Math.ceil(totalRollHeight / 12.5);
  // Film cost estimate: approx $0.15 per linear inch of 39" DTF film
  const estimatedFilmCostUSD = parseFloat((totalRollHeight * 0.18).toFixed(2));

  const namesCount = canvasItems.filter((i) => i.itemType === 'name').length;
  const numbersCount = canvasItems.filter((i) => i.itemType === 'number').length;

  return {
    items: canvasItems,
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
    },
  };
}

/**
 * Detect Collision between canvas items considering safe margin
 */
export function checkCollisions(
  items: CanvasItem[],
  margin: number
): Map<string, boolean> {
  const collisions = new Map<string, boolean>();

  for (let i = 0; i < items.length; i++) {
    const a = items[i];
    const aRot = a.rotation === 90;
    const aW = aRot ? a.height : a.width;
    const aH = aRot ? a.width : a.height;

    for (let j = i + 1; j < items.length; j++) {
      const b = items[j];
      const bRot = b.rotation === 90;
      const bW = bRot ? b.height : b.width;
      const bH = bRot ? b.width : b.height;

      // Check overlap (ignoring margin or using margin threshold)
      const overlapX = a.x < b.x + bW && a.x + aW > b.x;
      const overlapY = a.y < b.y + bH && a.y + aH > b.y;

      if (overlapX && overlapY) {
        collisions.set(a.id, true);
        collisions.set(b.id, true);
      }
    }
  }

  return collisions;
}
