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

  private validateIdentifier(id: string, name: string): void {
    if (!id || typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(id)) {
      throw new Error(`Security Exception: Invalid ${name} format (must be alphanumeric, 1-128 chars).`);
    }
  }

  private resolveSafePath(documentId: string, imageId?: string, ext?: string): string {
    this.validateIdentifier(documentId, 'documentId');
    if (imageId) {
      this.validateIdentifier(imageId, 'imageId');
    }

    const resolvedBase = path.resolve(this.baseDir);
    const resolvedDocDir = path.resolve(resolvedBase, documentId);

    if (!resolvedDocDir.startsWith(resolvedBase + path.sep) && resolvedDocDir !== resolvedBase) {
      throw new Error('Security Exception: Path traversal attempt detected.');
    }

    if (!imageId) return resolvedDocDir;

    const targetFilename = ext ? `${imageId}.${ext}` : imageId;
    const resolvedFile = path.resolve(resolvedDocDir, targetFilename);

    if (!resolvedFile.startsWith(resolvedDocDir + path.sep)) {
      throw new Error('Security Exception: Path traversal attempt detected.');
    }

    return resolvedFile;
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
    const ext = format === 'jpeg' ? 'jpg' : 'png';
    const storagePath = this.resolveSafePath(documentId, imageId, ext);
    const docDir = path.dirname(storagePath);

    await fs.mkdir(docDir, { recursive: true });
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
    for (const ext of ['png', 'jpg', 'jpeg']) {
      try {
        const filePath = this.resolveSafePath(documentId, imageId, ext);
        const buffer = await fs.readFile(filePath);
        const mimeType = ext === 'png' ? 'image/png' : 'image/jpeg';
        return { buffer, mimeType };
      } catch (err: any) {
        if (err?.message?.includes('Security Exception')) throw err;
        // continue checking next extension
      }
    }
    return null;
  }

  /**
   * Remove all images associated with a document.
   */
  async deleteDocumentImages(documentId: string): Promise<void> {
    try {
      const docDir = this.resolveSafePath(documentId);
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
