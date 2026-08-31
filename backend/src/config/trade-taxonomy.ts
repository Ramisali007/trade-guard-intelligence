/**
 * Trade Finance Document Compliance & Risk Intelligence Taxonomy
 */

export const TRADE_DOCUMENT_TYPES = [
  // Commercial / Transaction Documents
  { id: 'commercial_invoice', label: 'Commercial Invoice', category: 'commercial' },
  { id: 'proforma_invoice', label: 'Proforma Invoice', category: 'commercial' },
  { id: 'purchase_order', label: 'Purchase Order', category: 'commercial' },
  { id: 'sales_contract', label: 'Sales Contract', category: 'commercial' },
  { id: 'letter_of_credit', label: 'Letter of Credit / Documentary Credit', category: 'commercial' },
  { id: 'bill_of_exchange', label: 'Bill of Exchange / Draft', category: 'commercial' },
  { id: 'quotation', label: 'Quotation', category: 'commercial' },
  { id: 'order_confirmation', label: 'Order Confirmation', category: 'commercial' },
  { id: 'trade_finance_application', label: 'Trade Finance Application', category: 'commercial' },
  { id: 'beneficiary_certificate', label: 'Beneficiary Certificate', category: 'commercial' },

  // Shipping / Logistics Documents
  { id: 'bill_of_lading', label: 'Bill of Lading', category: 'shipping' },
  { id: 'sea_waybill', label: 'Sea Waybill', category: 'shipping' },
  { id: 'air_waybill', label: 'Air Waybill', category: 'shipping' },
  { id: 'road_transport_document', label: 'Road Transport Document (CMR)', category: 'shipping' },
  { id: 'rail_transport_document', label: 'Rail Transport Document (CIM)', category: 'shipping' },
  { id: 'multimodal_transport_document', label: 'Multimodal Transport Document', category: 'shipping' },
  { id: 'charter_party_bill_of_lading', label: 'Charter Party Bill of Lading', category: 'shipping' },
  { id: 'delivery_order', label: 'Delivery Order', category: 'shipping' },
  { id: 'shipping_instruction', label: 'Shipping Instruction', category: 'shipping' },
  { id: 'freight_cargo_document', label: 'Freight / Cargo Document', category: 'shipping' },

  // Supporting Trade Documents
  { id: 'packing_list', label: 'Packing List', category: 'supporting' },
  { id: 'weight_list', label: 'Weight List', category: 'supporting' },
  { id: 'certificate_of_origin', label: 'Certificate of Origin', category: 'supporting' },
  { id: 'insurance_certificate', label: 'Insurance Certificate / Policy', category: 'supporting' },
  { id: 'inspection_certificate', label: 'Inspection Certificate', category: 'supporting' },
  { id: 'quality_certificate', label: 'Quality Certificate', category: 'supporting' },
  { id: 'health_phytosanitary_certificate', label: 'Health / Phytosanitary Certificate', category: 'supporting' },
  { id: 'export_import_license', label: 'Export / Import License', category: 'supporting' },
  { id: 'end_user_certificate', label: 'End-User Certificate', category: 'supporting' },
  { id: 'end_use_certificate', label: 'End-Use Certificate', category: 'supporting' },
  { id: 'customs_declaration', label: 'Customs Declaration / Entry', category: 'supporting' },
  { id: 'other_trade_document', label: 'Other Trade Document', category: 'supporting' },
] as const;

export type TradeDocumentTypeId = (typeof TRADE_DOCUMENT_TYPES)[number]['id'];

export const INCOTERMS = [
  'EXW', 'FCA', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP', // Any transport mode
  'FAS', 'FOB', 'CFR', 'CIF'                       // Sea and inland waterway transport
] as const;

export type IncotermCode = (typeof INCOTERMS)[number];

export const SENSITIVE_COMMODITY_CATEGORIES = [
  'weapons_and_ammunition',
  'military_equipment_and_components',
  'dual_use_technology',
  'advanced_electronics_semiconductors',
  'specialized_computing_ai_hardware',
  'aerospace_and_avionics',
  'navigation_and_guidance_systems',
  'surveillance_and_telecom_interception',
  'cryptography_and_cyber_security',
  'chemical_precursors_and_equipment',
  'biological_materials_and_equipment',
  'nuclear_materials_and_technology',
  'missile_and_rocket_technology',
  'uav_and_drone_technology',
  'high_performance_materials',
  'controlled_industrial_machinery',
  'specialized_laboratory_equipment',
] as const;

export type SensitiveCommodityCategory = (typeof SENSITIVE_COMMODITY_CATEGORIES)[number];

export const RISK_SEVERITY_LEVELS = ['LOW', 'MODERATE', 'ELEVATED', 'HIGH', 'CRITICAL'] as const;
export type RiskSeverity = (typeof RISK_SEVERITY_LEVELS)[number];

export const COMPLIANCE_DECISIONS = ['ALLOW', 'REVIEW', 'BLOCK_ESCALATE'] as const;
export type ComplianceDecision = (typeof COMPLIANCE_DECISIONS)[number];
