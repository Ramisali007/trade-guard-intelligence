/**
 * Units of measure for price comparison.
 *
 * A declared price is only comparable with a benchmark when both are per the same quantity: USD 950 per
 * metric ton is USD 0.95 per kilogram, and treating the two as the same number is how a correctly priced
 * shipment turns into a "99.9% under-invoicing" finding. Each unit belongs to a family (mass, count,
 * length, …) with a factor to that family's base unit; only units of one family convert, and anything
 * unknown is reported as not comparable rather than guessed.
 */

type Family = 'MASS' | 'COUNT' | 'PAIR' | 'LENGTH' | 'AREA' | 'VOLUME';

interface UnitDef {
  family: Family;
  /** How many base units one of this unit is (kg, piece, pair, metre, m², litre). */
  perUnit: number;
}

const UNITS: Record<string, UnitDef> = {};

function define(family: Family, perUnit: number, ...names: string[]): void {
  for (const name of names) UNITS[name] = { family, perUnit };
}

define('MASS', 1, 'KG', 'KGS', 'KILO', 'KILOGRAM', 'KILOGRAMS');
define('MASS', 0.001, 'G', 'GM', 'GRAM', 'GRAMS');
define('MASS', 1000, 'MT', 'MTS', 'TON', 'TONS', 'TONNE', 'TONNES', 'METRIC TON', 'METRIC TONS', 'METRIC TONNE');
define('MASS', 100, 'QTL', 'QUINTAL');
define('MASS', 0.45359237, 'LB', 'LBS', 'POUND', 'POUNDS');

define('COUNT', 1, 'PCS', 'PC', 'PIECE', 'PIECES', 'EA', 'EACH', 'UNIT', 'UNITS', 'NOS', 'NO', 'NUMBER');
define('COUNT', 12, 'DOZ', 'DZN', 'DOZEN', 'DOZENS');
define('COUNT', 144, 'GROSS');
define('PAIR', 1, 'PR', 'PRS', 'PAIR', 'PAIRS');

define('LENGTH', 1, 'MTR', 'MTRS', 'M', 'METER', 'METERS', 'METRE', 'METRES');
define('LENGTH', 0.01, 'CM');
define('LENGTH', 0.9144, 'YD', 'YDS', 'YARD', 'YARDS');
define('LENGTH', 0.3048, 'FT', 'FEET', 'FOOT');

define('AREA', 1, 'SQM', 'M2', 'SQ M', 'SQUARE METER', 'SQUARE METRE');
define('AREA', 0.09290304, 'SQFT', 'SQ FT');

define('VOLUME', 1, 'L', 'LTR', 'LTRS', 'LITER', 'LITERS', 'LITRE', 'LITRES');
define('VOLUME', 0.001, 'ML');
define('VOLUME', 3.785411784, 'GAL', 'GALLON', 'GALLONS');
define('VOLUME', 158.987294928, 'BBL', 'BARREL', 'BARRELS');

function lookup(unit: string | undefined): UnitDef | null {
  const key = (unit ?? '').toUpperCase().replace(/\./g, '').replace(/\s+/g, ' ').trim();
  return UNITS[key] ?? null;
}

/**
 * The price per `to` unit equivalent to `price` per `from` unit, or null when the two are not the same
 * kind of quantity (or either is unknown). Identical unit strings always convert, even unknown ones.
 */
export function convertUnitPrice(price: number, from: string | undefined, to: string | undefined): number | null {
  const a = (from ?? '').toUpperCase().trim();
  const b = (to ?? '').toUpperCase().trim();
  if (a === b) return price;
  const fromDef = lookup(from);
  const toDef = lookup(to);
  if (!fromDef || !toDef || fromDef.family !== toDef.family) return null;
  // price per base unit, then per target unit
  return Number(((price / fromDef.perUnit) * toDef.perUnit).toPrecision(12));
}
