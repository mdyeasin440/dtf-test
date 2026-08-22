import React, { useState, useRef, useEffect } from 'react';
import {
  ZoomIn,
  ZoomOut,
  Maximize2,
  RefreshCw,
  RotateCw,
  Trash2,
  Copy,
  Sliders,
  Ruler,
  Scissors,
  Move,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignStartVertical,
  AlignEndVertical,
  AlignVerticalSpaceAround,
  Grid,
  Layers,
  Sparkles,
  MousePointer,
  BoxSelect,
  Split,
  Link,
  Unlink,
  Eye,
  CheckCircle2,
} from 'lucide-react';
import { CanvasItem, DigitNestingMode, DigitSplitLogEntry, LayoutSettings, RollMetrics } from '../types';
import { renderItemToCanvas, addImageLoadListener } from '../utils/canvasRenderer';
import { checkCollisions, generateAutoNestingLayout } from '../utils/nestingEngine';
import { calculateTightTextDimensions } from '../utils/textMeasurement';
import { ModificationTrackerPanel } from './ModificationTrackerPanel';

interface CanvasEngineProps {
  canvasItems: CanvasItem[];
  setCanvasItems: React.Dispatch<React.SetStateAction<CanvasItem[]>>;
  layoutSettings: LayoutSettings;
  setLayoutSettings: React.Dispatch<React.SetStateAction<LayoutSettings>>;
  metrics: RollMetrics;
  setMetrics: (metrics: RollMetrics) => void;
  orders: any[];
}

function getItemBoundingBox(item: CanvasItem) {
  const rad = ((item.rotation || 0) * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));

  const w = item.width;
  const h = item.height;

  const aabbW = w * cos + h * sin;
  const aabbH = w * sin + h * cos;

  const cx = item.x + w / 2;
  const cy = item.y + h / 2;

  return {
    x: cx - aabbW / 2,
    y: cy - aabbH / 2,
    width: aabbW,
    height: aabbH,
    cx,
    cy,
  };
}

function getGroupBoundingBox(items: CanvasItem[]) {
  if (items.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  items.forEach((it) => {
    const bbox = getItemBoundingBox(it);
    if (bbox.x < minX) minX = bbox.x;
    if (bbox.y < minY) minY = bbox.y;
    if (bbox.x + bbox.width > maxX) maxX = bbox.x + bbox.width;
    if (bbox.y + bbox.height > maxY) maxY = bbox.y + bbox.height;
  });

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
  };
}

export type ResizeHandleType = 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'w' | 'e';

