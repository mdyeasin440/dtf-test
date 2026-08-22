import { CanvasItem, LayoutSettings } from '../types';
import { getCachedAssetAspectRatio, registerAssetAspectRatio } from './textMeasurement';

export function renderItemToCanvas(
  ctx: CanvasRenderingContext2D,
  item: CanvasItem,
  scale: number, // pixels per inch
  options: { showCutLines?: boolean; cutLineColor?: string; isSelected?: boolean; hasCollision?: boolean } = {}
) {
  const { preset } = item;
  const rotationDeg = item.rotation || 0;

  // Real world dimensions in pixels
  const itemWPx = item.width * scale;
  const itemHPx = item.height * scale;
  const itemXPx = item.x * scale;
  const itemYPx = item.y * scale;

  ctx.save();

  // Translate to center of item for free angle rotation
  const cx = itemXPx + itemWPx / 2;
  const cy = itemYPx + itemHPx / 2;

  ctx.translate(cx, cy);
  if (rotationDeg !== 0) {
    ctx.rotate((rotationDeg * Math.PI) / 180);
  }
  ctx.translate(-itemWPx / 2, -itemHPx / 2);

  // Draw background border / collision box or cut mark box
  if (options.showCutLines) {
    ctx.strokeStyle = options.cutLineColor || '#38bdf8';
    ctx.lineWidth = Math.max(1, 0.02 * scale);
    ctx.setLineDash([4 * (scale / 20), 4 * (scale / 20)]);
    ctx.strokeRect(0, 0, itemWPx, itemHPx);
    ctx.setLineDash([]);
  }

  if (options.hasCollision) {
    ctx.fillStyle = 'rgba(239, 68, 68, 0.25)';
    ctx.fillRect(0, 0, itemWPx, itemHPx);
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, itemWPx, itemHPx);
  } else if (options.isSelected) {
    ctx.strokeStyle = '#06b6d4'; // Cyan highlight
    ctx.lineWidth = Math.max(2, 0.04 * scale);
    ctx.strokeRect(-2, -2, itemWPx + 4, itemHPx + 4);

    // Corner transform handles (Adobe Illustrator style)
    const handleSize = Math.max(6, scale * 0.12);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#06b6d4';
    ctx.lineWidth = 1.5;

    const handles = [
      [-2, -2],
      [itemWPx + 2, -2],
      [-2, itemHPx + 2],
      [itemWPx + 2, itemHPx + 2],
    ];
    handles.forEach(([hx, hy]) => {
      ctx.fillRect(hx - handleSize / 2, hy - handleSize / 2, handleSize, handleSize);
      ctx.strokeRect(hx - handleSize / 2, hy - handleSize / 2, handleSize, handleSize);
    });
  }

  // Render text content
  if (item.itemType === 'name') {
    renderNameText(ctx, item.customerName, preset, itemWPx, itemHPx, scale);
  } else if (item.itemType === 'number') {
    renderNumberText(ctx, item.number, preset, itemWPx, itemHPx, scale);
  }

  ctx.restore();
}

