import { CanvasItem, LayoutSettings } from '../types';
import {
  computeCurvedTextLayout,
  CurvedGlyphExtent,
  getCachedAssetAspectRatio,
  getDefaultLetterRatio,
  isPresetCurved,
  registerAssetAspectRatio,
  tokenizeNameCharacters,
} from './textMeasurement';
import { DOT_HEIGHT_RATIO } from './letterAssetHelper';

export { tokenizeNameCharacters };

export function renderItemToCanvas(
  ctx: CanvasRenderingContext2D,
  item: CanvasItem,
  scale: number, // pixels per inch
  options: {
    showCutLines?: boolean;
    cutLineColor?: string;
    isSelected?: boolean;
    hasCollision?: boolean;
    hoveredHandle?: string | null;
  } = {}
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
    // Adobe Illustrator style bounding box path line
    ctx.strokeStyle = '#06b6d4'; // Illustrator Cyan
    ctx.lineWidth = Math.max(1.5, 0.035 * scale);
    ctx.strokeRect(-2, -2, itemWPx + 4, itemHPx + 4);

    // 8 Transform Handles: 4 corners + 4 edge midpoints
    const handleSize = Math.max(7, scale * 0.13);
    const halfH = handleSize / 2;
    const midX = itemWPx / 2;
    const midY = itemHPx / 2;

    const handles: { id: string; x: number; y: number }[] = [
      { id: 'nw', x: -2, y: -2 },
      { id: 'ne', x: itemWPx + 2, y: -2 },
      { id: 'sw', x: -2, y: itemHPx + 2 },
      { id: 'se', x: itemWPx + 2, y: itemHPx + 2 },
      { id: 'n', x: midX, y: -2 },
      { id: 's', x: midX, y: itemHPx + 2 },
      { id: 'w', x: -2, y: midY },
      { id: 'e', x: itemWPx + 2, y: midY },
    ];

    handles.forEach((h) => {
      const isHovered = options.hoveredHandle === h.id;
      ctx.fillStyle = isHovered ? '#ec4899' : '#ffffff';
      ctx.strokeStyle = isHovered ? '#ffffff' : '#06b6d4';
      ctx.lineWidth = 1.5;
      ctx.fillRect(h.x - halfH, h.y - halfH, handleSize, handleSize);
      ctx.strokeRect(h.x - halfH, h.y - halfH, handleSize, handleSize);
    });

    // If edge is hovered, show Illustrator-style "path" tooltip badge
    if (options.hoveredHandle && ['w', 'e', 'n', 's', 'path_w', 'path_e', 'path_n', 'path_s'].includes(options.hoveredHandle)) {
      let badgeX = midX;
      let badgeY = midY;
      if (options.hoveredHandle.includes('w')) {
        badgeX = -2;
        badgeY = midY;
      } else if (options.hoveredHandle.includes('e')) {
        badgeX = itemWPx + 2;
        badgeY = midY;
      } else if (options.hoveredHandle.includes('n')) {
        badgeX = midX;
        badgeY = -2;
      } else if (options.hoveredHandle.includes('s')) {
        badgeX = midX;
        badgeY = itemHPx + 2;
      }

      ctx.save();
      ctx.font = 'bold 9px sans-serif';
      const textMetrics = ctx.measureText('path');
      const pad = 4;
      const bW = textMetrics.width + pad * 2;
      const bH = 13;
      const bX = badgeX + 6;
      const bY = badgeY - bH / 2;

      ctx.fillStyle = 'rgba(236, 72, 153, 0.95)'; // Magenta Illustrator badge
      ctx.beginPath();
      ctx.roundRect(bX, bY, bW, bH, 2);
      ctx.fill();

      ctx.fillStyle = '#ffffff';
      ctx.fillText('path', bX + pad, bY + 9.5);
      ctx.restore();
    }
  }

  // Render text content
  if (item.itemType === 'name') {
    renderNameText(ctx, item.customerName, preset, itemWPx, itemHPx, scale, item.letterCapHeightInches);
  } else if (item.itemType === 'number') {
    renderNumberText(ctx, item.number, preset, itemWPx, itemHPx, scale);
  }

  // Draw FRONT badge for small chest numbers
  if (item.isChestNumber && options.showCutLines) {
    ctx.save();
    ctx.fillStyle = 'rgba(5, 150, 105, 0.92)';
    const tagH = Math.max(9, Math.min(16, 0.2 * scale));
    const tagW = Math.max(28, Math.min(48, 0.6 * scale));
    const tagY = Math.max(0, itemHPx - tagH);
    if (typeof ctx.roundRect === 'function') {
      ctx.beginPath();
      ctx.roundRect(0, tagY, tagW, tagH, [0, 3, 0, 3]);
      ctx.fill();
    } else {
      ctx.fillRect(0, tagY, tagW, tagH);
    }
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${Math.max(6, Math.floor(tagH * 0.65))}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('FRONT', tagW / 2, tagY + tagH / 2);
    ctx.restore();
  }

  ctx.restore();
}

