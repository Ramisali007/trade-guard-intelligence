import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from '../config';
import { createLogger } from '../utils/logger';

const log = createLogger('image-storage');

export interface StoredImageResult {
  imageId: string;
  storageUrl: string;
  storagePath: string;
  imageHash: string;
  mimeType: string;
  byteLength: number;
}

export class ImageStorageService {
  private readonly baseDir: string;

  constructor(baseDir = config.images.imagesDir) {
    this.baseDir = baseDir;
    fsSync.mkdirSync(this.baseDir, { recursive: true });
  }

  /**
   * Save an extracted image buffer for a specific document.
   */
  async saveImage(
    documentId: string,
    imageId: string,
    buffer: Buffer,
    format: 'png' | 'jpeg' = 'png',
  ): Promise<StoredImageResult> {
    const docDir = path.join(this.baseDir, documentId);
    await fs.mkdir(docDir, { recursive: true });

    const ext = format === 'jpeg' ? 'jpg' : 'png';
    const filename = `${imageId}.${ext}`;
    const storagePath = path.join(docDir, filename);

    await fs.writeFile(storagePath, buffer);

    const imageHash = crypto.createHash('sha256').update(buffer).digest('hex');
    const storageUrl = `/api/documents/${documentId}/images/${imageId}`;
    const mimeType = format === 'jpeg' ? 'image/jpeg' : 'image/png';

    log.debug('saved extracted image', { documentId, imageId, byteLength: buffer.length, storagePath });

    return {
      imageId,
      storageUrl,
      storagePath,
      imageHash,
      mimeType,
      byteLength: buffer.length,
    };
  }

  /**
   * Retrieve an image file buffer for serving.
   */
  async getImage(documentId: string, imageId: string): Promise<{ buffer: Buffer; mimeType: string } | null> {
    const docDir = path.join(this.baseDir, documentId);
    for (const ext of ['png', 'jpg', 'jpeg']) {
      const filePath = path.join(docDir, `${imageId}.${ext}`);
      try {
        const buffer = await fs.readFile(filePath);
        const mimeType = ext === 'png' ? 'image/png' : 'image/jpeg';
        return { buffer, mimeType };
      } catch {
        // try next ext
      }
    }
    return null;
  }

  /**
   * Remove all images associated with a document.
   */
  async deleteDocumentImages(documentId: string): Promise<void> {
    const docDir = path.join(this.baseDir, documentId);
    try {
      await fs.rm(docDir, { recursive: true, force: true });
    } catch (err) {
      log.warn('could not delete document images directory', { documentId, error: String(err) });
    }
  }
}

let singleton: ImageStorageService | null = null;
export function getImageStorageService(): ImageStorageService {
  if (!singleton) {
    singleton = new ImageStorageService();
  }
  return singleton;
}
