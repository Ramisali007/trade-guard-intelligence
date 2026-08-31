import type { DocumentDiscrepancy } from './types';

export interface CrossDocComparisonInput {
  invoice?: {
    number?: string;
    date?: string;
    seller?: string;
    buyer?: string;
    consignee?: string;
    origin?: string;
    destination?: string;
    totalQuantity?: number;
    totalAmount?: number;
    currency?: string;
    productDescription?: string;
  };
  billOfLading?: {
    number?: string;
    date?: string;
    shipper?: string;
    consignee?: string;
    notifyParty?: string;
    portOfLoading?: string;
    portOfDischarge?: string;
    totalPackagesOrQuantity?: number;
    productDescription?: string;
    vesselName?: string;
  };
  packingList?: {
    number?: string;
    totalQuantity?: number;
    grossWeight?: string;
    netWeight?: string;
  };
  certificateOfOrigin?: {
    number?: string;
    issuingCountry?: string;
    declaredOrigin?: string;
    exporter?: string;
    importerOrConsignee?: string;
  };
  letterOfCredit?: {
    lcNumber?: string;
    applicant?: string;
    beneficiary?: string;
    amount?: number;
    currency?: string;
    expiryDate?: string;
    latestShipmentDate?: string;
    portOfLoading?: string;
    portOfDischarge?: string;
  };
}

export class ReconciliationEngine {
  reconcileDocuments(input: CrossDocComparisonInput): DocumentDiscrepancy[] {
    const discrepancies: DocumentDiscrepancy[] = [];
    let count = 1;

    // 1. Quantity comparison: Invoice vs Packing List vs Bill of Lading
    if (input.invoice?.totalQuantity && input.packingList?.totalQuantity) {
      if (input.invoice.totalQuantity !== input.packingList.totalQuantity) {
        discrepancies.push({
          id: `DISC-${count++}`,
          documentA: 'Commercial Invoice',
          documentB: 'Packing List',
          field: 'Total Quantity',
          valueA: `${input.invoice.totalQuantity.toLocaleString()} units`,
          valueB: `${input.packingList.totalQuantity.toLocaleString()} units`,
          severity: 'CRITICAL_CONFLICT',
          explanation: `Invoice total quantity (${input.invoice.totalQuantity}) conflicts directly with Packing List stated quantity (${input.packingList.totalQuantity}).`,
        });
      }
    }

    if (input.invoice?.totalQuantity && input.billOfLading?.totalPackagesOrQuantity) {
      if (input.invoice.totalQuantity !== input.billOfLading.totalPackagesOrQuantity) {
        discrepancies.push({
          id: `DISC-${count++}`,
          documentA: 'Commercial Invoice',
          documentB: 'Bill of Lading',
          field: 'Cargo Quantity / Packages',
          valueA: `${input.invoice.totalQuantity.toLocaleString()} items`,
          valueB: `${input.billOfLading.totalPackagesOrQuantity.toLocaleString()} units/packages`,
          severity: 'CRITICAL_CONFLICT',
          explanation: `Quantity mismatch between Commercial Invoice (${input.invoice.totalQuantity}) and Bill of Lading (${input.billOfLading.totalPackagesOrQuantity}). Potential phantom shipment or over/under-invoicing indicator.`,
        });
      }
    }

    // 2. Consignee comparison: Invoice vs Bill of Lading
    if (input.invoice?.consignee && input.billOfLading?.consignee) {
      const invConsignee = input.invoice.consignee.trim().toLowerCase();
      const blConsignee = input.billOfLading.consignee.trim().toLowerCase();
      if (invConsignee !== blConsignee && !invConsignee.includes(blConsignee) && !blConsignee.includes(invConsignee)) {
        discrepancies.push({
          id: `DISC-${count++}`,
          documentA: 'Commercial Invoice',
          documentB: 'Bill of Lading',
          field: 'Consignee Name',
          valueA: input.invoice.consignee,
          valueB: input.billOfLading.consignee,
          severity: 'MATERIAL_DISCREPANCY',
          explanation: `Invoice consignee ("${input.invoice.consignee}") differs from transport document consignee ("${input.billOfLading.consignee}"). May indicate diversion or undisclosed intermediary.`,
        });
      }
    }

    // 3. Country of Origin comparison: Invoice vs Certificate of Origin
    if (input.invoice?.origin && input.certificateOfOrigin?.declaredOrigin) {
      const invOrigin = input.invoice.origin.trim().toLowerCase();
      const cooOrigin = input.certificateOfOrigin.declaredOrigin.trim().toLowerCase();
      if (invOrigin !== cooOrigin && !invOrigin.includes(cooOrigin) && !cooOrigin.includes(invOrigin)) {
        discrepancies.push({
          id: `DISC-${count++}`,
          documentA: 'Commercial Invoice',
          documentB: 'Certificate of Origin',
          field: 'Country of Origin',
          valueA: input.invoice.origin,
          valueB: input.certificateOfOrigin.declaredOrigin,
          severity: 'CRITICAL_CONFLICT',
          explanation: `Commercial invoice declares country of origin as "${input.invoice.origin}", but Certificate of Origin certifies "${input.certificateOfOrigin.declaredOrigin}". Sanctions/tariff circumvention red flag.`,
        });
      }
    }

    // 4. LC Amount comparison: Invoice vs Letter of Credit
    if (input.invoice?.totalAmount && input.letterOfCredit?.amount) {
      if (input.invoice.totalAmount > input.letterOfCredit.amount) {
        discrepancies.push({
          id: `DISC-${count++}`,
          documentA: 'Commercial Invoice',
          documentB: 'Letter of Credit',
          field: 'Total Value / DC Tolerance',
          valueA: `${input.invoice.currency || 'USD'} ${input.invoice.totalAmount.toLocaleString()}`,
          valueB: `${input.letterOfCredit.currency || 'USD'} ${input.letterOfCredit.amount.toLocaleString()}`,
          severity: 'CRITICAL_CONFLICT',
          explanation: `Presented invoice value (${input.invoice.totalAmount}) exceeds maximum Letter of Credit credit amount (${input.letterOfCredit.amount}). UCP 600 non-complying presentation.`,
        });
      }
    }

    // 5. Port comparison: Bill of Lading vs Letter of Credit
    if (input.billOfLading?.portOfLoading && input.letterOfCredit?.portOfLoading) {
      const blPort = input.billOfLading.portOfLoading.trim().toLowerCase();
      const lcPort = input.letterOfCredit.portOfLoading.trim().toLowerCase();
      if (blPort !== lcPort && !blPort.includes(lcPort) && !lcPort.includes(blPort) && !lcPort.includes('any')) {
        discrepancies.push({
          id: `DISC-${count++}`,
          documentA: 'Bill of Lading',
          documentB: 'Letter of Credit',
          field: 'Port of Loading',
          valueA: input.billOfLading.portOfLoading,
          valueB: input.letterOfCredit.portOfLoading,
          severity: 'MATERIAL_DISCREPANCY',
          explanation: `Port of loading on Bill of Lading (${input.billOfLading.portOfLoading}) does not match LC stipulated loading port (${input.letterOfCredit.portOfLoading}).`,
        });
      }
    }

    return discrepancies;
  }
}