function renderNameText(
  ctx: CanvasRenderingContext2D,
  text: string,
  preset: any,
  wPx: number,
  hPx: number,
  scale: number,
  letterCapHeightInches?: number
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
  const chars = tokenizeNameCharacters(text);
  const hasLetterAssets = chars.some((c) => c !== ' ' && Boolean(letterAssets[c]));

  const userSpacing = typeof preset.letterSpacing === 'number' ? preset.letterSpacing : 3;
  const letterGapPx = Math.max(2, userSpacing * (scale / 30));

  const isCurved = isPresetCurved(preset);
  const arcDegrees =
    typeof preset.arcCurvature === 'number'
      ? preset.arcCurvature
      : typeof preset.arcAmount === 'number'
      ? preset.arcAmount
      : 24;

  // True cap height for curved text so arch expansion never blows up letter size
  const effectiveCapHeightPx =
    typeof letterCapHeightInches === 'number' && letterCapHeightInches > 0
      ? letterCapHeightInches * scale
      : isCurved
      ? Math.min(hPx * 0.72, (preset.defaultNameHeightInches || 2.2) * scale)
      : hPx;

  if (hasLetterAssets) {
    const refH = isCurved && chars.length > 1 ? effectiveCapHeightPx : hPx;
    const spaceWidthPx = refH * 0.22;
    const charWidths: number[] = [];

    chars.forEach((c) => {
      if (c === ' ') {
        charWidths.push(spaceWidthPx);
      } else {
        const url = letterAssets[c];
        const effectiveCharH = c === '.' && url ? refH * DOT_HEIGHT_RATIO : refH;
        const img = url ? getLoadedImage(url) : null;
        let cW = 0;
        if (img && img.complete && img.naturalWidth > 0 && img.naturalHeight > 0) {
          cW = effectiveCharH * (img.naturalWidth / img.naturalHeight);
        } else {
          const cachedRatio = url ? getCachedAssetAspectRatio(url) : null;
          if (cachedRatio) {
            cW = effectiveCharH * cachedRatio;
          } else {
            cW = refH * getDefaultLetterRatio(c);
          }
        }
        charWidths.push(cW);
      }
    });

    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    if (isCurved && chars.length > 1) {
      const layout = computeCurvedTextLayout({
        tokens: chars,
        charWidthsPx: charWidths,
        letterGapPx,
        glyphHeightPx: refH,
        arcDegrees,
        strokeWidthPx: 0,
        padPx: Math.max(1, 0.04 * scale),
      });

      const fitScaleX = wPx / layout.boxWidthPx;
      const fitScaleY = hPx / layout.boxHeightPx;

      ctx.scale(fitScaleX, fitScaleY);

      layout.glyphs.forEach((g) => {
        if (g.token === ' ') return;
        ctx.save();
        ctx.translate(g.cx, g.cy);
        ctx.rotate(g.angleRad);

        const url = letterAssets[g.token];
        const img = url ? getLoadedImage(url) : null;
        if (img && img.complete && img.naturalWidth > 0) {
          if (g.token === '.') {
            const dotH = refH * DOT_HEIGHT_RATIO;
            ctx.drawImage(img, -g.charWidthPx / 2, refH / 2 - dotH, g.charWidthPx, dotH);
          } else {
            ctx.drawImage(img, -g.charWidthPx / 2, -refH / 2, g.charWidthPx, refH);
          }
        } else {
          ctx.fillStyle = textColor;
          ctx.font = `700 ${refH * 0.9}px "${fontName}", sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(g.token, 0, 0);
        }
        ctx.restore();
      });
    } else {
      let rawTotalW = 0;
      charWidths.forEach((w, i) => {
        rawTotalW += w;
        if (i < charWidths.length - 1 && chars[i] !== ' ' && chars[i + 1] !== ' ') {
          rawTotalW += letterGapPx;
        } else if (i < charWidths.length - 1 && (chars[i] === ' ' || chars[i + 1] === ' ')) {
          rawTotalW += letterGapPx * 0.25;
        }
      });

      const scaleX = rawTotalW > 0 ? wPx / rawTotalW : 1.0;
      const actualTotalW = rawTotalW * scaleX;
      const startX = Math.max(0, (wPx - actualTotalW) / 2);

      let curX = startX;
      chars.forEach((c, i) => {
        const cW = charWidths[i] * scaleX;
        if (c !== ' ') {
          const url = letterAssets[c];
          const img = url ? getLoadedImage(url) : null;
          if (img && img.complete && img.naturalWidth > 0) {
            if (c === '.') {
              const dotH = hPx * DOT_HEIGHT_RATIO;
              ctx.drawImage(img, curX, hPx - dotH, cW, dotH);
            } else {
              ctx.drawImage(img, curX, 0, cW, hPx);
            }
          } else {
            ctx.fillStyle = textColor;
            ctx.font = `700 ${hPx * 0.85}px "${fontName}", sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(c, curX + cW / 2, hPx / 2);
          }
        }
        const gapAfter =
          i < chars.length - 1
            ? c === ' ' || chars[i + 1] === ' '
              ? letterGapPx * 0.25 * scaleX
              : letterGapPx * scaleX
            : 0;
        curX += cW + gapAfter;
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

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const fontRatio = 0.95; // Exact physical cap-height fit
  const fontSize = (isCurved && text.length > 1 ? effectiveCapHeightPx : hPx) * fontRatio;
  ctx.font = `700 ${fontSize}px "${fontName}", "Bebas Neue", "Oswald", sans-serif`;

  const centerX = wPx / 2;
  const centerY = hPx / 2;

  if (isCurved && text.length > 1) {
    if ('letterSpacing' in ctx) {
      (ctx as any).letterSpacing = '0px';
    }
    const rawChars = text.split('');
    const charWidths: number[] = [];
    const glyphExtents: CurvedGlyphExtent[] = [];

    rawChars.forEach((char) => {
      if (char === ' ') {
        const spW = fontSize * 0.28;
        charWidths.push(spW);
        glyphExtents.push({
          leftPx: spW / 2,
          rightPx: spW / 2,
          topPx: fontSize * 0.48,
          bottomPx: fontSize * 0.48,
        });
        return;
      }
      const m = ctx.measureText(char);
      const advW = m.width || fontSize * 0.5;
      const leftPx = Math.max(advW / 2, m.actualBoundingBoxLeft || advW / 2);
      const rightPx = Math.max(advW / 2, m.actualBoundingBoxRight || advW / 2);
      const topPx = Math.max(fontSize * 0.5, m.actualBoundingBoxAscent || fontSize * 0.5);
      const bottomPx = Math.max(fontSize * 0.5, m.actualBoundingBoxDescent || fontSize * 0.5);
      charWidths.push(Math.max(advW, leftPx + rightPx));
      glyphExtents.push({ leftPx, rightPx, topPx, bottomPx });
    });

    const layout = computeCurvedTextLayout({
      tokens: rawChars,
      charWidthsPx: charWidths,
      glyphExtentsPx: glyphExtents,
      letterGapPx,
      glyphHeightPx: fontSize,
      arcDegrees,
      strokeWidthPx,
      padPx: Math.max(1, 0.04 * scale),
    });

    const fitScaleX = wPx / layout.boxWidthPx;
    const fitScaleY = hPx / layout.boxHeightPx;
    ctx.scale(fitScaleX, fitScaleY);

    layout.glyphs.forEach((g) => {
      if (g.token === ' ') return;

      ctx.save();
      ctx.translate(g.cx, g.cy);
      ctx.rotate(g.angleRad);

      // 1. Draw Fill FIRST (preserves inner stencil gaps and cutouts)
      ctx.fillStyle = textColor;
      ctx.fillText(g.token, 0, 0);

      // 2. Optional Inner Outline Accent
      if (preset.hasInnerOutline && preset.innerOutlineColor) {
        ctx.save();
        ctx.strokeStyle = preset.innerOutlineColor;
        ctx.lineWidth = Math.min(strokeWidthPx * 0.4, fontSize * 0.02);
        ctx.lineJoin = 'miter';
        ctx.miterLimit = 2;
        ctx.strokeText(g.token, 0, 0);
        ctx.restore();
      }

      // 3. Draw Outer Stroke ONLY IF rawStrokeWidth > 0
      if (strokeWidthPx > 0) {
        ctx.save();
        ctx.globalCompositeOperation = 'destination-over';
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = strokeWidthPx * 2;
        ctx.lineJoin = 'miter';
        ctx.miterLimit = 2;
        ctx.strokeText(g.token, 0, 0);
        ctx.restore();
      }

      ctx.restore();
    });
  } else {
    if ('letterSpacing' in ctx) {
      (ctx as any).letterSpacing = `${letterGapPx}px`;
    }
    // Straight text - Exact Adobe Illustrator envelope scaling
    const metrics = ctx.measureText(text);
    const measuredW = metrics.width || 1;
    const scaleX = measuredW > 0 ? wPx / measuredW : 1.0;

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

export function getLoadedImage(url: string): HTMLImageElement | null {
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
  // Calculate max height from rotated AABB of all items inside active sheet
  let maxY = 12.0;
  items.forEach((it) => {
    const rad = ((it.rotation || 0) * Math.PI) / 180;
    const cos = Math.abs(Math.cos(rad));
    const sin = Math.abs(Math.sin(rad));
    const aabbW = it.width * cos + it.height * sin;
    const aabbH = it.width * sin + it.height * cos;
    const cx = it.x + it.width / 2;
    const cy = it.y + it.height / 2;
    const leftX = cx - aabbW / 2;
    const rightX = cx + aabbW / 2;
    if (rightX > 0 && leftX < rollWidthInches + 5) {
      const bottomY = cy + aabbH / 2;
      if (bottomY > maxY) maxY = bottomY;
    }
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
      const rad = ((item.rotation || 0) * Math.PI) / 180;
      const cos = Math.abs(Math.cos(rad));
      const sin = Math.abs(Math.sin(rad));
      const aabbW = item.width * cos + item.height * sin;
      const cx = item.x + item.width / 2;
      // Only render items positioned inside printable active area
      if (cx + aabbW / 2 > 0 && cx - aabbW / 2 < rollWidthInches + 5) {
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
  const rad = (rotationDeg * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));

  const wInches = item.width * cos + item.height * sin;
  const hInches = item.width * sin + item.height * cos;

  const canvasWidthPx = Math.max(10, Math.round(wInches * targetDpi));
  const canvasHeightPx = Math.max(10, Math.round(hInches * targetDpi));

  const canvas = document.createElement('canvas');
  canvas.width = canvasWidthPx;
  canvas.height = canvasHeightPx;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get context for item export');

  ctx.clearRect(0, 0, canvasWidthPx, canvasHeightPx);

  // Center item inside its rotated AABB canvas
  const tempItem: CanvasItem = {
    ...item,
    x: (wInches - item.width) / 2,
    y: (hInches - item.height) / 2,
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
