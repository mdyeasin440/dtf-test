import {
  CanvasItem,
  DigitNestingMode,
  DigitSplitLocation,
  DigitSplitLogEntry,
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

export interface AutoNestingResult {
  items: CanvasItem[];
  metrics: RollMetrics;
  modificationLogs: DigitSplitLogEntry[];
}

/**
 * 2D Shelf/Bin Auto-Nesting Algorithm for 39" DTF Roll with Smart Digit Unbundling & Void Scanning
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
  const digitMode: DigitNestingMode = settings.digitNestingMode || (settings.splitDigitsForNesting ? 'smart_unbundle' : 'smart_unbundle');

  // Step 1: Unroll OrderItems into individual categorized blocks
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
    rawDigits?: string[]; // Array of single digits if multi-digit
    digitIndex?: number;
    isSplitDigit?: boolean;
    parentNumber?: string;
    isCurvedText?: boolean;
  }

  const isCurvedPreset = (preset: any): boolean => {
    if (!preset) return false;
    return Boolean(preset.curvedTextArch || preset.enableArcPath || preset.textEffect === 'arc');
  };

  const straightNameBlocks: UnpackedBlock[] = [];
  const curvedTextBlocks: UnpackedBlock[] = [];
  const numberBlocks: UnpackedBlock[] = [];

  orders.forEach((ord) => {
    if (!ord.matchedPreset) return;

    // Scale defaults based on garment size
    let scale = 1.0;
    if (ord.garmentSize === 'Youth') scale = 0.8;
    if (ord.garmentSize === 'Infant') scale = 0.65;

    const isCurved = isCurvedPreset(ord.matchedPreset);

    // Add Name block if customerName exists
    if (ord.customerName) {
      const presetNameHeight = ord.matchedPreset?.defaultNameHeightInches || 2.2;
      const nameHeight = presetNameHeight * scale;
      const tightName = calculateTightTextDimensions(ord.customerName, 'name', ord.matchedPreset, nameHeight);

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
        garmentSize: ord.garmentSize,
        isCurvedText: isCurved,
      };

      if (isCurved) {
        curvedTextBlocks.push(block);
      } else {
        straightNameBlocks.push(block);
      }
    }

    // Add Number block if number exists
    if (ord.number) {
      const presetNumHeight = ord.matchedPreset?.defaultNumberHeightInches || 9.5;
      const numHeight = presetNumHeight * scale;
      const cleanDigits = ord.number.trim().split('');

      // Double-digit numbers unbundling
      if (cleanDigits.length > 1) {
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

        // Record split log for user tracking
        modificationLogs.push({
          id: `log-${ord.id}-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
          orderId: ord.id,
          customerName: ord.customerName,
          originalNumber: ord.number,
          reason: 'gap_optimization',
          digits: cleanDigits.map((d, i) => ({
            digit: d,
            itemId: `${ord.id}-number-d${i}`,
            x: 0,
            y: 0,
            width: calculateTightTextDimensions(d, 'number', ord.matchedPreset, numHeight).widthInches,
            height: numHeight,
            shelfRowIndex: 1,
          })),
          spaceSavedInches: parseFloat((tightNumWidth(ord.number, ord.matchedPreset, numHeight) * 0.35).toFixed(2)),
          timestamp: new Date().toLocaleTimeString(),
        });
      } else {
        // Single digit number
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
        });
      }
    }
  });

  function tightNumWidth(numStr: string, preset: any, h: number): number {
    return calculateTightTextDimensions(numStr, 'number', preset, h).widthInches;
  }

  let currentY = margin;
  let currentX = margin;
  let shelfHeight = 0;
  let zCounter = 1;
  let currentRowIndex = 1;

  // 1. Pack Standard Straight Names First (Row by Row)
  if (straightNameBlocks.length > 0) {
    const pool = [...straightNameBlocks];
    while (pool.length > 0) {
      const block = pool.shift()!;

      // Check if block exceeds 39" roll edge; wrap to new row cleanly
      if (currentX + block.w > rollWidth - margin && currentX > margin) {
        currentX = margin;
        currentY += shelfHeight + margin;
        shelfHeight = 0;
        currentRowIndex++;
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
      });

      currentX += block.w + margin;
      if (block.h > shelfHeight) {
        shelfHeight = block.h;
      }
    }

    // Advance Y to start Numbers section with a clean horizontal separation buffer
    currentX = margin;
    currentY += shelfHeight + margin + 0.20;
    shelfHeight = 0;
    currentRowIndex++;
  }

  // 2. Pack Standard Numbers with Void Gap Scanning and Dynamic Unbundling
  if (numberBlocks.length > 0) {
    const packNumberBlocks = (blocks: UnpackedBlock[]) => {
      const pool = [...blocks];
      const maxAllowedRowWidth = rollWidth - margin;

      while (pool.length > 0) {
        const block = pool[0];
        const remainingRowSpace = maxAllowedRowWidth - currentX;

        // Check if full block fits in current row shelf
        if (block.w <= remainingRowSpace || currentX === margin) {
          pool.shift();

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

          currentX += block.w + margin;
          if (block.h > shelfHeight) shelfHeight = block.h;
          continue;
        }

        // Block does NOT fit in current row space intact
        // SMART UNBUNDLE CHECK
        let didSmartUnbundle = false;

        if (digitMode === 'smart_unbundle' && remainingRowSpace >= 2.0) {
          if (block.rawDigits && block.rawDigits.length > 1) {
            const firstDigit = block.rawDigits[0];
            const firstDigitTight = calculateTightTextDimensions(firstDigit, 'number', block.preset, block.h);

            if (firstDigitTight.widthInches <= remainingRowSpace) {
              pool.shift();
              didSmartUnbundle = true;

              const splitDigitsPlaced: DigitSplitLocation[] = [];

              // Place first digit in the remaining row pocket
              const d1Id = `${block.orderId}-number-d0-${Date.now()}`;
              const d1Item: CanvasItem = {
                id: d1Id,
                orderId: block.orderId,
                itemType: 'number',
                customerName: `${block.customerName} (Digit ${firstDigit})`,
                number: firstDigit,
                designCode: block.designCode,
                preset: block.preset,
                x: parseFloat(currentX.toFixed(2)),
                y: parseFloat(currentY.toFixed(2)),
                width: parseFloat(firstDigitTight.widthInches.toFixed(2)),
                height: parseFloat(block.h.toFixed(2)),
                rotation: 0,
                zIndex: zCounter++,
                garmentSize: block.garmentSize,
              };
              canvasItems.push(d1Item);
              splitDigitsPlaced.push({
                digit: firstDigit,
                itemId: d1Id,
                x: d1Item.x,
                y: d1Item.y,
                width: d1Item.width,
                height: d1Item.height,
                shelfRowIndex: currentRowIndex,
              });

              currentX += firstDigitTight.widthInches + margin;
              if (block.h > shelfHeight) shelfHeight = block.h;

              // Wrap to next shelf row for the remaining digits
              currentX = margin;
              currentY += shelfHeight + margin;
              shelfHeight = 0;
              currentRowIndex++;

              for (let dIdx = 1; dIdx < block.rawDigits.length; dIdx++) {
                const remDigit = block.rawDigits[dIdx];
                const remTight = calculateTightTextDimensions(remDigit, 'number', block.preset, block.h);
                const remId = `${block.orderId}-number-d${dIdx}-${Date.now()}`;

                const remItem: CanvasItem = {
                  id: remId,
                  orderId: block.orderId,
                  itemType: 'number',
                  customerName: `${block.customerName} (Digit ${remDigit})`,
                  number: remDigit,
                  designCode: block.designCode,
                  preset: block.preset,
                  x: parseFloat(currentX.toFixed(2)),
                  y: parseFloat(currentY.toFixed(2)),
                  width: parseFloat(remTight.widthInches.toFixed(2)),
                  height: parseFloat(block.h.toFixed(2)),
                  rotation: 0,
                  zIndex: zCounter++,
                  garmentSize: block.garmentSize,
                };
                canvasItems.push(remItem);
                splitDigitsPlaced.push({
                  digit: remDigit,
                  itemId: remId,
                  x: remItem.x,
                  y: remItem.y,
                  width: remItem.width,
                  height: remItem.height,
                  shelfRowIndex: currentRowIndex,
                });

                currentX += remTight.widthInches + margin;
                if (block.h > shelfHeight) shelfHeight = block.h;
              }

              modificationLogs.push({
                id: `log-${block.orderId}-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
                orderId: block.orderId,
                customerName: block.customerName,
                originalNumber: block.number,
                reason: 'shelf_end_fill',
                digits: splitDigitsPlaced,
                spaceSavedInches: parseFloat((firstDigitTight.widthInches + 0.5).toFixed(2)),
                timestamp: new Date().toLocaleTimeString(),
              });
            }
          }

          if (!didSmartUnbundle) {
            const candidateIdx = pool.findIndex((c) => {
              if (!c.rawDigits || c.rawDigits.length <= 1) return false;
              const tightFirst = calculateTightTextDimensions(c.rawDigits[0], 'number', c.preset, c.h);
              return tightFirst.widthInches <= remainingRowSpace;
            });

            if (candidateIdx !== -1) {
              const chosen = pool.splice(candidateIdx, 1)[0];
              didSmartUnbundle = true;

              const firstDigit = chosen.rawDigits![0];
              const firstDigitTight = calculateTightTextDimensions(firstDigit, 'number', chosen.preset, chosen.h);
              const splitDigitsPlaced: DigitSplitLocation[] = [];

              const d1Id = `${chosen.orderId}-number-d0-${Date.now()}`;
              const d1Item: CanvasItem = {
                id: d1Id,
                orderId: chosen.orderId,
                itemType: 'number',
                customerName: `${chosen.customerName} (Digit ${firstDigit})`,
                number: firstDigit,
                designCode: chosen.designCode,
                preset: chosen.preset,
                x: parseFloat(currentX.toFixed(2)),
                y: parseFloat(currentY.toFixed(2)),
                width: parseFloat(firstDigitTight.widthInches.toFixed(2)),
                height: parseFloat(chosen.h.toFixed(2)),
                rotation: 0,
                zIndex: zCounter++,
                garmentSize: chosen.garmentSize,
              };
              canvasItems.push(d1Item);
              splitDigitsPlaced.push({
                digit: firstDigit,
                itemId: d1Id,
                x: d1Item.x,
                y: d1Item.y,
                width: d1Item.width,
                height: d1Item.height,
                shelfRowIndex: currentRowIndex,
              });

              currentX += firstDigitTight.widthInches + margin;
              if (chosen.h > shelfHeight) shelfHeight = chosen.h;

              currentX = margin;
              currentY += shelfHeight + margin;
              shelfHeight = 0;
              currentRowIndex++;

              for (let dIdx = 1; dIdx < chosen.rawDigits!.length; dIdx++) {
                const remDigit = chosen.rawDigits![dIdx];
                const remTight = calculateTightTextDimensions(remDigit, 'number', chosen.preset, chosen.h);
                const remId = `${chosen.orderId}-number-d${dIdx}-${Date.now()}`;

                const remItem: CanvasItem = {
                  id: remId,
                  orderId: chosen.orderId,
                  itemType: 'number',
                  customerName: `${chosen.customerName} (Digit ${remDigit})`,
                  number: remDigit,
                  designCode: chosen.designCode,
                  preset: chosen.preset,
                  x: parseFloat(currentX.toFixed(2)),
                  y: parseFloat(currentY.toFixed(2)),
                  width: parseFloat(remTight.widthInches.toFixed(2)),
                  height: parseFloat(chosen.h.toFixed(2)),
                  rotation: 0,
                  zIndex: zCounter++,
                  garmentSize: chosen.garmentSize,
                };
                canvasItems.push(remItem);
                splitDigitsPlaced.push({
                  digit: remDigit,
                  itemId: remId,
                  x: remItem.x,
                  y: remItem.y,
                  width: remItem.width,
                  height: remItem.height,
                  shelfRowIndex: currentRowIndex,
                });

                currentX += remTight.widthInches + margin;
                if (chosen.h > shelfHeight) shelfHeight = chosen.h;
              }

              modificationLogs.push({
                id: `log-${chosen.orderId}-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
                orderId: chosen.orderId,
                customerName: chosen.customerName,
                originalNumber: chosen.number,
                reason: 'smart_pocket_fill',
                digits: splitDigitsPlaced,
                spaceSavedInches: parseFloat((firstDigitTight.widthInches + 0.5).toFixed(2)),
                timestamp: new Date().toLocaleTimeString(),
              });
            }
          }
        }

        // Standard row wrap
        if (!didSmartUnbundle) {
          currentX = margin;
          currentY += shelfHeight + margin;
          shelfHeight = 0;
          currentRowIndex++;
        }
      }
    };

    packNumberBlocks(numberBlocks);

    // Advance Y to start Curved Text section with a clean horizontal separation buffer
    currentX = margin;
    currentY += shelfHeight + margin + 0.25;
    shelfHeight = 0;
    currentRowIndex++;
  }

  // 3. Pack Specialized Curved / Arched Text Elements at the Very End / Bottom of the Sheet
  if (curvedTextBlocks.length > 0) {
    const pool = [...curvedTextBlocks];
    const curvedGap = Math.max(margin, 0.25); // Generous safety buffer for curved arches

    while (pool.length > 0) {
      const block = pool.shift()!;

      // Check if block exceeds 39" roll edge; wrap to new row cleanly
      if (currentX + block.w > rollWidth - curvedGap && currentX > curvedGap) {
        currentX = margin;
        currentY += shelfHeight + curvedGap;
        shelfHeight = 0;
        currentRowIndex++;
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
      });

      currentX += block.w + curvedGap;
      if (block.h > shelfHeight) {
        shelfHeight = block.h;
      }
    }
  }

  const totalRollHeight = Math.max(12.0, currentY + shelfHeight + margin);

  // Update locations in modification logs for pre-split items
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
  const wasteArea = Math.max(0, totalCapacityArea - totalUsedArea);
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