function renderNameText(
  ctx: CanvasRenderingContext2D,
  text: string,
  preset: any,
  wPx: number,
  hPx: number,
  scale: number
) {
  if (!text) return;

  const fontName = preset.fontFamily || 'Oswald';
  const textColor = preset.textColor || '#FFFFFF';
  const strokeColor = preset.strokeColor || '#000000';

  // Strict stroke check: only stroke if explicitly defined and > 0
  const hasStroke = typeof preset.strokeWidth === 'number' && preset.strokeWidth > 0;
  const rawStrokeWidth = hasStroke ? preset.strokeWidth : 0;
  const strokeWidthPx = rawStrokeWidth * (scale / 30);

  // Mode A: Dual Mode Check - Stitch Custom A-Z PNG Letter Assets if available
  const letterAssets = preset.letterAssets || {};
  const upperText = text.toUpperCase();
  const chars = upperText.split('');
  const hasLetterAssets = chars.some((c) => c !== ' ' && Boolean(letterAssets[c]));

  const userSpacing = typeof preset.letterSpacing === 'number' ? preset.letterSpacing : 3;
  const letterGapPx = Math.max(2, userSpacing * (scale / 30));

  if (hasLetterAssets) {
    const spaceWidthPx = hPx * 0.20;
    const charWidths: number[] = [];
    let rawTotalW = 0;

    chars.forEach((c, i) => {
      if (c === ' ') {
        charWidths.push(spaceWidthPx);
        rawTotalW += spaceWidthPx;
      } else {
        const url = letterAssets[c];
        const img = url ? getLoadedImage(url) : null;
        let cW = 0;
        if (img && img.naturalWidth && img.naturalHeight) {
          cW = hPx * (img.naturalWidth / img.naturalHeight);
        } else {
          const cachedRatio = url ? getCachedAssetAspectRatio(url) : null;
          if (cachedRatio) {
            cW = hPx * cachedRatio;
          } else {
            const defaultRatio = c === 'I' ? 0.18 : c === 'W' || c === 'M' ? 0.52 : c === 'J' || c === 'L' ? 0.30 : 0.35;
            cW = hPx * defaultRatio;
          }
        }
        charWidths.push(cW);
        rawTotalW += cW + (i < chars.length - 1 ? letterGapPx : 0);
      }
    });

    const scaleX = rawTotalW > 0 ? (wPx / rawTotalW) : 1.0;
    const actualTotalW = rawTotalW * scaleX;
    const startX = Math.max(0, (wPx - actualTotalW) / 2);

    let curX = startX;

    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    if (preset.textEffect === 'arc') {
      const arcRad = ((preset.arcAmount || 15) * Math.PI) / 180;
      const radius = wPx / (2 * Math.sin(arcRad / 2 || 0.2));
      const totalAngle = arcRad;
      const startAngle = -totalAngle / 2;
      const angleStep = totalAngle / Math.max(1, chars.length - 1);
      const centerX = wPx / 2;
      const centerY = hPx / 2;

      chars.forEach((c, idx) => {
        const cW = charWidths[idx] * scaleX;
        const angle = startAngle + idx * angleStep;

        ctx.save();
        ctx.translate(
          centerX + radius * Math.sin(angle),
          centerY + radius * (1 - Math.cos(angle))
        );
        ctx.rotate(angle);

        if (c !== ' ') {
          const url = letterAssets[c];
          if (url) {
            const img = getLoadedImage(url);
            if (img && img.complete && img.naturalWidth > 0) {
              ctx.drawImage(img, -cW / 2, -hPx / 2, cW, hPx);
            } else {
              ctx.fillStyle = textColor;
              ctx.font = `700 ${hPx * 0.85}px "${fontName}", sans-serif`;
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              ctx.fillText(c, 0, 0);
            }
          } else {
            ctx.fillStyle = textColor;
            ctx.font = `700 ${hPx * 0.85}px "${fontName}", sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(c, 0, 0);
          }
        }
        ctx.restore();
      });
    } else {
      let curX = startX;
      chars.forEach((c, i) => {
        const cW = charWidths[i] * scaleX;
        if (c !== ' ') {
          const url = letterAssets[c];
          if (url) {
            const img = getLoadedImage(url);
            if (img && img.complete && img.naturalWidth > 0) {
              ctx.drawImage(img, curX, 0, cW, hPx);
            } else {
              ctx.fillStyle = textColor;
              ctx.font = `700 ${hPx * 0.85}px "${fontName}", sans-serif`;
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              ctx.fillText(c, curX + cW / 2, hPx / 2);
            }
          } else {
            ctx.fillStyle = textColor;
            ctx.font = `700 ${hPx * 0.85}px "${fontName}", sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(c, curX + cW / 2, hPx / 2);
          }
        }
        curX += cW + letterGapPx * scaleX;
      });
    }

    ctx.restore();
    return;
  }

  // Mode B: Standard Live Custom Font Rendering (.ttf/.woff or google font)
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  if ('textRendering' in ctx) {
    (ctx as any).textRendering = 'geometricPrecision';
  }
  if ('letterSpacing' in ctx) {
    (ctx as any).letterSpacing = `${letterGapPx}px`;
  }

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const fontRatio = 0.95; // Exact physical cap-height fit
  const fontSize = hPx * fontRatio;
  ctx.font = `700 ${fontSize}px "${fontName}", "Bebas Neue", "Oswald", sans-serif`;

  const centerX = wPx / 2;
  const centerY = hPx / 2;

  if (preset.textEffect === 'arc') {
    const arcRad = ((preset.arcAmount || 12) * Math.PI) / 180;
    const radius = wPx / (2 * Math.sin(arcRad / 2 || 0.2));
    const chars = text.split('');
    const totalAngle = arcRad;
    const startAngle = -totalAngle / 2;
    const angleStep = totalAngle / Math.max(1, chars.length - 1);

    chars.forEach((char, idx) => {
      const angle = startAngle + idx * angleStep;
      ctx.save();
      ctx.translate(
        centerX + radius * Math.sin(angle),
        centerY + radius * (1 - Math.cos(angle))
      );
      ctx.rotate(angle);

      // 1. Draw Fill FIRST (preserves inner stencil gaps and cutouts)
      ctx.fillStyle = textColor;
      ctx.fillText(char, 0, 0);

      // 2. Draw Outer Stroke ONLY IF rawStrokeWidth > 0
      if (strokeWidthPx > 0) {
        ctx.save();
        ctx.globalCompositeOperation = 'destination-over';
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = strokeWidthPx * 2;
        ctx.lineJoin = 'miter';
        ctx.miterLimit = 2;
        ctx.strokeText(char, 0, 0);
        ctx.restore();
      }

      ctx.restore();
    });
  } else {
    // Straight text - Exact Adobe Illustrator envelope scaling
    const metrics = ctx.measureText(text);
    const measuredW = metrics.width || 1;
    // Scale text precisely to match physical box bounds without forced artificial compression
    const scaleX = measuredW > 0 ? (wPx / measuredW) : 1.0;

    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.scale(scaleX, 1);

    // 1. Draw Fill FIRST (preserves stencil gaps & cutouts completely unfilled)
    ctx.fillStyle = textColor;
    ctx.fillText(text, 0, 0);

    // 2. Optional Inner Outline Accent
    if (preset.hasInnerOutline && preset.innerOutlineColor) {
      ctx.save();
      ctx.strokeStyle = preset.innerOutlineColor;
      ctx.lineWidth = Math.min(strokeWidthPx * 0.4, fontSize * 0.02);
      ctx.lineJoin = 'miter';
      ctx.miterLimit = 2;
      ctx.strokeText(text, 0, 0);
      ctx.restore();
    }

    // 3. Draw Outer Stroke ONLY IF strokeWidthPx > 0
    if (strokeWidthPx > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'destination-over';
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = strokeWidthPx * 2;
      ctx.lineJoin = 'miter';
      ctx.miterLimit = 2;
      ctx.strokeText(text, 0, 0);
      ctx.restore();
    }

    ctx.restore();
  }

  ctx.restore();
}

