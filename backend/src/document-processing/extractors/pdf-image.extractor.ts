import { PNG } from 'pngjs';
import crypto from 'node:crypto';
import { config } from '../../config';
import { createLogger } from '../../utils/logger';
import type { BoundingBox, ImageType } from '../../models/document.model';

const log = createLogger('extract:pdf-image');

export interface ExtractedImageItem {
  id: string;
  pageNumber: number;
  buffer: Buffer;
  mimeType: string;
  width: number;
  height: number;
  boundingBox: BoundingBox;
  yPosition: number; // for vertical reading order sorting
  isScannedPage: boolean;
  imageHash: string;
}

export interface PageImageExtractionResult {
  pageNumber: number;
  images: ExtractedImageItem[];
  isScannedPage: boolean;
}

// Matrix operations for tracking PDF graphics state transform
type Matrix = [number, number, number, number, number, number];

function identityMatrix(): Matrix {
  return [1, 0, 0, 1, 0, 0];
}

function multiplyMatrix(m1: Matrix, m2: Matrix): Matrix {
  const [a1, b1, c1, d1, e1, f1] = m1;
  const [a2, b2, c2, d2, e2, f2] = m2;
  return [
    a1 * a2 + b1 * c2,
    a1 * b2 + b1 * d2,
    c1 * a2 + d1 * c2,
    c1 * b2 + d1 * d2,
    e1 * a2 + f1 * c2 + e2,
    e1 * b2 + f1 * d2 + f2,
  ];
}

export class PdfImageExtractor {
  /**
   * Extract all embedded raster images from a PDF page proxy.
   */
  static async extractImagesFromPage(
    page: any,
    pageNumber: number,
    pageTextCharCount: number,
    pdfjs: any,
  ): Promise<PageImageExtractionResult> {
    const isScanned = pageTextCharCount < config.images.scannedTextThresholdChars;
    const extracted: ExtractedImageItem[] = [];

    try {
      const ops = await page.getOperatorList();
      const fnArray: number[] = ops.fnArray || [];
      const argsArray: any[] = ops.argsArray || [];
      const OPS = pdfjs.OPS || (pdfjs as any).default?.OPS || {};

      const matrixStack: Matrix[] = [];
      let currentMatrix: Matrix = identityMatrix();

      for (let i = 0; i < fnArray.length; i++) {
        const fn = fnArray[i];
        const args = argsArray[i];

        if (fn === OPS.save) {
          matrixStack.push([...currentMatrix] as Matrix);
        } else if (fn === OPS.restore) {
          if (matrixStack.length > 0) {
            currentMatrix = matrixStack.pop()!;
          }
        } else if (fn === OPS.transform && Array.isArray(args)) {
          const transformMatrix: Matrix = [
            args[0] ?? 1,
            args[1] ?? 0,
            args[2] ?? 0,
            args[3] ?? 1,
            args[4] ?? 0,
            args[5] ?? 0,
          ];
          currentMatrix = multiplyMatrix(currentMatrix, transformMatrix);
        } else if (
          fn === OPS.paintImageXObject ||
          fn === OPS.paintJpegXObject ||
          fn === OPS.paintImageMaskXObject
        ) {
          const objName = typeof args?.[0] === 'string' ? args[0] : null;
          if (!objName) continue;

          const imgObj = await new Promise<any>((resolve) => {
            if (page.objs?.has?.(objName)) {
              page.objs.get(objName, (res: any) => resolve(res));
            } else if (page.commonObjs?.has?.(objName)) {
              page.commonObjs.get(objName, (res: any) => resolve(res));
            } else {
              resolve(null);
            }
          });

          if (!imgObj) continue;

          // Derive bounding box in user-space points from current transform matrix
          const [a, b, c, d, e, f] = currentMatrix;
          const bboxWidth = Math.round(Math.hypot(a, b)) || (imgObj.width ?? 100);
          const bboxHeight = Math.round(Math.hypot(c, d)) || (imgObj.height ?? 100);
          const bboxX = Math.round(e);
          const bboxY = Math.round(f);

          // Skip tiny decorative images unless this page is scanned
          const pxWidth = imgObj.width ?? bboxWidth;
          const pxHeight = imgObj.height ?? bboxHeight;
          const area = pxWidth * pxHeight;

          if (
            !isScanned &&
            (pxWidth < config.images.minImageDimension ||
              pxHeight < config.images.minImageDimension ||
              area < config.images.minImageArea)
          ) {
            log.debug('skipping decorative/small image', { pageNumber, pxWidth, pxHeight, area });
            continue;
          }

          const pngBuffer = this.convertImageObjToPng(imgObj);
          if (!pngBuffer || pngBuffer.length === 0) continue;

          const imageHash = crypto.createHash('sha256').update(pngBuffer).digest('hex');
          const imageId = `img_${pageNumber}_${extracted.length + 1}_${imageHash.slice(0, 8)}`;

          extracted.push({
            id: imageId,
            pageNumber,
            buffer: pngBuffer,
            mimeType: 'image/png',
            width: pxWidth,
            height: pxHeight,
            boundingBox: {
              x: bboxX,
              y: bboxY,
              width: bboxWidth,
              height: bboxHeight,
            },
            yPosition: bboxY,
            isScannedPage: isScanned,
            imageHash,
          });
        }
      }
    } catch (err) {
      log.warn('error extracting images from page', { pageNumber, error: String(err) });
    }

    return {
      pageNumber,
      images: extracted,
      isScannedPage: isScanned && extracted.length > 0,
    };
  }

  /**
   * Convert pdfjs internal image representation to standard PNG Buffer.
   */
  static convertImageObjToPng(imgObj: any): Buffer | null {
    try {
      if (imgObj.data instanceof Uint8Array || imgObj.data instanceof Uint8ClampedArray) {
        const width = imgObj.width;
        const height = imgObj.height;
        if (!width || !height || width <= 0 || height <= 0) return null;

        const png = new PNG({ width, height });
        const rawData = imgObj.data;
        const channels = Math.floor(rawData.length / (width * height));

        if (channels === 4) {
          // RGBA
          for (let i = 0; i < rawData.length; i++) {
            png.data[i] = rawData[i]!;
          }
        } else if (channels === 3) {
          // RGB -> RGBA
          let srcIdx = 0;
          let dstIdx = 0;
          for (let i = 0; i < width * height; i++) {
            png.data[dstIdx++] = rawData[srcIdx++]!;
            png.data[dstIdx++] = rawData[srcIdx++]!;
            png.data[dstIdx++] = rawData[srcIdx++]!;
            png.data[dstIdx++] = 255; // Alpha
          }
        } else if (channels === 1) {
          // Grayscale -> RGBA
          let dstIdx = 0;
          for (let i = 0; i < width * height; i++) {
            const gray = rawData[i]!;
            png.data[dstIdx++] = gray;
            png.data[dstIdx++] = gray;
            png.data[dstIdx++] = gray;
            png.data[dstIdx++] = 255;
          }
        } else {
          // Fallback: fill buffer
          const totalPx = width * height;
          for (let i = 0; i < totalPx; i++) {
            const val = rawData[i] ?? 0;
            const dst = i * 4;
            png.data[dst] = val;
            png.data[dst + 1] = val;
            png.data[dst + 2] = val;
            png.data[dst + 3] = 255;
          }
        }

        return PNG.sync.write(png);
      }

      // If already a buffer or raw jpeg stream
      if (Buffer.isBuffer(imgObj.data)) {
        return imgObj.data;
      }
    } catch (err) {
      log.warn('failed to encode image to PNG', { error: String(err) });
    }
    return null;
  }
}
