/**
 * Image Trimming Utility for DTF Print Automation
 * Automatically crops out transparent dead space / padding around images & graphics
 * ensuring tight bounding boxes for optimal canvas placement and nesting.
 */

export async function trimTransparentImageCanvas(
  imageSource: string | HTMLImageElement
): Promise<{ dataUrl: string; width: number; height: number; aspectRatio: number }> {
  return new Promise((resolve) => {
    const processImage = (img: HTMLImageElement) => {
      const origW = img.naturalWidth || img.width;
      const origH = img.naturalHeight || img.height;

      if (!origW || !origH) {
        resolve({
          dataUrl: typeof imageSource === 'string' ? imageSource : img.src,
          width: origW || 100,
          height: origH || 100,
          aspectRatio: (origW || 100) / (origH || 100),
        });
        return;
      }

      const canvas = document.createElement('canvas');
      canvas.width = origW;
      canvas.height = origH;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });

      if (!ctx) {
        resolve({
          dataUrl: typeof imageSource === 'string' ? imageSource : img.src,
          width: origW,
          height: origH,
          aspectRatio: origW / origH,
        });
        return;
      }

      ctx.drawImage(img, 0, 0);

      try {
        const imageData = ctx.getImageData(0, 0, origW, origH);
        const data = imageData.data;

        let minX = origW;
        let minY = origH;
        let maxX = -1;
        let maxY = -1;

        for (let y = 0; y < origH; y++) {
          for (let x = 0; x < origW; x++) {
            const alpha = data[(y * origW + x) * 4 + 3];
            if (alpha > 5) {
              if (x < minX) minX = x;
              if (x > maxX) maxX = x;
              if (y < minY) minY = y;
              if (y > maxY) maxY = y;
            }
          }
        }

        // If completely empty or no trimming needed (already full box)
        if (maxX < minX || maxY < minY) {
          resolve({
            dataUrl: typeof imageSource === 'string' ? imageSource : img.src,
            width: origW,
            height: origH,
            aspectRatio: origW / origH,
          });
          return;
        }

        const trimmedW = maxX - minX + 1;
        const trimmedH = maxY - minY + 1;

        // If padding is minimal (< 2% on all sides), no need to re-encode
        if (
          trimmedW >= origW * 0.98 &&
          trimmedH >= origH * 0.98 &&
          minX <= 2 &&
          minY <= 2
        ) {
          resolve({
            dataUrl: typeof imageSource === 'string' ? imageSource : img.src,
            width: origW,
            height: origH,
            aspectRatio: origW / origH,
          });
          return;
        }

        const trimmedCanvas = document.createElement('canvas');
        trimmedCanvas.width = trimmedW;
        trimmedCanvas.height = trimmedH;
        const trimmedCtx = trimmedCanvas.getContext('2d');

        if (trimmedCtx) {
          trimmedCtx.drawImage(
            canvas,
            minX,
            minY,
            trimmedW,
            trimmedH,
            0,
            0,
            trimmedW,
            trimmedH
          );
          const trimmedDataUrl = trimmedCanvas.toDataURL('image/png');
          resolve({
            dataUrl: trimmedDataUrl,
            width: trimmedW,
            height: trimmedH,
            aspectRatio: trimmedW / trimmedH,
          });
          return;
        }
      } catch (e) {
        console.warn('Cross-origin or canvas read error during image trim:', e);
      }

      resolve({
        dataUrl: typeof imageSource === 'string' ? imageSource : img.src,
        width: origW,
        height: origH,
        aspectRatio: origW / origH,
      });
    };

    if (typeof imageSource === 'string') {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => processImage(img);
      img.onerror = () => {
        resolve({
          dataUrl: imageSource,
          width: 100,
          height: 100,
          aspectRatio: 1,
        });
      };
      img.src = imageSource;
    } else {
      processImage(imageSource);
    }
  });
}