const imageCache = new Map<string, HTMLImageElement>();
const imageLoadListeners = new Set<() => void>();

export function addImageLoadListener(listener: () => void): () => void {
  imageLoadListeners.add(listener);
  return () => {
    imageLoadListeners.delete(listener);
  };
}

function notifyImageLoaded() {
  imageLoadListeners.forEach((fn) => {
    try {
      fn();
    } catch (_) {}
  });
}

function getLoadedImage(url: string): HTMLImageElement | null {
  if (!url) return null;

  if (imageCache.has(url)) {
    const img = imageCache.get(url)!;
    if (img.complete && img.naturalWidth > 0 && img.naturalHeight > 0) {
      registerAssetAspectRatio(url, img.naturalWidth / img.naturalHeight);
      return img;
    }
    return img;
  }

  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    if (img.naturalWidth > 0 && img.naturalHeight > 0) {
      registerAssetAspectRatio(url, img.naturalWidth / img.naturalHeight);
    }
    notifyImageLoaded();
  };
  img.onerror = () => {
    // Retry once without crossOrigin if CORS was blocked
    if (img.crossOrigin) {
      const retryImg = new Image();
      retryImg.onload = () => {
        if (retryImg.naturalWidth > 0 && retryImg.naturalHeight > 0) {
          registerAssetAspectRatio(url, retryImg.naturalWidth / retryImg.naturalHeight);
        }
        imageCache.set(url, retryImg);
        notifyImageLoaded();
      };
      retryImg.src = url;
    }
  };
  img.src = url;
  imageCache.set(url, img);
  return img;
}

