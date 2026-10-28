/** A first guess at what a shipping document is from its file name; the person can change it. */
export function guessPresentationType(filename: string): string {
  const name = filename.toLowerCase();
  if (/packing|\bpl\b|pack[-_ ]?list/.test(name)) return 'PACKING_LIST';
  if (/lading|\bb\/?l\b|\bbl[-_ ]?\d|bill/.test(name)) return 'BILL_OF_LADING';
  if (/insur|marine|cover/.test(name)) return 'INSURANCE_DOCUMENT';
  if (/origin|\bcoo\b|\bco[-_ ]\d/.test(name)) return 'CERTIFICATE_OF_ORIGIN';
  if (/inspect|quality|weight|phyto|fumig/.test(name)) return 'INSPECTION_CERTIFICATE';
  if (/invoice|\binv\b|\bci[-_ ]?\d|commercial/.test(name)) return 'COMMERCIAL_INVOICE';
  return 'OTHER_SUPPORTING';
}

/** A first guess at what a pre-shipment document is from its file name; the person can change it. */
export function guessDocumentType(filename: string): string {
  const name = filename.toLowerCase();
  if (/proforma|pro-forma|\bpi\b|\bpi[-_ ]?\d/.test(name)) return 'PROFORMA_INVOICE';
  if (/contract|agreement/.test(name)) return 'PURCHASE_CONTRACT';
  if (/purchase.?order|\bpo\b|\bpo[-_ ]?\d/.test(name)) return 'PURCHASE_ORDER';
  if (/permit|licen[cs]e/.test(name)) return 'IMPORT_PERMIT';
  if (/lc.?(app|form)|application/.test(name)) return 'LC_APPLICATION_FORM';
  return 'OTHER_SUPPORTING';
}
