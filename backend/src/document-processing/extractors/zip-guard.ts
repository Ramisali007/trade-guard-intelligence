/**
 * A look inside a ZIP container (a .docx is one) *before* anything unpacks it.
 *
 * Unpacking is where a hostile file does its damage: a few kilobytes can inflate to gigabytes, and a
 * parser that reads the whole archive into memory takes the process down with it. The central directory
 * at the end of the file lists every entry with its declared sizes, so the archive can be judged
 * without decompressing a byte. This also settles what the file *is*: an archive is a Word document
 * when it carries `word/document.xml`, not merely when "word/" appears somewhere in its first bytes.
 */

export interface ZipEntry {
  name: string;
  compressedSize: number;
  uncompressedSize: number;
}

export class ZipFormatError extends Error {}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const ZIP64_MARKER = 0xffffffff;

/** Entries of the archive, read from its central directory. Throws ZipFormatError when it is not one. */
export function listZipEntries(buffer: Buffer): ZipEntry[] {
  // The end-of-central-directory record is within the last 64 KiB + 22 bytes.
  const searchFrom = Math.max(0, buffer.length - 22 - 0xffff);
  let eocd = -1;
  for (let i = buffer.length - 22; i >= searchFrom; i -= 1) {
    if (buffer.readUInt32LE(i) === EOCD_SIGNATURE) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipFormatError('The archive has no central directory.');

  const entryCount = buffer.readUInt16LE(eocd + 10);
  const directorySize = buffer.readUInt32LE(eocd + 12);
  const directoryOffset = buffer.readUInt32LE(eocd + 16);
  if (entryCount === 0xffff || directorySize === ZIP64_MARKER || directoryOffset === ZIP64_MARKER) {
    throw new ZipFormatError('ZIP64 archives are not accepted.');
  }
  if (directoryOffset + directorySize > buffer.length) throw new ZipFormatError('The central directory points outside the file.');

  const entries: ZipEntry[] = [];
  let cursor = directoryOffset;
  for (let n = 0; n < entryCount; n += 1) {
    if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) {
      throw new ZipFormatError('The central directory is damaged.');
    }
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    if (compressedSize === ZIP64_MARKER || uncompressedSize === ZIP64_MARKER) throw new ZipFormatError('ZIP64 entries are not accepted.');
    const name = buffer.toString('utf8', cursor + 46, cursor + 46 + nameLength);
    entries.push({ name, compressedSize, uncompressedSize });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

export interface ZipLimits {
  maxEntries: number;
  maxTotalUncompressedBytes: number;
  maxSingleEntryBytes: number;
  /** Largest allowed uncompressed/compressed ratio for an entry big enough to matter. */
  maxRatio: number;
}

export const DOCX_LIMITS: ZipLimits = {
  maxEntries: 5000,
  maxTotalUncompressedBytes: 250 * 1024 * 1024,
  maxSingleEntryBytes: 100 * 1024 * 1024,
  maxRatio: 200,
};

/** The reason the archive must not be unpacked, or null when it is within limits. */
export function zipBombReason(entries: ZipEntry[], limits: ZipLimits = DOCX_LIMITS): string | null {
  if (entries.length > limits.maxEntries) return `The archive holds ${entries.length} entries (limit ${limits.maxEntries}).`;
  let total = 0;
  for (const entry of entries) {
    total += entry.uncompressedSize;
    if (entry.uncompressedSize > limits.maxSingleEntryBytes) return `Entry "${entry.name}" expands to ${Math.round(entry.uncompressedSize / 1048576)} MB.`;
    if (entry.uncompressedSize > 1024 * 1024 && entry.compressedSize > 0 && entry.uncompressedSize / entry.compressedSize > limits.maxRatio) {
      return `Entry "${entry.name}" is compressed ${Math.round(entry.uncompressedSize / entry.compressedSize)}:1, which no ordinary document is.`;
    }
  }
  if (total > limits.maxTotalUncompressedBytes) return `The archive expands to ${Math.round(total / 1048576)} MB (limit ${Math.round(limits.maxTotalUncompressedBytes / 1048576)} MB).`;
  return null;
}

/** Whether the archive is a Word (OOXML) document: it carries both required parts. */
export function isWordDocument(entries: ZipEntry[]): boolean {
  const names = new Set(entries.map((e) => e.name));
  return names.has('[Content_Types].xml') && names.has('word/document.xml');
}