function renderNumberText(
  ctx: CanvasRenderingContext2D,
  numberStr: string,
  preset: any,
  wPx: number,
  hPx: number,
  scale: number
) {
  if (!numberStr) return;

  const numberAssets = preset.numberAssets;
  const digits = numberStr.replace(/[^0-9]/g, '').split('');

  // Check if we have PNG/SVG assets for the digits
  const hasCustomAssets =
    numberAssets &&
    digits.length > 0 &&
    digits.every((d) => Boolean(numberAssets[d]));

  if (hasCustomAssets) {
    // Render using uploaded 0-9 PNG/SVG assets maintaining true individual aspect ratios
    const count = digits.length;
    const gapPx = count > 1 ? 0.03 * hPx : 0;

    const charWidths: number[] = [];
    let rawTotalW = 0;

    digits.forEach((digitChar, i) => {
      const assetUrl = numberAssets[digitChar];
      const img = assetUrl ? getLoadedImage(assetUrl) : null;
      let cW = hPx * (digitChar === '1' ? 0.25 : digitChar === '4' ? 0.44 : 0.38);

      if (img && img.complete && img.naturalWidth > 0 && img.naturalHeight > 0) {
        cW = hPx * (img.naturalWidth / img.naturalHeight);
      } else {
        const cachedRatio = assetUrl ? getCachedAssetAspectRatio(assetUrl) : null;
        if (cachedRatio) {
          cW = hPx * cachedRatio;
        } else if (assetUrl && assetUrl.startsWith('data:image/svg+xml')) {
          const match = assetUrl.match(/viewBox=["']0 0 ([\d.]+) ([\d.]+)["']/);
          if (match) {
            const svgW = parseFloat(match[1]);
            const svgH = parseFloat(match[2]);
            if (svgW && svgH) cW = hPx * (svgW / svgH);
          }
        }
      }

      charWidths.push(cW);
      rawTotalW += cW + (i < count - 1 ? gapPx : 0);
    });

    const scaleX = rawTotalW > 0 ? (wPx / rawTotalW) : 1.0;
    const actualTotalW = rawTotalW * scaleX;
    const startX = Math.max(0, (wPx - actualTotalW) / 2);

    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    let curX = startX;
    digits.forEach((digitChar, i) => {
      const dW = charWidths[i] * scaleX;
      const assetUrl = numberAssets[digitChar];
      if (assetUrl) {
        const img = getLoadedImage(assetUrl);
        if (img && img.complete && img.naturalWidth > 0) {
          ctx.drawImage(img, curX, 0, dW, hPx);
        } else {
          // Fallback box while image loads
          ctx.fillStyle = preset.textColor || '#FFFFFF';
          ctx.fillRect(curX, 0, dW, hPx);
        }
      }
      curX += dW + (gapPx * scaleX);
    });

    ctx.restore();
    return;
  }

  // Fallback to font rendering if no custom PNG assets are uploaded for these digits
  const style = preset.numberStyle || {};
  const fontName = style.fontFamily || preset.fontFamily || 'Oswald';
  const fillColor = preset.textColor || style.fillColor || '#FFFFFF';
  const strokeColor = preset.strokeColor || style.strokeColor || '#000000';

  // Strict stroke check
  const numStrokeVal = typeof style.strokeWidth === 'number' ? style.strokeWidth : preset.strokeWidth;
  const hasStroke = typeof numStrokeVal === 'number' && numStrokeVal > 0;
  const rawStrokeWidth = hasStroke ? numStrokeVal : 0;
  const strokeWidthPx = rawStrokeWidth * (scale / 30);

  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  if ('textRendering' in ctx) {
    (ctx as any).textRendering = 'geometricPrecision';
  }

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const fontRatio = 0.95;
  const fontSize = hPx * fontRatio;
  ctx.font = `900 ${fontSize}px "${fontName}", "Bebas Neue", "Anton", sans-serif`;

  const centerX = wPx / 2;
  const centerY = hPx / 2;

  // Measure actual text width at exact physical height
  const metrics = ctx.measureText(numberStr);
  const measuredW = metrics.width || 1;
  const scaleX = measuredW > 0 ? (wPx / measuredW) : 1.0;

  ctx.save();
  ctx.translate(centerX, centerY);
  ctx.scale(scaleX, 1);

  // 1. Draw Fill FIRST (preserves stencil gaps & cutouts)
  ctx.fillStyle = fillColor;
  ctx.fillText(numberStr, 0, 0);

  // 2. Draw Outer Stroke ONLY IF strokeWidthPx > 0
  if (strokeWidthPx > 0) {
    ctx.save();
    ctx.globalCompositeOperation = 'destination-over';
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = strokeWidthPx * 2;
    ctx.lineJoin = 'miter';
    ctx.miterLimit = 2;
    ctx.strokeText(numberStr, 0, 0);
    ctx.restore();
  }

  ctx.restore();
  ctx.restore();
}

function renderBadgeIcon(
  ctx: CanvasRenderingContext2D,
  badgeType: string,
  x: number,
  y: number,
  size: number,
  color: string
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;

  if (badgeType === 'lion') {
    // Premier league lion icon silhouette
    ctx.beginPath();
    ctx.arc(0, 0, size / 2, 0, Math.PI * 2);
    ctx.fill();
  } else if (badgeType === 'star') {
    // World Cup star
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      ctx.lineTo(
        Math.cos(((18 + i * 72) * Math.PI) / 180) * size,
        -Math.sin(((18 + i * 72) * Math.PI) / 180) * size
      );
      ctx.lineTo(
        Math.cos(((54 + i * 72) * Math.PI) / 180) * (size / 2.2),
        -Math.sin(((54 + i * 72) * Math.PI) / 180) * (size / 2.2)
      );
    }
    ctx.closePath();
    ctx.fill();
  } else if (badgeType === 'shield' || badgeType === 'crest') {
    // Shield crest
    ctx.beginPath();
    ctx.moveTo(-size / 2, -size / 2);
    ctx.lineTo(size / 2, -size / 2);
    ctx.lineTo(size / 2, 0);
    ctx.quadraticCurveTo(size / 2, size / 2, 0, size * 0.7);
    ctx.quadraticCurveTo(-size / 2, size / 2, -size / 2, 0);
    ctx.closePath();
    ctx.stroke();
  }

  ctx.restore();
}

/**
 * Preload all external images/assets and await font readiness before high-res export
 */
export async function preloadCanvasAssets(items: CanvasItem[]): Promise<void> {
  if (typeof document !== 'undefined' && document.fonts && document.fonts.ready) {
    try {
      await document.fonts.ready;
    } catch (err) {
      console.warn('Font readiness check skipped:', err);
    }
  }

  const urlsToPreload = new Set<string>();
  items.forEach((item) => {
    const { preset } = item;
    if (preset) {
      if (preset.letterAssets) {
        Object.values(preset.letterAssets).forEach((url) => {
          if (typeof url === 'string' && url) urlsToPreload.add(url as string);
        });
      }
      if (preset.numberAssets) {
        Object.values(preset.numberAssets).forEach((url) => {
          if (typeof url === 'string' && url) urlsToPreload.add(url as string);
        });
      }
    }
  });

  if (urlsToPreload.size === 0) return;

  const loadPromises = Array.from(urlsToPreload).map((url) => {
    return new Promise<void>((resolve) => {
      if (imageCache.has(url)) {
        const cached = imageCache.get(url)!;
        if (cached.complete && cached.naturalWidth > 0) {
          return resolve();
        }
      }
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve();
      img.onerror = () => resolve();
      img.src = url;
      imageCache.set(url, img);
    });
  });

  await Promise.all(loadPromises);
}

/**
 * Render complete 39" Roll Canvas to an Offscreen or High-Res Canvas at 300 DPI
 * Optimized with asset pre-caching and chunked async processing to prevent UI freezing on heavy files
 */
export async function generateHighResDtfCanvas(
  items: CanvasItem[],
  settings: LayoutSettings,
  targetDpi: number = 300,
  onProgress?: (percent: number) => void
): Promise<HTMLCanvasElement> {
  // Preload all custom vector/PNG assets and font faces
  await preloadCanvasAssets(items);

  const rollWidthInches = settings.rollWidthInches || 39.0;
  // Calculate max height from items inside or active on sheet
  let maxY = 12.0;
  items.forEach((it) => {
    const isRot = it.rotation === 90 || it.rotation === 270;
    const h = isRot ? it.width : it.height;
    if (it.y + h > maxY) maxY = it.y + h;
  });

  const totalHeightInches = maxY + (settings.marginInches || 0.35);

  // Safely constrain total pixel area to ~200M pixels so canvas.toBlob() never returns null due to browser memory limits
  const totalAreaInchesSq = rollWidthInches * totalHeightInches;
  const maxSafeDpi = Math.floor(Math.sqrt(200000000 / totalAreaInchesSq));
  const effectiveDpi = Math.min(targetDpi, Math.max(150, maxSafeDpi));

  const canvasWidthPx = Math.round(rollWidthInches * effectiveDpi);
  const canvasHeightPx = Math.round(totalHeightInches * effectiveDpi);

  const canvas = document.createElement('canvas');
  canvas.width = canvasWidthPx;
  canvas.height = canvasHeightPx;

  const ctx = canvas.getContext('2d', { willReadFrequently: false });
  if (!ctx) throw new Error('Could not get 2D context for high-res render');

  // Clear background to 100% transparent (for DTF printing)
  ctx.clearRect(0, 0, canvasWidthPx, canvasHeightPx);

  const scale = effectiveDpi; // pixels per inch
  const CHUNK_SIZE = 8; // Process in micro-chunks to keep main thread responsive

  for (let i = 0; i < items.length; i += CHUNK_SIZE) {
    const end = Math.min(items.length, i + CHUNK_SIZE);
    for (let j = i; j < end; j++) {
      const item = items[j];
      // Only render items positioned inside printable active area (x >= -5)
      if (item.x + item.width > 0 && item.x < rollWidthInches + 5) {
        renderItemToCanvas(ctx, item, scale, {
          showCutLines: false, // EXCLUDE cut lines and guide lines from production print export
          isSelected: false,
          hasCollision: false,
        });
      }
    }

    if (onProgress) {
      onProgress(Math.round((end / items.length) * 100));
    }

    // Yield back to browser event loop to allow UI updates and prevent freeze
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  return canvas;
}

/**
 * Generate a single trimmed 300 DPI transparent PNG blob for an individual item
 */
export async function generateIndividualItemPngBlob(
  item: CanvasItem,
  targetDpi: number = 300
): Promise<{ blob: Blob; filename: string }> {
  const rotationDeg = item.rotation || 0;
  const isRotated = rotationDeg === 90 || rotationDeg === 270;

  const wInches = isRotated ? item.height : item.width;
  const hInches = isRotated ? item.width : item.height;

  const canvasWidthPx = Math.max(10, Math.round(wInches * targetDpi));
  const canvasHeightPx = Math.max(10, Math.round(hInches * targetDpi));

  const canvas = document.createElement('canvas');
  canvas.width = canvasWidthPx;
  canvas.height = canvasHeightPx;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get context for item export');

  ctx.clearRect(0, 0, canvasWidthPx, canvasHeightPx);

  // Render item centered at (0,0) offset
  const tempItem: CanvasItem = {
    ...item,
    x: 0,
    y: 0,
  };

  renderItemToCanvas(ctx, tempItem, targetDpi, {
    showCutLines: false,
    isSelected: false,
    hasCollision: false,
  });

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) return reject(new Error('Failed to generate PNG blob'));

      const cleanText = (item.customerName || item.number || 'ITEM').replace(/[^a-zA-Z0-9_-]/g, '_');
      const filename = `${item.itemType.toUpperCase()}_${cleanText}_${item.width}x${item.height}IN_300DPI.png`;

      resolve({ blob, filename });
    }, 'image/png');
  });
}
