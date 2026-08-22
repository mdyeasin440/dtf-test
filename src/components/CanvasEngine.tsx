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
} from 'lucide-react';
import { CanvasItem, LayoutSettings, RollMetrics } from '../types';
import { renderItemToCanvas, addImageLoadListener } from '../utils/canvasRenderer';
import { checkCollisions, generateAutoNestingLayout } from '../utils/nestingEngine';

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
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [activeResizeHandle, setActiveResizeHandle] = useState<'nw' | 'ne' | 'sw' | 'se' | null>(null);
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

        ctx.save();
        ctx.strokeStyle = '#06b6d4';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 3]);
        ctx.strokeRect(gx - 4, gy - 4, gw + 8, gh + 8);

        const handleSize = Math.max(8, pixelsPerInch * 0.15);
        ctx.fillStyle = '#06b6d4';
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;

        const handles = [
          [gx - 4, gy - 4],
          [gx + gw + 4, gy - 4],
          [gx - 4, gy + gh + 4],
          [gx + gw + 4, gy + gh + 4],
        ];
        handles.forEach(([hx, hy]) => {
          ctx.fillRect(hx - handleSize / 2, hy - handleSize / 2, handleSize, handleSize);
          ctx.strokeRect(hx - handleSize / 2, hy - handleSize / 2, handleSize, handleSize);
        });

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
  ]);

  // Helper to check if click/mouse hit a corner resize handle
  const getHitResizeHandle = (
    clickX: number,
    clickY: number
  ): { handle: 'nw' | 'ne' | 'sw' | 'se'; item?: CanvasItem; gBox?: any } | null => {
    const handleHitRadius = Math.max(0.40, 12 / pixelsPerInch);

    if (selectedItemIds.length === 1) {
      const it = canvasItems.find((i) => i.id === selectedItemIds[0]);
      if (!it || it.locked) return null;

      const corners: { handle: 'nw' | 'ne' | 'sw' | 'se'; x: number; y: number }[] = [
        { handle: 'nw', x: it.x, y: it.y },
        { handle: 'ne', x: it.x + it.width, y: it.y },
        { handle: 'sw', x: it.x, y: it.y + it.height },
        { handle: 'se', x: it.x + it.width, y: it.y + it.height },
      ];

      for (const c of corners) {
        const dist = Math.hypot(clickX - c.x, clickY - c.y);
        if (dist <= handleHitRadius) {
          return { handle: c.handle, item: it };
        }
      }
    } else if (selectedItemIds.length > 1) {
      const selectedList = canvasItems.filter((i) => selectedItemIds.includes(i.id));
      const gBox = getGroupBoundingBox(selectedList);
      if (!gBox) return null;

      const corners: { handle: 'nw' | 'ne' | 'sw' | 'se'; x: number; y: number }[] = [
        { handle: 'nw', x: gBox.x, y: gBox.y },
        { handle: 'ne', x: gBox.x + gBox.width, y: gBox.y },
        { handle: 'sw', x: gBox.x, y: gBox.y + gBox.height },
        { handle: 'se', x: gBox.x + gBox.width, y: gBox.y + gBox.height },
      ];

      for (const c of corners) {
        const dist = Math.hypot(clickX - c.x, clickY - c.y);
        if (dist <= handleHitRadius) {
          return { handle: c.handle, gBox };
        }
      }
    }

    return null;
  };

  // Handle Mouse Down & Interactive Selection / Corner Resizing
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const clickX = (e.clientX - rect.left) / pixelsPerInch - PASTEBOARD_MARGIN_X;
    const clickY = (e.clientY - rect.top) / pixelsPerInch - PASTEBOARD_MARGIN_Y;

    // 1. Check if user clicked on a corner resize handle of an active selection
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

    // Update cursor icon based on hover
    if (!isDragging && !isResizing && !selectionBox) {
      const hitHandle = getHitResizeHandle(mouseX, mouseY);
      if (hitHandle) {
        if (hitHandle.handle === 'nw' || hitHandle.handle === 'se') {
          canvas.style.cursor = 'nwse-resize';
        } else {
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

    // Handle corner resizing
    if (isResizing && activeResizeHandle && initialResizeState) {
      if (initialResizeState.singleItem) {
        const init = initialResizeState.singleItem;
        let newX = init.x;
        let newY = init.y;
        let newW = init.width;
        let newH = init.height;

        if (activeResizeHandle === 'se') {
          newW = Math.max(0.5, mouseX - init.x);
          newH = Math.max(0.5, mouseY - init.y);
        } else if (activeResizeHandle === 'sw') {
          newW = Math.max(0.5, init.x + init.width - mouseX);
          newX = mouseX;
          newH = Math.max(0.5, mouseY - init.y);
        } else if (activeResizeHandle === 'ne') {
          newW = Math.max(0.5, mouseX - init.x);
          newH = Math.max(0.5, init.y + init.height - mouseY);
          newY = mouseY;
        } else if (activeResizeHandle === 'nw') {
          newW = Math.max(0.5, init.x + init.width - mouseX);
          newX = mouseX;
          newH = Math.max(0.5, init.y + init.height - mouseY);
          newY = mouseY;
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

        if (activeResizeHandle === 'se') {
          newGW = Math.max(1, mouseX - gBox.x);
          newGH = Math.max(1, mouseY - gBox.y);
        } else if (activeResizeHandle === 'sw') {
          newGW = Math.max(1, gBox.x + gBox.width - mouseX);
          newGH = Math.max(1, mouseY - gBox.y);
        } else if (activeResizeHandle === 'ne') {
          newGW = Math.max(1, mouseX - gBox.x);
          newGH = Math.max(1, gBox.y + gBox.height - mouseY);
        } else if (activeResizeHandle === 'nw') {
          newGW = Math.max(1, gBox.x + gBox.width - mouseX);
          newGH = Math.max(1, gBox.y + gBox.height - mouseY);
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
              x: parseFloat((gBox.x + relX * scaleX).toFixed(2)),
              y: parseFloat((gBox.y + relY * scaleY).toFixed(2)),
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
      const dx = mouseX - dragStartPos.x;
      const dy = mouseY - dragStartPos.y;

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

  // Re-Pack Layout Handler
  const handleRePack = () => {
    if (orders.length === 0) return;
    const result = generateAutoNestingLayout(orders, layoutSettings);
    setCanvasItems(result.items);
    setMetrics(result.metrics);
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

          <p className="text-xs text-zinc-500 mt-3 flex items-center space-x-2 font-mono">
            <BoxSelect className="w-3.5 h-3.5 text-red-400" />
            <span>Illustrator Pasteboard Workspace: Park extra items outside the 39" sheet box, or drag items into the active sheet. Drag corners to resize/squeeze elements.</span>
          </p>
        </div>

        {/* Selected Item Inspector Panel - Sticky synchronized alongside viewport scrolling */}
        <div className="lg:col-span-4 space-y-6 lg:sticky lg:top-4 lg:self-start max-h-[calc(100vh-2rem)] overflow-y-auto pr-1">
          {/* Item Controls Card */}
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
