/**
 * InfoTech Group's locations, as the company lists them on infotechgroup.com (menu: Locations > PK, KSA, Kenya).
 * Every footer and the blog page read this one list.
 *
 * `addressLines` is left empty on purpose: the company's website publishes no street addresses, and an invented
 * address must never be shown on a bank-facing page. While it is empty each footer links to the official location
 * page instead. To show an address, put the lines the company confirms here, for example
 * `addressLines: ['Building, Street', 'Area, City 00000']`; nothing else needs to change.
 */
export interface CompanyOffice {
  id: 'pk' | 'ksa' | 'kenya';
  /** The tab label. */
  tab: string;
  name: string;
  country: string;
  /** The company's own page for this location. */
  pageUrl: string;
  addressLines: string[];
}

export const COMPANY_EMAIL = 'info@infotechgroup.com';

export const COMPANY_OFFICES: readonly CompanyOffice[] = [
  { id: 'pk', tab: 'PK', name: 'INFOTECH GROUP · PAKISTAN', country: 'Pakistan', pageUrl: 'https://www.infotechgroup.com', addressLines: [] },
  { id: 'ksa', tab: 'KSA', name: 'INFOTECH GROUP · SAUDI ARABIA', country: 'Saudi Arabia', pageUrl: 'https://infotechgroup.com/ksa/', addressLines: [] },
  { id: 'kenya', tab: 'KENYA', name: 'INFOTECH GROUP · KENYA', country: 'Kenya', pageUrl: 'https://infotechgroup.com/kenya/', addressLines: [] },
];
