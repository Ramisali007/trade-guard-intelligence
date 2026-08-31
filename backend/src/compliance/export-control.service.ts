import type { CommodityLineItem, ExportControlsResult, RiskSeverity } from './types';

interface DualUseRule {
  keywords: string[];
  category: string;
  eccnSuggestion?: string;
  hsPrefixes?: string[];
  reason: string;
  licenseRequirement: string;
  defaultSeverity: RiskSeverity;
}

export class ExportControlService {
  private readonly dualUseRules: DualUseRule[] = [
    {
      keywords: ['laser', 'industrial laser', 'fiber laser', 'co2 laser', 'laser cutting'],
      category: 'Lasers & Sensors / Dual-Use Industrial Equipment',
      eccnSuggestion: '6A005 / 2B006',
      hsPrefixes: ['9013', '8456'],
      reason: 'High-power lasers and precision optical components have potential military and defense manufacturing applications.',
      licenseRequirement: 'Classification required. Check destination and end-user controls under CCL / Dual-Use Regulations.',
      defaultSeverity: 'HIGH',
    },
    {
      keywords: ['semiconductor', 'integrated circuit', 'fpga', 'gpu', 'microprocessor', 'wafer', 'photolithography'],
      category: 'Advanced Electronics & Computing',
      eccnSuggestion: '3A001 / 3E001 / 4A003',
      hsPrefixes: ['8542', '8486'],
      reason: 'Advanced semiconductors and semiconductor fabrication equipment are subject to stringent multilateral export controls.',
      licenseRequirement: 'BIS export license or specific authorization required depending on destination country and end-user entity.',
      defaultSeverity: 'HIGH',
    },
    {
      keywords: ['drone', 'uav', 'unmanned aerial vehicle', 'flight controller', 'autopilot', 'telemetry'],
      category: 'Unmanned Aerial Vehicles & Avionics',
      eccnSuggestion: '9A012 / 9A120',
      hsPrefixes: ['8806', '8807'],
      reason: 'UAV systems, autonomous navigation, and propulsion components have direct military surveillance/payload utility.',
      licenseRequirement: 'Strict export authorization required under Wassenaar Arrangement and national export control regimes.',
      defaultSeverity: 'CRITICAL',
    },
    {
      keywords: ['encryption', 'cryptographic', 'hsm', 'secure communication', 'scrambler', 'cipher'],
      category: 'Information Security & Cryptography',
      eccnSuggestion: '5A002 / 5D002',
      hsPrefixes: ['8517', '8543'],
      reason: 'Information security systems and cryptographic hardware capable of exceeding statutory bit lengths are regulated.',
      licenseRequirement: 'Self-classification reporting or specific encryption export license required.',
      defaultSeverity: 'MODERATE',
    },
    {
      keywords: ['centrifuge', 'precursor', 'fluoropolymer', 'hastelloy', 'zirconium', 'autoclave', 'bioreactor'],
      category: 'Chemical / Biological / Nuclear Processing Equipment',
      eccnSuggestion: '1C350 / 2B350 / 0A001',
      hsPrefixes: ['8419', '8421', '2844'],
      reason: 'Corrosion-resistant vessels, advanced separation equipment, and specialized reactors have dual-use CBRN applications.',
      licenseRequirement: 'Nuclear / Chemical non-proliferation export license and end-user certificate mandatory.',
      defaultSeverity: 'CRITICAL',
    },
    {
      keywords: ['night vision', 'thermal imaging', 'infrared camera', 'flir', 'image intensifier'],
      category: 'Sensors & Night Vision Surveillance',
      eccnSuggestion: '6A002 / 6A003',
      hsPrefixes: ['9005', '9027'],
      reason: 'Thermal imaging and optical night vision devices are subject to strict military/dual-use export controls.',
      licenseRequirement: 'Department of State / Commerce export license required.',
      defaultSeverity: 'CRITICAL',
    },
    {
      keywords: ['aerospace', 'turbine blade', 'avionics', 'inertial navigation', 'gyroscope', 'accelerometer'],
      category: 'Aerospace & Navigation Systems',
      eccnSuggestion: '7A001 / 7A003 / 9A001',
      hsPrefixes: ['9014', '8803', '8411'],
      reason: 'Navigation and aerospace propulsion components are controlled for missile and advanced defense platforms.',
      licenseRequirement: 'Detailed technical parameter review and end-use verification required.',
      defaultSeverity: 'HIGH',
    },
  ];

  analyzeGoods(goods: CommodityLineItem[], destinationCountry?: string): ExportControlsResult {
    const controlledGoods: ExportControlsResult['controlledGoods'] = [];
    const licenseConcerns: string[] = [];

    for (const item of goods) {
      const textToScan = `${item.productDescription} ${item.productCategory || ''} ${item.technicalSpecifications || ''}`.toLowerCase();
      const hs = (item.hsCode || '').replace(/\D/g, '');

      let matchedRule: DualUseRule | null = null;

      for (const rule of this.dualUseRules) {
        const keywordHit = rule.keywords.some((k) => textToScan.includes(k));
        const hsHit = rule.hsPrefixes && rule.hsPrefixes.some((prefix) => hs.startsWith(prefix));

        if (keywordHit || hsHit) {
          matchedRule = rule;
          break;
        }
      }

      if (matchedRule) {
        item.isControlledOrDualUse = true;
        item.controlClassification = matchedRule.category;
        if (!item.eccn && matchedRule.eccnSuggestion) {
          item.eccn = matchedRule.eccnSuggestion;
        }

        const destNote = destinationCountry && destinationCountry !== 'Not Found'
          ? `Destination (${destinationCountry}) warrants enhanced scrutiny for ${matchedRule.category}.`
          : 'Destination classification verification required.';

        controlledGoods.push({
          itemDescription: item.productDescription,
          hsCode: item.hsCode || 'Classification Required',
          eccn: item.eccn || matchedRule.eccnSuggestion || 'Not Specified',
          category: matchedRule.category,
          controlReason: matchedRule.reason,
          licenseRequirement: matchedRule.licenseRequirement,
          destinationConcern: destNote,
          riskSeverity: matchedRule.defaultSeverity,
        });

        licenseConcerns.push(
          `Line ${item.itemNumber} "${item.productDescription}": ${matchedRule.licenseRequirement}`,
        );
      } else {
        item.isControlledOrDualUse = false;
        item.controlClassification = 'Standard Commercial / Uncontrolled';
      }
    }

    let riskStatus: ExportControlsResult['riskStatus'] = 'NO_CONTROL_CONCERN_IDENTIFIED';
    let riskScore = 10;

    if (controlledGoods.some((g) => g.riskSeverity === 'CRITICAL')) {
      riskStatus = 'POTENTIALLY_CONTROLLED';
      riskScore = 90;
    } else if (controlledGoods.length > 0) {
      riskStatus = 'CLASSIFICATION_REQUIRED';
      riskScore = 65;
    } else if (goods.length === 0) {
      riskStatus = 'INSUFFICIENT_INFORMATION';
      riskScore = 30;
    }

    return {
      riskStatus,
      riskScore,
      controlledGoods,
      licenseConcerns,
    };
  }
}