export const CanvasEngine: React.FC<CanvasEngineProps> = ({
  canvasItems,
  setCanvasItems,
  layoutSettings,
  setLayoutSettings,
  metrics,
  setMetrics,
  orders,
}) => {
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [modificationLogs, setModificationLogs] = useState<DigitSplitLogEntry[]>([]);
  const [activeSideTab, setActiveSideTab] = useState<'inspector' | 'tracker'>('inspector');
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [activeResizeHandle, setActiveResizeHandle] = useState<ResizeHandleType | null>(null);
  const [hoveredHandle, setHoveredHandle] = useState<string | null>(null);
  const [dragStartPos, setDragStartPos] = useState<{ x: number; y: number } | null>(null);
  const [initialItemPositions, setInitialItemPositions] = useState<Map<string, { x: number; y: number }>>(
    new Map()
  );
  const [initialResizeState, setInitialResizeState] = useState<{
    singleItem?: { id: string; x: number; y: number; width: number; height: number };
    groupItems?: { id: string; x: number; y: number; width: number; height: number }[];
    groupBBox?: { x: number; y: number; width: number; height: number };
  } | null>(null);

  const [selectionBox, setSelectionBox] = useState<{
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
  } | null>(null);

  const [zoom, setZoom] = useState<number>(0.65); // Scale factor
  const [fontTick, setFontTick] = useState<number>(0);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Initialize modification logs on mount or orders update if empty
  useEffect(() => {
    if (orders.length > 0 && modificationLogs.length === 0) {
      const result = generateAutoNestingLayout(orders, layoutSettings);
      if (result.modificationLogs && result.modificationLogs.length > 0) {
        setModificationLogs(result.modificationLogs);
      }
    }
  }, [orders]);

  // Listen for dynamic custom font (.ttf/.woff) and remote R2 images loading completion to refresh canvas immediately
  useEffect(() => {
    if (document.fonts) {
      document.fonts.ready.then(() => {
        setFontTick((prev) => prev + 1);
      });
      const handleLoadingDone = () => setFontTick((prev) => prev + 1);
      document.fonts.addEventListener('loadingdone', handleLoadingDone);

      const unsubscribeImg = addImageLoadListener(() => {
        setFontTick((prev) => prev + 1);
      });

      return () => {
        document.fonts.removeEventListener('loadingdone', handleLoadingDone);
        unsubscribeImg();
      };
    } else {
      const unsubscribeImg = addImageLoadListener(() => {
        setFontTick((prev) => prev + 1);
      });
      return () => unsubscribeImg();
    }
  }, []);

  // Keyboard Arrow Key Nudging & Shortcuts Listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing inside text inputs, textareas, or selects
      const activeTag = document.activeElement?.tagName?.toLowerCase();
      if (activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select') {
        return;
      }

      if (selectedItemIds.length === 0) return;

      // Nudge amount: Default 0.10" (fine adjustment), Shift + Arrow: 0.50" (faster nudge)
      const nudgeAmount = e.shiftKey ? 0.50 : 0.10;

      switch (e.key) {
        case 'ArrowUp':
          e.preventDefault();
          setCanvasItems((prev) =>
            prev.map((it) =>
              selectedItemIds.includes(it.id)
                ? { ...it, y: Math.max(0, parseFloat((it.y - nudgeAmount).toFixed(2))) }
                : it
            )
          );
          break;

        case 'ArrowDown':
          e.preventDefault();
          setCanvasItems((prev) =>
            prev.map((it) =>
              selectedItemIds.includes(it.id)
                ? { ...it, y: parseFloat((it.y + nudgeAmount).toFixed(2)) }
                : it
            )
          );
          break;

        case 'ArrowLeft':
          e.preventDefault();
          setCanvasItems((prev) =>
            prev.map((it) =>
              selectedItemIds.includes(it.id)
                ? { ...it, x: Math.max(-PASTEBOARD_MARGIN_X, parseFloat((it.x - nudgeAmount).toFixed(2))) }
                : it
            )
          );
          break;

        case 'ArrowRight':
          e.preventDefault();
          setCanvasItems((prev) =>
            prev.map((it) =>
              selectedItemIds.includes(it.id)
                ? { ...it, x: parseFloat((it.x + nudgeAmount).toFixed(2)) }
                : it
            )
          );
          break;

        case 'Delete':
        case 'Backspace':
          e.preventDefault();
          setCanvasItems((prev) => prev.filter((it) => !selectedItemIds.includes(it.id)));
          setSelectedItemIds([]);
          break;

        case 'Escape':
          e.preventDefault();
          setSelectedItemIds([]);
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedItemIds]);

  const PASTEBOARD_MARGIN_X = 10; // 10 inches left and right pasteboard workspace
  const PASTEBOARD_MARGIN_Y = 3;  // 3 inches top and bottom pasteboard workspace

  const pixelsPerInch = 20 * zoom; // Scale factor for screen display
  const rollWidthInches = layoutSettings.rollWidthInches || 39.0;
  const workspaceWidthInches = rollWidthInches + PASTEBOARD_MARGIN_X * 2;
  const canvasWidthPx = Math.round(workspaceWidthInches * pixelsPerInch);

  // Detect collisions
  const collisionsMap = checkCollisions(canvasItems, layoutSettings.marginInches);

  // Re-calculate roll metrics when items or settings change
  useEffect(() => {
    let maxY = 12.0;
    let totalUsedArea = 0;
    canvasItems.forEach((it) => {
      // Calculate metrics based on items inside the active 39" sheet
      if (it.x >= 0 && it.x < rollWidthInches) {
        const bbox = getItemBoundingBox(it);
        if (bbox.y + bbox.height > maxY) maxY = bbox.y + bbox.height;
        totalUsedArea += it.width * it.height;
      }
    });

    const totalRollHeight = Math.max(12.0, maxY + (layoutSettings.marginInches || 0.10));
    const capacityArea = rollWidthInches * totalRollHeight;
    const efficiency = Math.min(100, parseFloat(((totalUsedArea / (capacityArea || 1)) * 100).toFixed(1)));
    const waste = parseFloat((100 - efficiency).toFixed(1));

    setMetrics({
      totalRollLengthInches: parseFloat(totalRollHeight.toFixed(2)),
      totalRollLengthMeters: parseFloat((totalRollHeight * 0.0254).toFixed(2)),
      usedAreaSquareInches: parseFloat(totalUsedArea.toFixed(1)),
      totalCapacitySquareInches: parseFloat(capacityArea.toFixed(1)),
      wastePercentage: waste,
      efficiencyPercentage: efficiency,
      totalNamesCount: canvasItems.filter((i) => i.itemType === 'name' && i.x >= 0 && i.x < rollWidthInches).length,
      totalNumbersCount: canvasItems.filter((i) => i.itemType === 'number' && i.x >= 0 && i.x < rollWidthInches).length,
      totalOrdersCount: orders.length,
      estimatedPrintTimeMinutes: Math.ceil(totalRollHeight / 12.5),
      estimatedFilmCostUSD: parseFloat((totalRollHeight * 0.18).toFixed(2)),
    });
  }, [canvasItems, layoutSettings, setMetrics]);

  // Main Canvas Render Loop (Illustrator Style Pasteboard Workspace)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const totalHeightInches = metrics.totalRollLengthInches || 24.0;
    const workspaceHeightInches = totalHeightInches + PASTEBOARD_MARGIN_Y * 2;
    const canvasHeightPx = Math.round(workspaceHeightInches * pixelsPerInch);

    canvas.width = canvasWidthPx;
    canvas.height = canvasHeightPx;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // 1. Fill entire workspace with Illustrator dark pasteboard gray (#141418)
    ctx.fillStyle = '#141418';
    ctx.fillRect(0, 0, canvasWidthPx, canvasHeightPx);

    // Left & Right Pasteboard text watermark labels
    ctx.save();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.font = '900 11px monospace';
    ctx.textAlign = 'center';

    const leftPasteboardCenterPx = (PASTEBOARD_MARGIN_X / 2) * pixelsPerInch;
    const rightPasteboardCenterPx = (PASTEBOARD_MARGIN_X + rollWidthInches + PASTEBOARD_MARGIN_X / 2) * pixelsPerInch;

    ctx.fillText('PASTEBOARD (PARKED ELEMENTS)', leftPasteboardCenterPx, 22);
    ctx.fillText('PASTEBOARD (PARKED ELEMENTS)', rightPasteboardCenterPx, 22);
    ctx.restore();

    // 2. Draw 39" Active Printable Sheet Artboard
    const artboardXPx = PASTEBOARD_MARGIN_X * pixelsPerInch;
    const artboardYPx = PASTEBOARD_MARGIN_Y * pixelsPerInch;
    const artboardWPx = rollWidthInches * pixelsPerInch;
    const artboardHPx = totalHeightInches * pixelsPerInch;

    // Artboard Drop Shadow
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
    ctx.shadowBlur = 24;
    ctx.shadowOffsetY = 8;
    ctx.fillStyle = '#050505';
    ctx.fillRect(artboardXPx, artboardYPx, artboardWPx, artboardHPx);
    ctx.restore();

    // 1-inch Grid lines inside the 39" artboard
    ctx.save();
    ctx.translate(artboardXPx, artboardYPx);
    ctx.strokeStyle = '#18181b';
    ctx.lineWidth = 1;

    for (let x = 0; x <= rollWidthInches; x++) {
      ctx.beginPath();
      ctx.moveTo(x * pixelsPerInch, 0);
      ctx.lineTo(x * pixelsPerInch, artboardHPx);
      ctx.stroke();
    }

    for (let y = 0; y <= totalHeightInches; y++) {
      ctx.beginPath();
      ctx.moveTo(0, y * pixelsPerInch);
      ctx.lineTo(artboardWPx, y * pixelsPerInch);
      ctx.stroke();
    }
    ctx.restore();

    // Outer 39" Artboard Printable Sheet Edge Border
    ctx.strokeStyle = '#dc2626';
    ctx.lineWidth = 2.5;
    ctx.strokeRect(artboardXPx, artboardYPx, artboardWPx, artboardHPx);

    // Artboard Sheet Title Badge
    ctx.save();
    ctx.fillStyle = '#dc2626';
    ctx.fillRect(artboardXPx, artboardYPx - 20, 200, 20);
    ctx.fillStyle = '#ffffff';
    ctx.font = '800 10px monospace';
    ctx.fillText(' 39.0" ACTIVE PRINT SHEET', artboardXPx + 6, artboardYPx - 6);
    ctx.restore();

    // 3. Render Canvas Items inside Artboard coordinate system
    ctx.save();
    ctx.translate(artboardXPx, artboardYPx);

    canvasItems.forEach((item) => {
      // Check if item is parked on the pasteboard outside 39" active printable sheet
      const isOutside = item.x < 0 || item.x + item.width > rollWidthInches || item.y < 0;

      renderItemToCanvas(ctx, item, pixelsPerInch, {
        showCutLines: layoutSettings.showCutLines,
        cutLineColor: layoutSettings.cutLineColor,
        isSelected: selectedItemIds.includes(item.id),
        hasCollision: collisionsMap.has(item.id),
        hoveredHandle: selectedItemIds.length === 1 && selectedItemIds.includes(item.id) ? hoveredHandle : null,
      });

      // Render Amber Parked Tag for Pasteboard items
      if (isOutside) {
        const itemXPx = item.x * pixelsPerInch;
        const itemYPx = item.y * pixelsPerInch;

        ctx.save();
        ctx.strokeStyle = '#eab308';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 3]);
        ctx.strokeRect(itemXPx - 2, itemYPx - 2, item.width * pixelsPerInch + 4, item.height * pixelsPerInch + 4);

        ctx.fillStyle = '#eab308';
        ctx.font = '800 9px monospace';
        ctx.fillText('PARKED ON PASTEBOARD (NON-PRINTING)', itemXPx, Math.max(10, itemYPx - 4));
        ctx.restore();
      }
    });

    // Render Unified Group Selection Box
    if (selectedItemIds.length > 1) {
      const selected = canvasItems.filter((i) => selectedItemIds.includes(i.id));
      const gBox = getGroupBoundingBox(selected);
      if (gBox) {
        const gx = gBox.x * pixelsPerInch;
        const gy = gBox.y * pixelsPerInch;
        const gw = gBox.width * pixelsPerInch;
        const gh = gBox.height * pixelsPerInch;
        const midX = gx + gw / 2;
        const midY = gy + gh / 2;

        ctx.save();
        ctx.strokeStyle = '#06b6d4';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 3]);
        ctx.strokeRect(gx - 4, gy - 4, gw + 8, gh + 8);

        const handleSize = Math.max(8, pixelsPerInch * 0.15);
        const halfH = handleSize / 2;

        const handles: { id: string; x: number; y: number }[] = [
          { id: 'nw', x: gx - 4, y: gy - 4 },
          { id: 'ne', x: gx + gw + 4, y: gy - 4 },
          { id: 'sw', x: gx - 4, y: gy + gh + 4 },
          { id: 'se', x: gx + gw + 4, y: gy + gh + 4 },
          { id: 'n', x: midX, y: gy - 4 },
          { id: 's', x: midX, y: gy + gh + 4 },
          { id: 'w', x: gx - 4, y: midY },
          { id: 'e', x: gx + gw + 4, y: midY },
        ];

        handles.forEach((h) => {
          const isHov = hoveredHandle === h.id;
          ctx.fillStyle = isHov ? '#ec4899' : '#ffffff';
          ctx.strokeStyle = isHov ? '#ffffff' : '#06b6d4';
          ctx.lineWidth = 1.5;
          ctx.fillRect(h.x - halfH, h.y - halfH, handleSize, handleSize);
          ctx.strokeRect(h.x - halfH, h.y - halfH, handleSize, handleSize);
        });

        // If edge path hovered, show Illustrator-style "path" tooltip badge
        if (hoveredHandle && ['w', 'e', 'n', 's'].includes(hoveredHandle)) {
          let bX = midX;
          let bY = midY;
          if (hoveredHandle === 'w') { bX = gx - 4; bY = midY; }
          else if (hoveredHandle === 'e') { bX = gx + gw + 4; bY = midY; }
          else if (hoveredHandle === 'n') { bX = midX; bY = gy - 4; }
          else if (hoveredHandle === 's') { bX = midX; bY = gy + gh + 4; }

          ctx.save();
          ctx.font = 'bold 9px sans-serif';
          ctx.fillStyle = 'rgba(236, 72, 153, 0.95)';
          ctx.beginPath();
          ctx.roundRect(bX + 6, bY - 6.5, 32, 13, 2);
          ctx.fill();
          ctx.fillStyle = '#ffffff';
          ctx.fillText('path', bX + 10, bY + 3);
          ctx.restore();
        }

        ctx.fillStyle = '#06b6d4';
        ctx.font = '700 11px monospace';
        ctx.fillText(`UNIFIED GROUP SELECTION (${selectedItemIds.length} ITEMS)`, gx - 4, gy - 10);
        ctx.restore();
      }
    }

    // Render Drag Selection Marquee Box
    if (selectionBox) {
      const minX = Math.min(selectionBox.startX, selectionBox.currentX) * pixelsPerInch;
      const minY = Math.min(selectionBox.startY, selectionBox.currentY) * pixelsPerInch;
      const boxW = Math.abs(selectionBox.currentX - selectionBox.startX) * pixelsPerInch;
      const boxH = Math.abs(selectionBox.currentY - selectionBox.startY) * pixelsPerInch;

      ctx.save();
      ctx.fillStyle = 'rgba(6, 182, 212, 0.15)';
      ctx.fillRect(minX, minY, boxW, boxH);
      ctx.strokeStyle = '#06b6d4';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(minX, minY, boxW, boxH);
      ctx.restore();
    }

    ctx.restore();
  }, [
    canvasItems,
    selectedItemIds,
    selectionBox,
    pixelsPerInch,
    layoutSettings,
    metrics.totalRollLengthInches,
    fontTick,
    hoveredHandle,
  ]);

  // Helper to check if click/mouse hit an 8-direction handle or edge boundary path
  const getHitResizeHandle = (
    clickX: number,
    clickY: number
  ): { handle: ResizeHandleType; item?: CanvasItem; gBox?: any } | null => {
    const handleHitRadius = Math.max(0.40, 12 / pixelsPerInch);
    const edgeTolerance = Math.max(0.24, 9 / pixelsPerInch);

    if (selectedItemIds.length === 1) {
      const it = canvasItems.find((i) => i.id === selectedItemIds[0]);
      if (!it || it.locked) return null;

      const midX = it.x + it.width / 2;
      const midY = it.y + it.height / 2;

      // 1. Check Corner Handles First
      const corners: { handle: ResizeHandleType; x: number; y: number }[] = [
        { handle: 'nw', x: it.x, y: it.y },
        { handle: 'ne', x: it.x + it.width, y: it.y },
        { handle: 'sw', x: it.x, y: it.y + it.height },
        { handle: 'se', x: it.x + it.width, y: it.y + it.height },
      ];

      for (const c of corners) {
        if (Math.hypot(clickX - c.x, clickY - c.y) <= handleHitRadius) {
          return { handle: c.handle, item: it };
        }
      }

      // 2. Check Midpoint Edge Handles
      const midpoints: { handle: ResizeHandleType; x: number; y: number }[] = [
        { handle: 'n', x: midX, y: it.y },
        { handle: 's', x: midX, y: it.y + it.height },
        { handle: 'w', x: it.x, y: midY },
        { handle: 'e', x: it.x + it.width, y: midY },
      ];

      for (const m of midpoints) {
        if (Math.hypot(clickX - m.x, clickY - m.y) <= handleHitRadius) {
          return { handle: m.handle, item: it };
        }
      }

      // 3. Check Edge Boundary Paths (Adobe Illustrator path edge hover)
      // Left edge path
      if (
        Math.abs(clickX - it.x) <= edgeTolerance &&
        clickY >= it.y - 0.1 &&
        clickY <= it.y + it.height + 0.1
      ) {
        return { handle: 'w', item: it };
      }
      // Right edge path
      if (
        Math.abs(clickX - (it.x + it.width)) <= edgeTolerance &&
        clickY >= it.y - 0.1 &&
        clickY <= it.y + it.height + 0.1
      ) {
        return { handle: 'e', item: it };
      }
      // Top edge path
      if (
        Math.abs(clickY - it.y) <= edgeTolerance &&
        clickX >= it.x - 0.1 &&
        clickX <= it.x + it.width + 0.1
      ) {
        return { handle: 'n', item: it };
      }
      // Bottom edge path
      if (
        Math.abs(clickY - (it.y + it.height)) <= edgeTolerance &&
        clickX >= it.x - 0.1 &&
        clickX <= it.x + it.width + 0.1
      ) {
        return { handle: 's', item: it };
      }
    } else if (selectedItemIds.length > 1) {
      const selectedList = canvasItems.filter((i) => selectedItemIds.includes(i.id));
      const gBox = getGroupBoundingBox(selectedList);
      if (!gBox) return null;

      const midX = gBox.x + gBox.width / 2;
      const midY = gBox.y + gBox.height / 2;

      // Corners
      const corners: { handle: ResizeHandleType; x: number; y: number }[] = [
        { handle: 'nw', x: gBox.x, y: gBox.y },
        { handle: 'ne', x: gBox.x + gBox.width, y: gBox.y },
        { handle: 'sw', x: gBox.x, y: gBox.y + gBox.height },
        { handle: 'se', x: gBox.x + gBox.width, y: gBox.y + gBox.height },
      ];

      for (const c of corners) {
        if (Math.hypot(clickX - c.x, clickY - c.y) <= handleHitRadius) {
          return { handle: c.handle, gBox };
        }
      }

      // Midpoints
      const midpoints: { handle: ResizeHandleType; x: number; y: number }[] = [
        { handle: 'n', x: midX, y: gBox.y },
        { handle: 's', x: midX, y: gBox.y + gBox.height },
        { handle: 'w', x: gBox.x, y: midY },
        { handle: 'e', x: gBox.x + gBox.width, y: midY },
      ];

      for (const m of midpoints) {
        if (Math.hypot(clickX - m.x, clickY - m.y) <= handleHitRadius) {
          return { handle: m.handle, gBox };
        }
      }

      // Edge Paths
      if (
        Math.abs(clickX - gBox.x) <= edgeTolerance &&
        clickY >= gBox.y - 0.1 &&
        clickY <= gBox.y + gBox.height + 0.1
      ) {
        return { handle: 'w', gBox };
      }
      if (
        Math.abs(clickX - (gBox.x + gBox.width)) <= edgeTolerance &&
        clickY >= gBox.y - 0.1 &&
        clickY <= gBox.y + gBox.height + 0.1
      ) {
        return { handle: 'e', gBox };
      }
      if (
        Math.abs(clickY - gBox.y) <= edgeTolerance &&
        clickX >= gBox.x - 0.1 &&
        clickX <= gBox.x + gBox.width + 0.1
      ) {
        return { handle: 'n', gBox };
      }
      if (
        Math.abs(clickY - (gBox.y + gBox.height)) <= edgeTolerance &&
        clickX >= gBox.x - 0.1 &&
        clickX <= gBox.x + gBox.width + 0.1
      ) {
        return { handle: 's', gBox };
      }
    }

    return null;
  };

  // Handle Mouse Down & Interactive Selection / 8-Direction Resizing
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const clickX = (e.clientX - rect.left) / pixelsPerInch - PASTEBOARD_MARGIN_X;
    const clickY = (e.clientY - rect.top) / pixelsPerInch - PASTEBOARD_MARGIN_Y;

    // 1. Check if user clicked on a resize handle or edge path of an active selection
    const hitHandle = getHitResizeHandle(clickX, clickY);
    if (hitHandle) {
      setIsResizing(true);
      setActiveResizeHandle(hitHandle.handle);
      if (hitHandle.item) {
        setInitialResizeState({
          singleItem: {
            id: hitHandle.item.id,
            x: hitHandle.item.x,
            y: hitHandle.item.y,
            width: hitHandle.item.width,
            height: hitHandle.item.height,
          },
        });
      } else if (hitHandle.gBox) {
        const selectedList = canvasItems.filter((i) => selectedItemIds.includes(i.id));
        setInitialResizeState({
          groupBBox: hitHandle.gBox,
          groupItems: selectedList.map((i) => ({
            id: i.id,
            x: i.x,
            y: i.y,
            width: i.width,
            height: i.height,
          })),
        });
      }
      return;
    }

    // 2. Find top-most clicked item (reverse z-order)
    const clickedItem = [...canvasItems].reverse().find((it) => {
      const bbox = getItemBoundingBox(it);
      return (
        clickX >= bbox.x &&
        clickX <= bbox.x + bbox.width &&
        clickY >= bbox.y &&
        clickY <= bbox.y + bbox.height
      );
    });

    // Or check if clicked inside existing multi-selection group bounding box
    const selectedList = canvasItems.filter((i) => selectedItemIds.includes(i.id));
    const groupBBox = selectedItemIds.length > 1 ? getGroupBoundingBox(selectedList) : null;
    const clickedInGroup =
      groupBBox &&
      clickX >= groupBBox.x &&
      clickX <= groupBBox.x + groupBBox.width &&
      clickY >= groupBBox.y &&
      clickY <= groupBBox.y + groupBBox.height;

    if (clickedItem || clickedInGroup) {
      const targetItem = clickedItem || selectedList[0];
      if (targetItem?.locked) return;

      let newSelectedIds = [...selectedItemIds];
      if (e.shiftKey) {
        if (clickedItem) {
          if (newSelectedIds.includes(clickedItem.id)) {
            newSelectedIds = newSelectedIds.filter((id) => id !== clickedItem.id);
          } else {
            newSelectedIds.push(clickedItem.id);
          }
        }
      } else {
        if (clickedItem && !newSelectedIds.includes(clickedItem.id)) {
          newSelectedIds = [clickedItem.id];
        }
      }

      setSelectedItemIds(newSelectedIds);
      setIsDragging(true);
      setDragStartPos({ x: clickX, y: clickY });

      const initialMap = new Map<string, { x: number; y: number }>();
      canvasItems.forEach((it) => {
        if (newSelectedIds.includes(it.id)) {
          initialMap.set(it.id, { x: it.x, y: it.y });
        }
      });
      setInitialItemPositions(initialMap);
    } else {
      if (!e.shiftKey) {
        setSelectedItemIds([]);
      }
      setSelectionBox({
        startX: clickX,
        startY: clickY,
        currentX: clickX,
        currentY: clickY,
      });
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const mouseX = (e.clientX - rect.left) / pixelsPerInch - PASTEBOARD_MARGIN_X;
    const mouseY = (e.clientY - rect.top) / pixelsPerInch - PASTEBOARD_MARGIN_Y;

    // Update cursor icon and hover status based on edge / handle hover
    if (!isDragging && !isResizing && !selectionBox) {
      const hitHandle = getHitResizeHandle(mouseX, mouseY);
      setHoveredHandle(hitHandle ? hitHandle.handle : null);

      if (hitHandle) {
        if (hitHandle.handle === 'w' || hitHandle.handle === 'e') {
          canvas.style.cursor = 'ew-resize';
        } else if (hitHandle.handle === 'n' || hitHandle.handle === 's') {
          canvas.style.cursor = 'ns-resize';
        } else if (hitHandle.handle === 'nw' || hitHandle.handle === 'se') {
          canvas.style.cursor = 'nwse-resize';
        } else if (hitHandle.handle === 'ne' || hitHandle.handle === 'sw') {
          canvas.style.cursor = 'nesw-resize';
        }
      } else {
        const isOverSelected = canvasItems.some(
          (it) =>
            selectedItemIds.includes(it.id) &&
            mouseX >= it.x &&
            mouseX <= it.x + it.width &&
            mouseY >= it.y &&
            mouseY <= it.y + it.height
        );
        canvas.style.cursor = isOverSelected ? 'move' : 'crosshair';
      }
    }

    // Handle 8-direction fluid scaling
    if (isResizing && activeResizeHandle && initialResizeState) {
      if (initialResizeState.singleItem) {
        const init = initialResizeState.singleItem;
        let newX = init.x;
        let newY = init.y;
        let newW = init.width;
        let newH = init.height;

        switch (activeResizeHandle) {
          case 'e':
            newW = Math.max(0.3, mouseX - init.x);
            break;
          case 'w':
            newW = Math.max(0.3, init.x + init.width - mouseX);
            newX = mouseX;
            break;
          case 's':
            newH = Math.max(0.3, mouseY - init.y);
            break;
          case 'n':
            newH = Math.max(0.3, init.y + init.height - mouseY);
            newY = mouseY;
            break;
          case 'se':
            newW = Math.max(0.3, mouseX - init.x);
            newH = Math.max(0.3, mouseY - init.y);
            break;
          case 'sw':
            newW = Math.max(0.3, init.x + init.width - mouseX);
            newX = mouseX;
            newH = Math.max(0.3, mouseY - init.y);
            break;
          case 'ne':
            newW = Math.max(0.3, mouseX - init.x);
            newH = Math.max(0.3, init.y + init.height - mouseY);
            newY = mouseY;
            break;
          case 'nw':
            newW = Math.max(0.3, init.x + init.width - mouseX);
            newX = mouseX;
            newH = Math.max(0.3, init.y + init.height - mouseY);
            newY = mouseY;
            break;
        }

        setCanvasItems((prev) =>
          prev.map((it) =>
            it.id === init.id
              ? {
                  ...it,
                  x: parseFloat(newX.toFixed(2)),
                  y: parseFloat(newY.toFixed(2)),
                  width: parseFloat(newW.toFixed(2)),
                  height: parseFloat(newH.toFixed(2)),
                }
              : it
          )
        );
      } else if (initialResizeState.groupItems && initialResizeState.groupBBox) {
        const gBox = initialResizeState.groupBBox;
        let newGW = gBox.width;
        let newGH = gBox.height;
        let originX = gBox.x;
        let originY = gBox.y;

        switch (activeResizeHandle) {
          case 'e':
            newGW = Math.max(1, mouseX - gBox.x);
            break;
          case 'w':
            newGW = Math.max(1, gBox.x + gBox.width - mouseX);
            originX = mouseX;
            break;
          case 's':
            newGH = Math.max(1, mouseY - gBox.y);
            break;
          case 'n':
            newGH = Math.max(1, gBox.y + gBox.height - mouseY);
            originY = mouseY;
            break;
          case 'se':
            newGW = Math.max(1, mouseX - gBox.x);
            newGH = Math.max(1, mouseY - gBox.y);
            break;
          case 'sw':
            newGW = Math.max(1, gBox.x + gBox.width - mouseX);
            originX = mouseX;
            newGH = Math.max(1, mouseY - gBox.y);
            break;
          case 'ne':
            newGW = Math.max(1, mouseX - gBox.x);
            newGH = Math.max(1, gBox.y + gBox.height - mouseY);
            originY = mouseY;
            break;
          case 'nw':
            newGW = Math.max(1, gBox.x + gBox.width - mouseX);
            originX = mouseX;
            newGH = Math.max(1, gBox.y + gBox.height - mouseY);
            originY = mouseY;
            break;
        }

        const scaleX = newGW / gBox.width;
        const scaleY = newGH / gBox.height;

        setCanvasItems((prev) =>
          prev.map((it) => {
            const orig = initialResizeState.groupItems?.find((g) => g.id === it.id);
            if (!orig) return it;
            const relX = orig.x - gBox.x;
            const relY = orig.y - gBox.y;
            return {
              ...it,
              x: parseFloat((originX + relX * scaleX).toFixed(2)),
              y: parseFloat((originY + relY * scaleY).toFixed(2)),
              width: parseFloat((orig.width * scaleX).toFixed(2)),
              height: parseFloat((orig.height * scaleY).toFixed(2)),
            };
          })
        );
      }
      return;
    }

    if (selectionBox) {
      const updatedBox = { ...selectionBox, currentX: mouseX, currentY: mouseY };
      setSelectionBox(updatedBox);

      const minX = Math.min(updatedBox.startX, updatedBox.currentX);
      const maxX = Math.max(updatedBox.startX, updatedBox.currentX);
      const minY = Math.min(updatedBox.startY, updatedBox.currentY);
      const maxY = Math.max(updatedBox.startY, updatedBox.currentY);

      const highlighted = canvasItems
        .filter((it) => {
          const bbox = getItemBoundingBox(it);
          return (
            bbox.x < maxX &&
            bbox.x + bbox.width > minX &&
            bbox.y < maxY &&
            bbox.y + bbox.height > minY
          );
        })
        .map((it) => it.id);

      setSelectedItemIds(highlighted);
    } else if (isDragging && dragStartPos) {
      let dx = mouseX - dragStartPos.x;
      let dy = mouseY - dragStartPos.y;

      // Shift-Key Straight Axis Movement:
      // When holding down Shift while dragging, lock movement to strictly horizontal or strictly vertical axis
      if (e.shiftKey) {
        if (Math.abs(dx) >= Math.abs(dy)) {
          dy = 0; // Lock vertical drift, move only along X axis
        } else {
          dx = 0; // Lock horizontal drift, move only along Y axis
        }
      }

      setCanvasItems((prev) =>
        prev.map((it) => {
          if (initialItemPositions.has(it.id)) {
            const initialPos = initialItemPositions.get(it.id)!;
            const newX = initialPos.x + dx; // Seamless pasteboard movement
            const newY = initialPos.y + dy;
            return {
              ...it,
              x: parseFloat(newX.toFixed(2)),
              y: parseFloat(newY.toFixed(2)),
            };
          }
          return it;
        })
      );
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
    setIsResizing(false);
    setActiveResizeHandle(null);
    setInitialResizeState(null);
    setSelectionBox(null);
    setDragStartPos(null);
  };

  // Split Multi-Digit Numbers into Independent Movable Single Digits
  const handleSplitSelectedDigits = (targetItem?: CanvasItem) => {
    const targetIds = targetItem ? [targetItem.id] : selectedItemIds;
    if (targetIds.length === 0) return;

    let didSplitAny = false;
    const newItemsList: CanvasItem[] = [];
    const newSelectedIds: string[] = [];
    const createdLogs: DigitSplitLogEntry[] = [];

    canvasItems.forEach((it) => {
      if (targetIds.includes(it.id) && it.itemType === 'number' && it.number.replace(/\D/g, '').length > 1) {
        didSplitAny = true;
        const digits = it.number.replace(/\D/g, '').split('');
        const itemH = it.height;
        let runningX = it.x;
        const splitLocs: any[] = [];

        digits.forEach((digit, idx) => {
          const tightDim = calculateTightTextDimensions(digit, 'number', it.preset, itemH);
          const digitId = `${it.id}-d${idx}-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`;
          const digitItem: CanvasItem = {
            id: digitId,
            orderId: it.orderId,
            itemType: 'number',
            customerName: it.customerName ? `${it.customerName} (Digit ${digit})` : `Digit ${digit}`,
            number: digit,
            designCode: it.designCode,
            preset: it.preset,
            x: parseFloat(runningX.toFixed(2)),
            y: it.y,
            width: tightDim.widthInches,
            height: itemH,
            rotation: it.rotation || 0,
            zIndex: it.zIndex + idx,
            locked: false,
            garmentSize: it.garmentSize,
            customColorOverride: it.customColorOverride,
            customStrokeOverride: it.customStrokeOverride,
          };
          newItemsList.push(digitItem);
          newSelectedIds.push(digitItem.id);
          splitLocs.push({
            digit,
            itemId: digitId,
            x: digitItem.x,
            y: digitItem.y,
            width: digitItem.width,
            height: digitItem.height,
            shelfRowIndex: 1,
          });
          runningX += tightDim.widthInches + 0.05; // clean gap between digits
        });

        createdLogs.push({
          id: `log-man-${it.id}-${Date.now()}`,
          orderId: it.orderId,
          customerName: it.customerName,
          originalNumber: it.number,
          reason: 'manual_unbundle',
          digits: splitLocs,
          spaceSavedInches: parseFloat((it.width * 0.35).toFixed(2)),
          timestamp: new Date().toLocaleTimeString(),
        });
      } else {
        newItemsList.push(it);
      }
    });

    if (didSplitAny) {
      setCanvasItems(newItemsList);
      setSelectedItemIds(newSelectedIds);
      setModificationLogs((prev) => [...createdLogs, ...prev]);
    }
  };

  // Merge Multiple Selected Single Digits back into a Single Combined Number Item
  const handleMergeSelectedDigits = () => {
    const selected = canvasItems.filter((i) => selectedItemIds.includes(i.id) && i.itemType === 'number');
    if (selected.length < 2) return;

    // Sort selected digits from left to right
    selected.sort((a, b) => a.x - b.x);

    const mergedDigitsStr = selected.map((s) => s.number).join('');
    const firstItem = selected[0];
    const avgH = selected.reduce((acc, s) => acc + s.height, 0) / selected.length;
    const tightCombined = calculateTightTextDimensions(mergedDigitsStr, 'number', firstItem.preset, avgH);

    const mergedItem: CanvasItem = {
      id: `${firstItem.orderId}-merged-${Date.now()}`,
      orderId: firstItem.orderId,
      itemType: 'number',
      customerName: firstItem.customerName.replace(/ \(Digit .*\)/, '') || `Number ${mergedDigitsStr}`,
      number: mergedDigitsStr,
      designCode: firstItem.designCode,
      preset: firstItem.preset,
      x: firstItem.x,
      y: firstItem.y,
      width: tightCombined.widthInches,
      height: parseFloat(avgH.toFixed(2)),
      rotation: firstItem.rotation || 0,
      zIndex: Math.max(...selected.map((s) => s.zIndex)),
      locked: false,
      garmentSize: firstItem.garmentSize,
    };

    const remainingItems = canvasItems.filter((i) => !selectedItemIds.includes(i.id));
    setCanvasItems([...remainingItems, mergedItem]);
    setSelectedItemIds([mergedItem.id]);

    // Update modification logs
    const selIds = new Set(selectedItemIds);
    setModificationLogs((prev) =>
      prev.filter((l) => !l.digits.some((d) => selIds.has(d.itemId)))
    );
  };

  // Merge from a specific Modification Log Entry
  const handleMergeFromLog = (logEntry: DigitSplitLogEntry) => {
    const digitIds = logEntry.digits.map((d) => d.itemId);
    const selected = canvasItems.filter((i) => digitIds.includes(i.id));
    if (selected.length < 1) return;

    selected.sort((a, b) => a.x - b.x);
    const mergedDigitsStr = logEntry.originalNumber;
    const firstItem = selected[0];
    const avgH = selected.reduce((acc, s) => acc + s.height, 0) / selected.length;
    const tightCombined = calculateTightTextDimensions(mergedDigitsStr, 'number', firstItem.preset, avgH);

    const mergedItem: CanvasItem = {
      id: `${logEntry.orderId}-merged-${Date.now()}`,
      orderId: logEntry.orderId,
      itemType: 'number',
      customerName: logEntry.customerName || `Number ${mergedDigitsStr}`,
      number: mergedDigitsStr,
      designCode: firstItem.designCode,
      preset: firstItem.preset,
      x: firstItem.x,
      y: firstItem.y,
      width: tightCombined.widthInches,
      height: parseFloat(avgH.toFixed(2)),
      rotation: firstItem.rotation || 0,
      zIndex: Math.max(...selected.map((s) => s.zIndex)),
      locked: false,
      garmentSize: firstItem.garmentSize,
    };

    const remainingItems = canvasItems.filter((i) => !digitIds.includes(i.id));
    setCanvasItems([...remainingItems, mergedItem]);
    setSelectedItemIds([mergedItem.id]);
    setModificationLogs((prev) => prev.filter((l) => l.id !== logEntry.id));
  };

  // Locate and Highlight on Canvas from Modification Tracker
  const handleLocateOnCanvas = (itemIds: string[]) => {
    setSelectedItemIds(itemIds);
    const items = canvasItems.filter((i) => itemIds.includes(i.id));
    if (items.length > 0 && containerRef.current) {
      const minY = Math.min(...items.map((i) => i.y));
      const targetScroll = (minY + PASTEBOARD_MARGIN_Y) * (pixelsPerInch * zoom) - 100;
      window.scrollTo({ top: Math.max(0, targetScroll), behavior: 'smooth' });
    }
  };

  // Re-Pack Layout Handler
  const handleRePack = () => {
    if (orders.length === 0) return;
    const result = generateAutoNestingLayout(orders, layoutSettings);
    setCanvasItems(result.items);
    setMetrics(result.metrics);
    setModificationLogs(result.modificationLogs || []);
  };

  // Single or Batch Rotation Handler
  const handleRotateSelectedBy = (angleDelta: number) => {
    if (selectedItemIds.length === 0) return;
    setCanvasItems((prev) =>
      prev.map((it) => {
        if (selectedItemIds.includes(it.id)) {
          const newRot = ( (it.rotation || 0) + angleDelta + 360 ) % 360;
          return { ...it, rotation: newRot };
        }
        return it;
      })
    );
  };

  const handleSetSelectedRotation = (exactAngle: number) => {
    if (selectedItemIds.length === 0) return;
    setCanvasItems((prev) =>
      prev.map((it) => {
        if (selectedItemIds.includes(it.id)) {
          return { ...it, rotation: exactAngle };
        }
        return it;
      })
    );
  };

  const handleDeleteSelected = () => {
    if (selectedItemIds.length === 0) return;
    setCanvasItems((prev) => prev.filter((it) => !selectedItemIds.includes(it.id)));
    setSelectedItemIds([]);
  };

  const handleDuplicateSelected = () => {
    if (selectedItemIds.length === 0) return;
    const duplicates: CanvasItem[] = [];

    canvasItems.forEach((target) => {
      if (selectedItemIds.includes(target.id)) {
        duplicates.push({
          ...target,
          id: `${target.id}-copy-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
          y: parseFloat((target.y + target.height + 0.35).toFixed(2)),
        });
      }
    });

    setCanvasItems((prev) => [...prev, ...duplicates]);
    setSelectedItemIds(duplicates.map((d) => d.id));
  };

  // Adobe Alignment Tools
  const handleAlignSelected = (type: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom') => {
    if (selectedItemIds.length < 2) return;
    const selected = canvasItems.filter((i) => selectedItemIds.includes(i.id));

    if (type === 'left') {
      const minX = Math.min(...selected.map((i) => i.x));
      setCanvasItems((prev) =>
        prev.map((i) => (selectedItemIds.includes(i.id) ? { ...i, x: minX } : i))
      );
    } else if (type === 'center') {
      const avgCx =
        selected.reduce((acc, i) => acc + (i.x + i.width / 2), 0) / selected.length;
      setCanvasItems((prev) =>
        prev.map((i) =>
          selectedItemIds.includes(i.id)
            ? { ...i, x: parseFloat((avgCx - i.width / 2).toFixed(2)) }
            : i
        )
      );
    } else if (type === 'right') {
      const maxX = Math.max(...selected.map((i) => i.x + i.width));
      setCanvasItems((prev) =>
        prev.map((i) =>
          selectedItemIds.includes(i.id)
            ? { ...i, x: parseFloat((maxX - i.width).toFixed(2)) }
            : i
        )
      );
    } else if (type === 'top') {
      const minY = Math.min(...selected.map((i) => i.y));
      setCanvasItems((prev) =>
        prev.map((i) => (selectedItemIds.includes(i.id) ? { ...i, y: minY } : i))
      );
    } else if (type === 'middle') {
      const avgCy =
        selected.reduce((acc, i) => acc + (i.y + i.height / 2), 0) / selected.length;
      setCanvasItems((prev) =>
        prev.map((i) =>
          selectedItemIds.includes(i.id)
            ? { ...i, y: parseFloat((avgCy - i.height / 2).toFixed(2)) }
            : i
        )
      );
    } else if (type === 'bottom') {
      const maxY = Math.max(...selected.map((i) => i.y + i.height));
      setCanvasItems((prev) =>
        prev.map((i) =>
          selectedItemIds.includes(i.id)
            ? { ...i, y: parseFloat((maxY - i.height).toFixed(2)) }
            : i
        )
      );
    }
  };

  // Distribution Tools
  const handleDistribute = (direction: 'horizontal' | 'vertical') => {
    if (selectedItemIds.length < 3) return;
    const selected = [...canvasItems.filter((i) => selectedItemIds.includes(i.id))];

    if (direction === 'horizontal') {
      selected.sort((a, b) => a.x - b.x);
      const first = selected[0];
      const last = selected[selected.length - 1];
      const step = (last.x - first.x) / (selected.length - 1);

      const posMap = new Map<string, number>();
      selected.forEach((item, idx) => {
        posMap.set(item.id, parseFloat((first.x + idx * step).toFixed(2)));
      });

      setCanvasItems((prev) =>
        prev.map((i) => (posMap.has(i.id) ? { ...i, x: posMap.get(i.id)! } : i))
      );
    } else {
      selected.sort((a, b) => a.y - b.y);
      const first = selected[0];
      const last = selected[selected.length - 1];
      const step = (last.y - first.y) / (selected.length - 1);

      const posMap = new Map<string, number>();
      selected.forEach((item, idx) => {
        posMap.set(item.id, parseFloat((first.y + idx * step).toFixed(2)));
      });

      setCanvasItems((prev) =>
        prev.map((i) => (posMap.has(i.id) ? { ...i, y: posMap.get(i.id)! } : i))
      );
    }
  };

  // Group Nudge & Scale Tools
  const handleGroupNudge = (dx: number, dy: number) => {
    if (selectedItemIds.length === 0) return;
    setCanvasItems((prev) =>
      prev.map((it) => {
        if (selectedItemIds.includes(it.id)) {
          return {
            ...it,
            x: Math.max(0, parseFloat((it.x + dx).toFixed(2))),
            y: Math.max(0, parseFloat((it.y + dy).toFixed(2))),
          };
        }
        return it;
      })
    );
  };

  const handleGroupScaleWidth = (scaleFactorX: number) => {
    if (selectedItemIds.length === 0) return;
    const selected = canvasItems.filter((it) => selectedItemIds.includes(it.id));
    const gBox = getGroupBoundingBox(selected);
    if (!gBox) return;

    setCanvasItems((prev) =>
      prev.map((it) => {
        if (selectedItemIds.includes(it.id)) {
          const relX = it.x - gBox.x;
          const newX = gBox.x + relX * scaleFactorX;
          const newW = it.width * scaleFactorX;

          return {
            ...it,
            x: Math.max(0, parseFloat(newX.toFixed(2))),
            width: Math.max(0.5, parseFloat(newW.toFixed(2))),
          };
        }
        return it;
      })
    );
  };

  const handleGroupScaleHeight = (scaleFactorY: number) => {
    if (selectedItemIds.length === 0) return;
    const selected = canvasItems.filter((it) => selectedItemIds.includes(it.id));
    const gBox = getGroupBoundingBox(selected);
    if (!gBox) return;

    setCanvasItems((prev) =>
      prev.map((it) => {
        if (selectedItemIds.includes(it.id)) {
          const relY = it.y - gBox.y;
          const newY = gBox.y + relY * scaleFactorY;
          const newH = it.height * scaleFactorY;

          return {
            ...it,
            y: Math.max(0, parseFloat(newY.toFixed(2))),
            height: Math.max(0.5, parseFloat(newH.toFixed(2))),
          };
        }
        return it;
      })
    );
  };

  const handleGroupScale = (scaleFactor: number) => {
    if (selectedItemIds.length === 0) return;
    const selected = canvasItems.filter((it) => selectedItemIds.includes(it.id));
    const gBox = getGroupBoundingBox(selected);
    if (!gBox) return;

    setCanvasItems((prev) =>
      prev.map((it) => {
        if (selectedItemIds.includes(it.id)) {
          const relX = it.x - gBox.cx;
          const relY = it.y - gBox.cy;

          const newX = gBox.cx + relX * scaleFactor;
          const newY = gBox.cy + relY * scaleFactor;
          const newW = it.width * scaleFactor;
          const newH = it.height * scaleFactor;

          return {
            ...it,
            x: Math.max(0, parseFloat(newX.toFixed(2))),
            y: Math.max(0, parseFloat(newY.toFixed(2))),
            width: Math.max(0.5, parseFloat(newW.toFixed(2))),
            height: Math.max(0.5, parseFloat(newH.toFixed(2))),
          };
        }
        return it;
      })
    );
  };

  const handleBatchSetWidth = (newW: number) => {
    if (selectedItemIds.length === 0 || isNaN(newW) || newW <= 0) return;
    setCanvasItems((prev) =>
      prev.map((it) =>
        selectedItemIds.includes(it.id) ? { ...it, width: parseFloat(newW.toFixed(2)) } : it
      )
    );
  };

  const handleBatchSetHeight = (newH: number) => {
    if (selectedItemIds.length === 0 || isNaN(newH) || newH <= 0) return;
    setCanvasItems((prev) =>
      prev.map((it) =>
        selectedItemIds.includes(it.id) ? { ...it, height: parseFloat(newH.toFixed(2)) } : it
      )
    );
  };

  const selectedItems = canvasItems.filter((i) => selectedItemIds.includes(i.id));
  const singleSelectedItem = selectedItems.length === 1 ? selectedItems[0] : null;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {/* Top Toolbar */}
      <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 mb-6 shadow-xl flex flex-wrap items-center justify-between gap-4">
        {/* Roll Settings */}
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2 text-xs font-mono text-red-400 bg-red-600/10 px-3 py-1.5 rounded border border-red-500/30 font-bold uppercase">
            <Ruler className="w-4 h-4" />
            <span>Width: <strong>39 Inches</strong></span>
          </div>

          <div className="flex items-center space-x-2">
            <span className="text-xs text-zinc-400 font-mono uppercase">Cut Gap:</span>
            <select
              value={layoutSettings.marginInches}
              onChange={(e) => {
                const margin = parseFloat(e.target.value);
                const updatedSettings = { ...layoutSettings, marginInches: margin };
                setLayoutSettings(updatedSettings);
                if (orders.length > 0) {
                  const result = generateAutoNestingLayout(orders, updatedSettings);
                  setCanvasItems(result.items);
                  setMetrics(result.metrics);
                }
              }}
              className="bg-zinc-950 text-white text-xs px-2.5 py-1.5 rounded border border-zinc-800 focus:outline-none font-mono"
            >
              <option value={0.05}>0.05" Tight (1.2mm)</option>
              <option value={0.10}>0.10" Minimal (2.5mm)</option>
              <option value={0.25}>0.25" Standard (6.3mm)</option>
              <option value={0.35}>0.35" Wide (8.8mm)</option>
            </select>
          </div>

          <div className="flex items-center space-x-2">
            <span className="text-xs text-zinc-400 font-mono uppercase">Sequence:</span>
            <select
              value={layoutSettings.packingMode}
              onChange={(e) => {
                const mode = e.target.value as any;
                const updatedSettings = { ...layoutSettings, packingMode: mode };
                setLayoutSettings(updatedSettings);
                if (orders.length > 0) {
                  const result = generateAutoNestingLayout(orders, updatedSettings);
                  setCanvasItems(result.items);
                  setMetrics(result.metrics);
                }
              }}
              className="bg-zinc-950 text-white text-xs px-2.5 py-1.5 rounded border border-zinc-800 focus:outline-none font-mono"
            >
              <option value="row_by_row_structured">Row-by-Row Names then Numbers</option>
              <option value="paired_order_rows">Paired Order Rows</option>
              <option value="combo_blocks">Compact Shelf Nesting</option>
            </select>
          </div>

          <button
            onClick={() => setLayoutSettings({ ...layoutSettings, showCutLines: !layoutSettings.showCutLines })}
            className={`flex items-center space-x-1.5 text-xs font-semibold uppercase tracking-wider px-3 py-1.5 rounded transition-all ${
              layoutSettings.showCutLines
                ? 'bg-red-600/20 text-red-400 border border-red-500/30'
                : 'bg-zinc-950 text-zinc-400 border border-zinc-800'
            }`}
          >
            <Scissors className="w-3.5 h-3.5" />
            <span>Cut Lines</span>
          </button>

          {/* Smart Digit Unbundling Strategy Selector */}
          <div className="flex items-center space-x-2">
            <span className="text-xs text-amber-400/90 font-mono uppercase flex items-center space-x-1">
              <Split className="w-3.5 h-3.5" />
              <span>Double Digits:</span>
            </span>
            <select
              value={layoutSettings.digitNestingMode || (layoutSettings.splitDigitsForNesting ? 'smart_unbundle' : 'smart_unbundle')}
              onChange={(e) => {
                const mode = e.target.value as DigitNestingMode;
                const updatedSettings: LayoutSettings = {
                  ...layoutSettings,
                  digitNestingMode: mode,
                  splitDigitsForNesting: mode !== 'intact',
                };
                setLayoutSettings(updatedSettings);
                if (orders.length > 0) {
                  const result = generateAutoNestingLayout(orders, updatedSettings);
                  setCanvasItems(result.items);
                  setMetrics(result.metrics);
                  setModificationLogs(result.modificationLogs || []);
                }
              }}
              className="bg-zinc-950 text-amber-300 text-xs px-2.5 py-1.5 rounded border border-amber-500/40 focus:outline-none font-mono font-bold"
              title="Select how double-digit numbers are unbundled and nested to fill empty DTF gap pockets"
            >
              <option value="smart_unbundle">⚡ Smart Gap Fill (Recommended)</option>
              <option value="split_all">🗂️ Split All (Max Density)</option>
              <option value="intact">🔒 Keep Intact (No Split)</option>
            </select>
          </div>

          {/* Modification Tracker Tab Launcher */}
          <button
            onClick={() => setActiveSideTab('tracker')}
            className={`flex items-center space-x-1.5 text-xs font-semibold uppercase tracking-wider px-3 py-1.5 rounded transition-all ${
              activeSideTab === 'tracker'
                ? 'bg-amber-500 text-zinc-950 font-bold shadow-md shadow-amber-500/20'
                : 'bg-zinc-950 text-zinc-300 border border-zinc-800 hover:border-amber-500/50 hover:text-amber-300'
            }`}
            title="Open the Modification Tracker Log Panel"
          >
            <Split className="w-3.5 h-3.5" />
            <span>Modification Log</span>
            {modificationLogs.length > 0 && (
              <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono font-extrabold ${
                activeSideTab === 'tracker' ? 'bg-zinc-950 text-amber-400' : 'bg-amber-500/30 text-amber-300 border border-amber-500/40'
              }`}>
                {modificationLogs.length}
              </span>
            )}
          </button>
        </div>

        {/* Auto Nesting Strategy Buttons */}
        <div className="flex items-center space-x-2">
          <button
            onClick={handleRePack}
            className="flex items-center space-x-2 px-4 py-1.5 bg-red-600 hover:bg-red-500 text-white text-xs font-bold uppercase tracking-wider rounded shadow-lg shadow-red-900/20 transition-all"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Auto Re-Nest Sheet</span>
          </button>
        </div>

        {/* Zoom Controls */}
        <div className="flex items-center space-x-2 bg-zinc-950 p-1 rounded border border-zinc-800">
          <button
            onClick={() => setZoom((z) => Math.max(0.3, z - 0.1))}
            className="p-1.5 text-zinc-400 hover:text-white rounded hover:bg-zinc-800"
            title="Zoom Out"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <span className="text-xs font-mono text-zinc-300 px-2">{Math.round(zoom * 100)}%</span>
          <button
            onClick={() => setZoom((z) => Math.min(1.5, z + 0.1))}
            className="p-1.5 text-zinc-400 hover:text-white rounded hover:bg-zinc-800"
            title="Zoom In"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
          <button
            onClick={() => setZoom(0.65)}
            className="p-1.5 text-zinc-400 hover:text-white rounded hover:bg-zinc-800"
            title="Fit Screen"
          >
            <Maximize2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Main Grid: Interactive Canvas + Item Inspector Side Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start relative">
        {/* Canvas Area */}
        <div className="lg:col-span-8 overflow-x-auto bg-zinc-900 p-6 rounded-xl border border-zinc-800 shadow-2xl flex flex-col items-center">
          {/* Top Ruler Header with Pasteboard Bounds */}
          <div
            className="bg-zinc-950 border border-zinc-800 mb-2 flex items-center justify-between text-[10px] font-mono text-zinc-500 px-3 py-1.5 rounded uppercase shadow-inner"
            style={{ width: `${canvasWidthPx}px` }}
          >
            <span className="text-amber-500/80 font-bold flex items-center space-x-1">
              <span>◄ WEST PASTEBOARD (-10")</span>
            </span>
            <span className="text-red-400 font-bold bg-red-600/10 px-2 py-0.5 rounded border border-red-500/30">
              0.0" (LEFT SHEET EDGE)
            </span>
            <span className="text-zinc-300">19.5" (SHEET CENTER)</span>
            <span className="text-red-400 font-bold bg-red-600/10 px-2 py-0.5 rounded border border-red-500/30">
              39.0" (RIGHT SHEET EDGE)
            </span>
            <span className="text-amber-500/80 font-bold flex items-center space-x-1">
              <span>EAST PASTEBOARD (+10") ►</span>
            </span>
          </div>

          <div
            ref={containerRef}
            className="relative border-2 border-zinc-800 rounded overflow-hidden shadow-2xl bg-[#141418]"
            style={{ width: `${canvasWidthPx}px` }}
          >
            <canvas
              ref={canvasRef}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              className="block"
            />
          </div>

          <div className="text-xs text-zinc-400 mt-3 font-mono space-y-1 bg-zinc-900/60 p-3 rounded-lg border border-zinc-800/80">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
              <span className="flex items-center space-x-1.5 text-zinc-300">
                <kbd className="px-1.5 py-0.5 bg-zinc-950 border border-zinc-700 rounded text-amber-400 font-bold">Shift + Drag</kbd>
                <span>Lock straight horizontal/vertical axis</span>
              </span>
              <span className="flex items-center space-x-1.5 text-zinc-300">
                <kbd className="px-1.5 py-0.5 bg-zinc-950 border border-zinc-700 rounded text-amber-400 font-bold">↑ ↓ ← →</kbd>
                <span>Nudge objects (0.10" or 0.50" with Shift)</span>
              </span>
              <span className="flex items-center space-x-1.5 text-zinc-300">
                <kbd className="px-1.5 py-0.5 bg-zinc-950 border border-zinc-700 rounded text-red-400 font-bold">Delete / Backspace</kbd>
                <span>Remove selected</span>
              </span>
            </div>
            <p className="text-[11px] text-zinc-500 pt-1 border-t border-zinc-800/60 flex items-center space-x-1.5">
              <BoxSelect className="w-3 h-3 text-red-400" />
              <span>Independent Digits: Double digits (e.g., 22) are generated as separate objects side-by-side. Click any individual digit to move or rotate freely.</span>
            </p>
          </div>
        </div>

        {/* Selected Item Inspector Panel - Sticky synchronized alongside viewport scrolling */}
        <div className="lg:col-span-4 space-y-6 lg:sticky lg:top-4 lg:self-start max-h-[calc(100vh-2rem)] overflow-y-auto pr-1">
          {/* Side Panel Tab Selector */}
          <div className="flex items-center space-x-1 bg-zinc-950 p-1 rounded-xl border border-zinc-800 shadow-inner">
            <button
              onClick={() => setActiveSideTab('inspector')}
              className={`flex-1 py-2 px-2.5 rounded-lg text-xs font-bold uppercase tracking-wider font-mono flex items-center justify-center space-x-1.5 transition-all ${
                activeSideTab === 'inspector'
                  ? 'bg-red-600 text-white shadow-lg'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>Inspector</span>
              {selectedItemIds.length > 0 && (
                <span className="text-[9px] px-1.5 py-0.2 bg-zinc-950/80 rounded-full font-bold">
                  {selectedItemIds.length}
                </span>
              )}
            </button>

            <button
              onClick={() => setActiveSideTab('tracker')}
              className={`flex-1 py-2 px-2.5 rounded-lg text-xs font-bold uppercase tracking-wider font-mono flex items-center justify-center space-x-1.5 transition-all ${
                activeSideTab === 'tracker'
                  ? 'bg-amber-500 text-zinc-950 shadow-lg'
                  : 'text-zinc-400 hover:text-amber-300'
              }`}
            >
              <Split className="w-3.5 h-3.5" />
              <span>Modification Log</span>
              {modificationLogs.length > 0 && (
                <span className={`text-[9px] px-1.5 py-0.2 rounded-full font-bold ${
                  activeSideTab === 'tracker' ? 'bg-zinc-950 text-amber-400' : 'bg-amber-500/30 text-amber-300'
                }`}>
                  {modificationLogs.length}
                </span>
              )}
            </button>
          </div>

          {activeSideTab === 'tracker' ? (
            /* Modification Tracker Log Panel */
            <ModificationTrackerPanel
              modificationLogs={modificationLogs}
              canvasItems={canvasItems}
              selectedItemIds={selectedItemIds}
              onSelectItems={handleLocateOnCanvas}
              onMergeDigits={handleMergeFromLog}
              onUnbundleNumber={handleSplitSelectedDigits}
              layoutSettings={layoutSettings}
              onChangeLayoutSettings={(newSettings) => {
                setLayoutSettings(newSettings);
                if (orders.length > 0) {
                  const result = generateAutoNestingLayout(orders, newSettings);
                  setCanvasItems(result.items);
                  setMetrics(result.metrics);
                  setModificationLogs(result.modificationLogs || []);
                }
              }}
              onRePack={handleRePack}
            />
          ) : (
            /* Item Controls Card */
            <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-5 shadow-xl">
            <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center justify-between mb-4 border-b border-zinc-800 pb-3">
              <span className="flex items-center space-x-2">
                <Sliders className="w-4 h-4 text-red-400" />
                <span>Adobe Element Inspector</span>
              </span>
              {selectedItemIds.length > 0 && (
                <span className="text-[10px] font-mono px-2 py-0.5 bg-red-600/10 text-red-400 border border-red-500/30 rounded font-bold">
                  {selectedItemIds.length} SELECTED
                </span>
              )}
            </h3>

            {singleSelectedItem ? (
              /* Single Selection Controls */
              <div className="space-y-4">
                <div className="bg-zinc-950 p-3 rounded-lg border border-zinc-800">
                  <div className="text-[10px] text-zinc-500 uppercase font-mono mb-1">Text Content:</div>
                  <div className="text-lg font-black text-white tracking-wide uppercase">
                    {singleSelectedItem.itemType === 'name' ? singleSelectedItem.customerName : singleSelectedItem.number}
                  </div>
                  <div className="text-xs text-red-400 font-mono mt-1">
                    Design Code: {singleSelectedItem.designCode}
                  </div>
                </div>

                {/* Free Angle Rotation Controls */}
                <div className="bg-zinc-950 p-3 rounded-lg border border-zinc-800 space-y-2">
                  <div className="flex items-center justify-between text-xs font-mono">
                    <span className="text-zinc-400 uppercase text-[10px] font-bold">Free Angle Rotation:</span>
                    <strong className="text-red-400">{singleSelectedItem.rotation || 0}°</strong>
                  </div>

                  <input
                    type="range"
                    min="0"
                    max="360"
                    step="1"
                    value={singleSelectedItem.rotation || 0}
                    onChange={(e) => handleSetSelectedRotation(parseInt(e.target.value) || 0)}
                    className="w-full accent-red-500 cursor-pointer"
                  />

                  <div className="grid grid-cols-4 gap-1 pt-1">
                    {[0, 90, 180, 270].map((angle) => (
                      <button
                        key={angle}
                        onClick={() => handleSetSelectedRotation(angle)}
                        className={`py-1 text-[10px] font-mono font-bold rounded border ${
                          singleSelectedItem.rotation === angle
                            ? 'bg-red-600 text-white border-red-500'
                            : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:text-white'
                        }`}
                      >
                        {angle}°
                      </button>
                    ))}
                  </div>
                </div>

                {/* Digit Splitting Control for Multi-Digit Numbers */}
                {singleSelectedItem.itemType === 'number' && singleSelectedItem.number.replace(/\D/g, '').length > 1 && (
                  <div className="bg-amber-950/30 border border-amber-500/40 p-3 rounded-lg space-y-2">
                    <div className="flex items-center space-x-2 text-amber-300 text-xs font-bold uppercase font-mono">
                      <Split className="w-4 h-4 text-amber-400" />
                      <span>Multi-Digit Number Optimization</span>
                    </div>
                    <p className="text-[10px] text-amber-200/70 font-mono">
                      Split "{singleSelectedItem.number}" into independent movable digits to fill narrow DTF gaps and minimize film waste.
                    </p>
                    <button
                      onClick={() => handleSplitSelectedDigits()}
                      className="w-full py-2 bg-amber-500 hover:bg-amber-400 text-zinc-950 text-xs font-bold uppercase font-mono rounded shadow flex items-center justify-center space-x-1.5 transition-all"
                    >
                      <Split className="w-3.5 h-3.5" />
                      <span>Split into Single Digits</span>
                    </button>
                  </div>
                )}

                {/* Action Buttons */}
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={handleDuplicateSelected}
                    className="flex items-center justify-center space-x-1.5 p-2 bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 rounded text-zinc-200 text-xs font-semibold transition-all"
                  >
                    <Copy className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="text-[10px] uppercase font-mono">Duplicate</span>
                  </button>

                  <button
                    onClick={handleDeleteSelected}
                    className="flex items-center justify-center space-x-1.5 p-2 bg-zinc-950 hover:bg-red-950/40 border border-zinc-800 hover:border-red-500/30 rounded text-zinc-200 hover:text-red-400 text-xs font-semibold transition-all"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-red-400" />
                    <span className="text-[10px] uppercase font-mono">Delete</span>
                  </button>
                </div>

                {/* Manual Position Controls */}
                <div className="grid grid-cols-2 gap-3 bg-zinc-950 p-3 rounded-lg border border-zinc-800 font-mono text-xs">
                  <div>
                    <label className="text-zinc-500 text-[10px] uppercase block mb-1">X Pos (Inches):</label>
                    <input
                      type="number"
                      step="0.1"
                      value={singleSelectedItem.x}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value) || 0;
                        setCanvasItems((prev) =>
                          prev.map((i) => (i.id === singleSelectedItem.id ? { ...i, x: val } : i))
                        );
                      }}
                      className="w-full bg-zinc-900 text-white px-2 py-1 rounded border border-zinc-800 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="text-zinc-500 text-[10px] uppercase block mb-1">Y Pos (Inches):</label>
                    <input
                      type="number"
                      step="0.1"
                      value={singleSelectedItem.y}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value) || 0;
                        setCanvasItems((prev) =>
                          prev.map((i) => (i.id === singleSelectedItem.id ? { ...i, y: val } : i))
                        );
                      }}
                      className="w-full bg-zinc-900 text-white px-2 py-1 rounded border border-zinc-800 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="text-zinc-500 text-[10px] uppercase block mb-1">
                      {singleSelectedItem.itemType === 'name' ? 'Name Width (Inches):' : singleSelectedItem.itemType === 'number' ? 'Number Width (Inches):' : 'Width (Inches):'}
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      value={singleSelectedItem.width}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value) || 1;
                        setCanvasItems((prev) =>
                          prev.map((i) => (i.id === singleSelectedItem.id ? { ...i, width: val } : i))
                        );
                      }}
                      className="w-full bg-zinc-900 text-white px-2 py-1 rounded border border-zinc-800 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="text-zinc-500 text-[10px] uppercase block mb-1">
                      {singleSelectedItem.itemType === 'name' ? 'Name Height (Inches):' : singleSelectedItem.itemType === 'number' ? 'Number Height (Inches):' : 'Height (Inches):'}
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      value={singleSelectedItem.height}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value) || 1;
                        setCanvasItems((prev) =>
                          prev.map((i) => (i.id === singleSelectedItem.id ? { ...i, height: val } : i))
                        );
                      }}
                      className="w-full bg-zinc-900 text-white px-2 py-1 rounded border border-zinc-800 focus:outline-none"
                    />
                  </div>
                </div>
              </div>
            ) : selectedItemIds.length > 1 ? (
              /* Multi Selection Batch Tools */
              <div className="space-y-4 font-mono text-xs">
                {/* Adobe Alignment Palette */}
                <div className="bg-zinc-950 p-3 rounded-lg border border-zinc-800 space-y-2">
                  <span className="text-zinc-400 text-[10px] uppercase font-bold block">
                    Align Selected Elements:
                  </span>
                  <div className="grid grid-cols-6 gap-1">
                    <button
                      onClick={() => handleAlignSelected('left')}
                      className="p-2 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded flex justify-center text-zinc-300 hover:text-white"
                      title="Align Left Edges"
                    >
                      <AlignLeft className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleAlignSelected('center')}
                      className="p-2 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded flex justify-center text-zinc-300 hover:text-white"
                      title="Align Horizontal Center"
                    >
                      <AlignCenter className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleAlignSelected('right')}
                      className="p-2 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded flex justify-center text-zinc-300 hover:text-white"
                      title="Align Right Edges"
                    >
                      <AlignRight className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleAlignSelected('top')}
                      className="p-2 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded flex justify-center text-zinc-300 hover:text-white"
                      title="Align Top Edges"
                    >
                      <AlignStartVertical className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleAlignSelected('middle')}
                      className="p-2 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded flex justify-center text-zinc-300 hover:text-white"
                      title="Align Vertical Center"
                    >
                      <AlignVerticalSpaceAround className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleAlignSelected('bottom')}
                      className="p-2 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded flex justify-center text-zinc-300 hover:text-white"
                      title="Align Bottom Edges"
                    >
                      <AlignEndVertical className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Spacing Distribution */}
                <div className="bg-zinc-950 p-3 rounded-lg border border-zinc-800 space-y-2">
                  <span className="text-zinc-400 text-[10px] uppercase font-bold block">
                    Distribute Equal Spacing:
                  </span>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => handleDistribute('horizontal')}
                      className="p-2 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded text-[10px] font-bold text-zinc-300 hover:text-white uppercase"
                    >
                      Horizontally
                    </button>
                    <button
                      onClick={() => handleDistribute('vertical')}
                      className="p-2 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded text-[10px] font-bold text-zinc-300 hover:text-white uppercase"
                    >
                      Vertically
                    </button>
                  </div>
                </div>

                {/* Unified Group Nudge & Scale Controls */}
                <div className="bg-zinc-950 p-3 rounded-lg border border-zinc-800 space-y-3">
                  <span className="text-zinc-400 text-[10px] uppercase font-bold block">
                    Unified Group Position &amp; Nudge:
                  </span>
                  <div className="grid grid-cols-4 gap-1">
                    <button
                      onClick={() => handleGroupNudge(0, -0.1)}
                      className="py-1 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded text-[10px] font-bold text-zinc-300 hover:text-white"
                    >
                      ↑ Up 0.1"
                    </button>
                    <button
                      onClick={() => handleGroupNudge(0, 0.1)}
                      className="py-1 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded text-[10px] font-bold text-zinc-300 hover:text-white"
                    >
                      ↓ Down 0.1"
                    </button>
                    <button
                      onClick={() => handleGroupNudge(-0.1, 0)}
                      className="py-1 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded text-[10px] font-bold text-zinc-300 hover:text-white"
                    >
                      ← Left 0.1"
                    </button>
                    <button
                      onClick={() => handleGroupNudge(0.1, 0)}
                      className="py-1 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded text-[10px] font-bold text-zinc-300 hover:text-white"
                    >
                      → Right 0.1"
                    </button>
                  </div>

                  {/* Independent Width & Height Group Scaling */}
                  <div className="space-y-2 pt-1 border-t border-zinc-900">
                    <span className="text-cyan-400 text-[10px] uppercase font-bold block">
                      Independent Group Scaling:
                    </span>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="bg-zinc-900/80 p-2 rounded border border-zinc-800 space-y-1">
                        <span className="text-zinc-400 text-[9px] uppercase font-bold block">Group Width Only:</span>
                        <div className="grid grid-cols-2 gap-1">
                          <button
                            onClick={() => handleGroupScaleWidth(0.95)}
                            className="py-1 bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 rounded text-[10px] font-bold text-cyan-400 hover:text-cyan-300"
                          >
                            Width -5%
                          </button>
                          <button
                            onClick={() => handleGroupScaleWidth(1.05)}
                            className="py-1 bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 rounded text-[10px] font-bold text-cyan-400 hover:text-cyan-300"
                          >
                            Width +5%
                          </button>
                        </div>
                      </div>

                      <div className="bg-zinc-900/80 p-2 rounded border border-zinc-800 space-y-1">
                        <span className="text-zinc-400 text-[9px] uppercase font-bold block">Group Height Only:</span>
                        <div className="grid grid-cols-2 gap-1">
                          <button
                            onClick={() => handleGroupScaleHeight(0.95)}
                            className="py-1 bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 rounded text-[10px] font-bold text-cyan-400 hover:text-cyan-300"
                          >
                            Height -5%
                          </button>
                          <button
                            onClick={() => handleGroupScaleHeight(1.05)}
                            className="py-1 bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 rounded text-[10px] font-bold text-cyan-400 hover:text-cyan-300"
                          >
                            Height +5%
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 pt-1">
                      <button
                        onClick={() => handleGroupScale(0.95)}
                        className="py-1.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded text-[10px] font-bold text-amber-400 hover:text-amber-300"
                      >
                        Uniform Scale (-5%)
                      </button>
                      <button
                        onClick={() => handleGroupScale(1.05)}
                        className="py-1.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded text-[10px] font-bold text-amber-400 hover:text-amber-300"
                      >
                        Uniform Scale (+5%)
                      </button>
                    </div>
                  </div>

                  {/* Batch Set Exact Dimensions */}
                  <div className="space-y-2 pt-2 border-t border-zinc-900">
                    <span className="text-zinc-400 text-[10px] uppercase font-bold block">
                      Batch Dimension Inputs:
                    </span>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-zinc-500 text-[9px] uppercase block mb-1">Set Width (All):</label>
                        <div className="flex space-x-1">
                          <input
                            type="number"
                            step="0.25"
                            placeholder='14.0"'
                            id="batch-width-input"
                            className="w-full bg-zinc-900 text-white px-2 py-1 rounded border border-zinc-800 text-xs focus:outline-none"
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                const val = parseFloat((e.target as HTMLInputElement).value);
                                if (!isNaN(val)) handleBatchSetWidth(val);
                              }
                            }}
                          />
                        </div>
                      </div>
                      <div>
                        <label className="text-zinc-500 text-[9px] uppercase block mb-1">Set Height (All):</label>
                        <div className="flex space-x-1">
                          <input
                            type="number"
                            step="0.25"
                            placeholder='2.5"'
                            id="batch-height-input"
                            className="w-full bg-zinc-900 text-white px-2 py-1 rounded border border-zinc-800 text-xs focus:outline-none"
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                const val = parseFloat((e.target as HTMLInputElement).value);
                                if (!isNaN(val)) handleBatchSetHeight(val);
                              }
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Batch Digit Optimization (Split / Merge) */}
                {(() => {
                  const selItems = canvasItems.filter((i) => selectedItemIds.includes(i.id));
                  const multiDigitNumbers = selItems.filter((i) => i.itemType === 'number' && i.number.replace(/\D/g, '').length > 1);
                  const selectedNumbers = selItems.filter((i) => i.itemType === 'number');

                  if (multiDigitNumbers.length === 0 && selectedNumbers.length < 2) return null;

                  return (
                    <div className="bg-amber-950/30 border border-amber-500/40 p-3 rounded-lg space-y-2">
                      <div className="flex items-center space-x-2 text-amber-300 text-xs font-bold uppercase font-mono">
                        <Split className="w-4 h-4 text-amber-400" />
                        <span>Digit Splitting &amp; Merging</span>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        {multiDigitNumbers.length > 0 && (
                          <button
                            onClick={() => handleSplitSelectedDigits()}
                            className="py-1.5 px-2 bg-amber-500 hover:bg-amber-400 text-zinc-950 text-[10px] font-bold uppercase font-mono rounded shadow flex items-center justify-center space-x-1"
                            title="Split all selected multi-digit numbers into independent digits"
                          >
                            <Unlink className="w-3.5 h-3.5" />
                            <span>Split Digits ({multiDigitNumbers.length})</span>
                          </button>
                        )}

                        {selectedNumbers.length >= 2 && (
                          <button
                            onClick={handleMergeSelectedDigits}
                            className="py-1.5 px-2 bg-emerald-500 hover:bg-emerald-400 text-zinc-950 text-[10px] font-bold uppercase font-mono rounded shadow flex items-center justify-center space-x-1"
                            title="Merge selected single digits left-to-right into a single number item"
                          >
                            <Link className="w-3.5 h-3.5" />
                            <span>Merge Digits ({selectedNumbers.length})</span>
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })()}

                {/* Batch Free Angle Rotation */}
                <div className="bg-zinc-950 p-3 rounded-lg border border-zinc-800 space-y-2">
                  <span className="text-zinc-400 text-[10px] uppercase font-bold block">
                    Batch Angle Rotation:
                  </span>
                  <div className="grid grid-cols-4 gap-1">
                    {[0, 90, 180, 270].map((angle) => (
                      <button
                        key={angle}
                        onClick={() => handleSetSelectedRotation(angle)}
                        className="py-1 text-[10px] font-mono font-bold bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded text-zinc-300"
                      >
                        {angle}°
                      </button>
                    ))}
                  </div>
                </div>

                {/* Batch Actions */}
                <div className="grid grid-cols-2 gap-2 pt-2">
                  <button
                    onClick={handleDuplicateSelected}
                    className="py-2 bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 rounded text-emerald-400 text-[10px] font-bold uppercase flex items-center justify-center space-x-1"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span>Duplicate All</span>
                  </button>

                  <button
                    onClick={handleDeleteSelected}
                    className="py-2 bg-zinc-950 hover:bg-red-950/40 border border-zinc-800 text-red-400 text-[10px] font-bold uppercase flex items-center justify-center space-x-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Delete All</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="bg-zinc-950 p-8 rounded-lg border border-dashed border-zinc-800 text-center">
                <MousePointer className="w-8 h-8 text-zinc-600 mx-auto mb-2" />
                <p className="text-xs text-zinc-400 font-bold uppercase tracking-wider">No Element Selected</p>
                <p className="text-[11px] text-zinc-500 mt-1 font-mono">
                  Click or drag a selection marquee box over elements to inspect, move, or rotate.
                </p>
              </div>
            )}
          </div>
          )}

          {/* Roll Print Metrics Dashboard */}
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-5 shadow-xl font-mono text-xs space-y-3">
            <h3 className="text-xs font-bold text-zinc-300 uppercase tracking-wider mb-2 flex items-center justify-between">
              <span>DTF Roll Print Stats</span>
              <span className="text-red-400">39" Width</span>
            </h3>

            <div className="grid grid-cols-2 gap-3">
              <div className="bg-zinc-950 p-3 rounded-lg border border-zinc-800">
                <div className="text-[10px] text-zinc-500 uppercase">Roll Height</div>
                <div className="text-lg font-black text-white mt-0.5">
                  {metrics.totalRollLengthInches}" <span className="text-xs text-zinc-500 font-normal">({metrics.totalRollLengthMeters}m)</span>
                </div>
              </div>

              <div className="bg-zinc-950 p-3 rounded-lg border border-zinc-800">
                <div className="text-[10px] text-zinc-500 uppercase">Efficiency %</div>
                <div className="text-lg font-black text-emerald-400 mt-0.5">
                  {metrics.efficiencyPercentage}%
                </div>
              </div>
            </div>

            <div className="bg-zinc-950 p-3 rounded-lg border border-zinc-800 space-y-1.5 text-zinc-400">
              <div className="flex justify-between">
                <span>Total Items Packed:</span>
                <strong className="text-white">{metrics.totalNamesCount} Names / {metrics.totalNumbersCount} Numbers</strong>
              </div>
              <div className="flex justify-between">
                <span>Film Waste:</span>
                <strong className="text-amber-400">{metrics.wastePercentage}%</strong>
              </div>
              <div className="flex justify-between">
                <span>Est. Print Time:</span>
                <strong className="text-red-400">~{metrics.estimatedPrintTimeMinutes} Mins</strong>
              </div>
              <div className="flex justify-between border-t border-zinc-800 pt-1.5 mt-1.5">
                <span>Est. Film Cost:</span>
                <strong className="text-emerald-400">${metrics.estimatedFilmCostUSD} USD</strong>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
