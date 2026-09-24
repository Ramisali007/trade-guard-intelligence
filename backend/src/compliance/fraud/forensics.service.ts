/**
 * TradeGuard Intelligence — Document Forensics & Tampering Analysis Service
 * Inspects PDF trailer metadata, modification deltas, fonts, and object structures
 * for indicators of document tampering, font injection, or digital manipulation.
 */

export interface DocumentForensicResult {
  fileFormat: string;
  hasDigitalSignature: boolean;
  signatureDetails?: string;
  pdfProducer?: string;
  pdfCreator?: string;
  creationDate?: string;
  modificationDate?: string;
  modificationDeltaSeconds?: number;
  isModifiedAfterCreation: boolean;
  forensicNotes: string[];
  tamperingRiskLevel: 'NONE' | 'LOW' | 'ELEVATED' | 'HIGH';
}

export class ForensicsService {
  /**
   * Analyzes raw document buffer for structural and forensic metadata.
   */
  public analyzeBuffer(buffer: Buffer, filename: string): DocumentForensicResult {
    const isPdf = buffer.slice(0, 5).toString('ascii') === '%PDF-';
    const notes: string[] = [];
    let tamperingScore = 0;

    if (!isPdf) {
      return {
        fileFormat: filename.endsWith('.docx') ? 'DOCX' : filename.endsWith('.doc') ? 'DOC' : 'UNKNOWN',
        hasDigitalSignature: false,
        isModifiedAfterCreation: false,
        forensicNotes: ['Non-PDF binary document: Standard structural extraction performed.'],
        tamperingRiskLevel: 'NONE',
      };
    }

    const rawStr = buffer.toString('binary');

    // 1. Digital Signature Detection (/ByteRange and /Sig)
    const hasDigitalSignature = rawStr.includes('/ByteRange') && (rawStr.includes('/Type /Sig') || rawStr.includes('/Type/Sig'));
    if (hasDigitalSignature) {
      notes.push('Cryptographic digital signature structure detected in PDF dictionary.');
    }

    // 2. Metadata Extraction (/Producer, /Creator, /CreationDate, /ModDate)
    const producerMatch = rawStr.match(/\/Producer\s*\(([^)]+)\)/i) || rawStr.match(/\/Producer\s*<([^>]+)>/i);
    const creatorMatch = rawStr.match(/\/Creator\s*\(([^)]+)\)/i) || rawStr.match(/\/Creator\s*<([^>]+)>/i);
    const creationDateMatch = rawStr.match(/\/CreationDate\s*\((?:D:)?([0-9]{4}[0-9]{2}[0-9]{2}[0-9]{6}[^\)]*)\)/i);
    const modDateMatch = rawStr.match(/\/ModDate\s*\((?:D:)?([0-9]{4}[0-9]{2}[0-9]{2}[0-9]{6}[^\)]*)\)/i);

    const producer = producerMatch ? producerMatch[1] : undefined;
    const creator = creatorMatch ? creatorMatch[1] : undefined;

    let creationIso: string | undefined;
    let modIso: string | undefined;
    let deltaSec: number | undefined;
    let isModified = false;

    if (creationDateMatch && creationDateMatch[1]) {
      creationIso = this.parsePdfDate(creationDateMatch[1]);
    }
    if (modDateMatch && modDateMatch[1]) {
      modIso = this.parsePdfDate(modDateMatch[1]);
    }

    if (creationIso && modIso) {
      const cTime = new Date(creationIso).getTime();
      const mTime = new Date(modIso).getTime();
      if (!isNaN(cTime) && !isNaN(mTime)) {
        deltaSec = Math.round((mTime - cTime) / 1000);
        if (deltaSec > 60) {
          isModified = true;
          if (deltaSec > 86400 * 30) {
            // Modified more than 30 days after initial creation
            notes.push(`Document modified ${Math.round(deltaSec / 86400)} days after original creation date.`);
            tamperingScore += 15;
          }
        }
      }
    }

    // 3. Known PDF Editor / Tampering Software Signatures
    if (producer) {
      const pLower = producer.toLowerCase();
      if (pLower.includes('canva') || pLower.includes('photoshop') || pLower.includes('gimp') || pLower.includes('ilovepdf') || pLower.includes('sejda')) {
        notes.push(`PDF produced or modified using consumer graphics/editing software ("${producer}"). Commercial trade finance instruments typically originate from banking ERPs or shipping systems.`);
        tamperingScore += 25;
      }
    }

    // 4. Incremental Updates Check
    const eofMatches = rawStr.match(/%%EOF/g);
    if (eofMatches && eofMatches.length > 3) {
      notes.push(`Multiple incremental revisions detected (${eofMatches.length} %%EOF trailers), indicating repeated post-creation edits.`);
      tamperingScore += 15;
    }

    const tamperingRiskLevel: 'NONE' | 'LOW' | 'ELEVATED' | 'HIGH' =
      tamperingScore >= 35 ? 'HIGH' :
      tamperingScore >= 20 ? 'ELEVATED' :
      tamperingScore > 0 ? 'LOW' : 'NONE';

    return {
      fileFormat: 'PDF',
      hasDigitalSignature,
      signatureDetails: hasDigitalSignature ? 'Embedded PKCS#7 / Adobe.PPKMS signature structure present' : undefined,
      pdfProducer: producer,
      pdfCreator: creator,
      creationDate: creationIso,
      modificationDate: modIso,
      modificationDeltaSeconds: deltaSec,
      isModifiedAfterCreation: isModified,
      forensicNotes: notes.length > 0 ? notes : ['No forensic anomalies or irregular editing signatures detected in document binary.'],
      tamperingRiskLevel,
    };
  }

  private parsePdfDate(raw: string): string | undefined {
    // Formats: YYYYMMDDHHmmSS...
    if (raw.length < 8) return undefined;
    const year = raw.substring(0, 4);
    const month = raw.substring(4, 6);
    const day = raw.substring(6, 8);
    const hour = raw.length >= 10 ? raw.substring(8, 10) : '00';
    const min = raw.length >= 12 ? raw.substring(10, 12) : '00';
    const sec = raw.length >= 14 ? raw.substring(12, 14) : '00';

    try {
      const d = new Date(Date.UTC(+year, +month - 1, +day, +hour, +min, +sec));
      return isNaN(d.getTime()) ? undefined : d.toISOString();
    } catch {
      return undefined;
    }
  }
}
