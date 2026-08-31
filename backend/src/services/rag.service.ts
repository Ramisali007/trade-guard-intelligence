import { config } from '../config';
import { getDocumentService } from './document.service';
import type { AnalyzedUnit } from '../models/document.model';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface Citation {
  index: number;
  unitId?: string;
  pageNumber: number;
  paragraphNumber: number;
  section: string | null;
  snippet: string;
  sentiment?: string;
  contentType?: string;
  topic?: string;
  confidence?: number;
}

export interface ChatResponse {
  answer: string;
  citations: Citation[];
  model: string;
  provider: string;
}

const PLATFORM_KNOWLEDGE = `
You are the Trade Finance Compliance & Risk Intelligence AI Assistant.
You are specialized in international trade compliance, documentary credit examination (UCP 600 & ISBP 745), sanctions screening (OFAC, UN, EU, UK), export controls & dual-use goods detection (BIS CCL / ECCN), Trade-Based Money Laundering (FATF TBML red flags), and cross-document reconciliation.

PLATFORM CAPABILITIES:
- Supported Trade Documents: Commercial & Proforma Invoices, Bills of Lading, Air Waybills, Letters of Credit, Packing Lists, Certificates of Origin, Insurance Policies, End-User Certificates, Inspection Certificates.
- Core Compliance Engines:
  1. Sanctions Screening: OFAC SDN, UN Consolidated, EU Financial Sanctions, UK OFSI/HMT, Vessel IMO checks, SWIFT code checks, and high-risk jurisdictions.
  2. Scope & Authorization Check: Validates commodities against authorized PO, LC, and customer declared business profile (detects OUT_OF_SCOPE_GOODS).
  3. Export Controls & Dual-Use: Identifies potential sensitive/military/dual-use categories (lasers, advanced electronics, UAVs, chemicals, nuclear, cryptography).
  4. TBML Risk Engine: Flags pricing anomalies (over/under-invoicing), volume mismatches, complex transshipment routes, and consignee/buyer disconnects.
  5. Mathematical & Document Integrity: Automated verification of Quantity × Unit Price = Line Total, subtotal summations, grand totals, and chronology.
  6. Cross-Document Reconciliation: Unifies Invoice, PO, LC, Packing List, Bill of Lading, and Certificate of Origin to flag discrepancies.
  7. Risk Scoring (0–100) & Decisions: ALLOW, REVIEW, or BLOCK_ESCALATE with full audit trail and human-in-the-loop override actions.
`;

export class RagService {
  /**
   * Chat about the Trade Finance Compliance Platform using live AI model.
   */
  async chatPlatform(messages: ChatMessage[]): Promise<ChatResponse> {
    const hasLiveAi = Boolean(config.ai.openAiCompatible.apiKey || config.ai.anthropic.apiKey);
    const activeModel = config.ai.provider === 'openai-compatible' ? config.ai.openAiCompatible.model : config.ai.anthropic.model;
    const activeProvider = getAiProviderName();

    if (hasLiveAi) {
      try {
        const systemPrompt = `${PLATFORM_KNOWLEDGE}\nRespond strictly as the Trade Finance Compliance Intelligence Assistant with structured, professional banking-grade markdown.`;
        const answer = await this.callAiDirect(systemPrompt, messages);
        return {
          answer,
          citations: [],
          model: activeModel,
          provider: activeProvider,
        };
      } catch (err: any) {
        console.error('Live AI call failed, falling back to local reasoning:', err?.message || err);
      }
    }

    const userQuery = messages[messages.length - 1]?.content || '';
    return {
      answer: this.generateLocalPlatformAnswer(userQuery),
      citations: [],
      model: 'local-compliance-engine',
      provider: 'Trade Compliance Knowledge Base',
    };
  }

  /**
   * Document-specific RAG chat analyzed by the live AI model.
   */
  async chatDocument(documentId: string, messages: ChatMessage[]): Promise<ChatResponse> {
    const userQuery = messages[messages.length - 1]?.content || '';
    const docService = getDocumentService();
    const doc = await docService.getDetail(documentId);

    // Retrieve document passages
    const unitsPage = await docService.getUnits(documentId, { pageSize: 500 });
    const allUnits = unitsPage.items || [];

    // Find top-k relevant chunks using lexical & semantic score
    const topPassages = this.retrieveRelevantPassages(userQuery, allUnits, 8);

    const citations: Citation[] = topPassages.map((p, idx) => ({
      index: idx + 1,
      unitId: p.id,
      pageNumber: p.pageNumber,
      paragraphNumber: p.paragraphNumber,
      section: p.section,
      snippet: p.text.length > 240 ? p.text.slice(0, 237) + '...' : p.text,
      sentiment: p.classification?.sentiment,
      contentType: p.classification?.contentType,
      topic: p.classification?.topic,
      confidence: p.classification?.confidence,
    }));

    const hasLiveAi = Boolean(config.ai.openAiCompatible.apiKey || config.ai.anthropic.apiKey);
    const activeModel = config.ai.provider === 'openai-compatible' ? config.ai.openAiCompatible.model : config.ai.anthropic.model;
    const activeProvider = getAiProviderName();

    const tc = doc.analysis?.tradeCompliance;
    const complianceContext = tc
      ? `
TRANSACTION & COMPLIANCE SUMMARY:
- Document Type: ${tc.documentClassification.type} (${tc.documentClassification.number})
- Overall Decision: ${tc.decision.decision} (Risk Score: ${tc.riskScores.overall}/100, Confidence: ${Math.round(tc.decision.confidence * 100)}%)
- Parties: Seller=${tc.transaction.parties.seller.legalName} (${tc.transaction.parties.seller.country}), Buyer=${tc.transaction.parties.buyer.legalName} (${tc.transaction.parties.buyer.country}), Consignee=${tc.transaction.parties.consignee?.legalName || 'N/A'}, End-User=${tc.transaction.parties.endUser?.legalName || 'Not Disclosed'}
- Route: ${tc.transaction.originCountry} -> ${tc.transaction.destinationCountry} (Incoterm: ${tc.transaction.incoterm}, Total: ${tc.transaction.currency} ${tc.transaction.totalValue.toLocaleString()})
- Sanctions Screening: ${tc.sanctions.status} (Matches: ${tc.sanctions.matches.length}, Jurisdictions: ${tc.sanctions.jurisdictionRisks.map((j) => j.countryName).join(', ') || 'None'})
- Scope Check: ${tc.scopeValidation.hasOutOfScopeGoods ? 'OUT OF SCOPE GOODS DETECTED: ' + tc.scopeValidation.outOfScopeGoods.map((g) => g.productDescription).join(', ') : 'All goods in scope'}
- Export Controls: ${tc.exportControls.riskStatus} (${tc.exportControls.controlledGoods.map((g) => g.itemDescription).join(', ') || 'None'})
- TBML Flags: ${tc.tbml.redFlags.map((r) => r.title).join('; ') || 'No material red flags'}
- Discrepancies: ${tc.discrepancies.map((d) => d.field + ': ' + d.explanation).join('; ') || 'None'}
- Top Reasons: ${tc.decision.reasons.join('. ')}
`
      : '';

    if (hasLiveAi) {
      try {
        const contextText = topPassages
          .map(
            (p, i) =>
              `[Passage ${i + 1} | Page ${p.pageNumber}, Para ${p.paragraphNumber}${p.section ? ', Section: ' + p.section : ''}]\n${p.text}`,
          )
          .join('\n\n');

        const systemPrompt = `You are a Senior Trade Finance Compliance Officer and AI Analyst reviewing "${doc.filename}".
Answer the compliance officer's question using the extracted trade intelligence, compliance analysis findings, and document passages.

${complianceContext}

GUIDELINES:
- Provide clear, evidence-backed answers.
- Specifically address sanctions hits, out-of-scope commodities, TBML indicators, discrepancies, arithmetic errors, or UCP 600 rules if asked.
- Keep the tone authoritative, professional, and audit-ready.

DOCUMENT PASSAGES:
========================================
${contextText}
========================================`;

        const answer = await this.callAiDirect(systemPrompt, messages);
        return {
          answer,
          citations,
          model: activeModel,
          provider: activeProvider,
        };
      } catch (err: any) {
        console.error('Live document AI call failed, falling back:', err?.message || err);
      }
    }

    const localAnswer = this.generateLocalDocumentAnswer(userQuery, doc.filename, topPassages, tc);
    return {
      answer: localAnswer,
      citations,
      model: 'local-compliance-rag',
      provider: 'Trade Compliance Local Engine',
    };
  }

  private retrieveRelevantPassages(query: string, units: AnalyzedUnit[], limit = 8): AnalyzedUnit[] {
    if (units.length === 0) return [];

    const queryTokens = query
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 2);

    if (queryTokens.length === 0) {
      return units.slice(0, limit);
    }

    const scored = units.map((unit) => {
      const textLower = unit.text.toLowerCase();
      let score = 0;

      for (const token of queryTokens) {
        if (textLower.includes(token)) {
          score += 10;
          const regex = new RegExp(token, 'g');
          const matches = textLower.match(regex);
          if (matches) score += matches.length * 2;
        }
      }

      if (unit.unitType === 'heading') score += 5;
      if (unit.classification?.confidence) score += unit.classification.confidence * 2;

      return { unit, score };
    });

    scored.sort((a, b) => b.score - a.score);

    const relevant = scored.filter((s) => s.score > 0).map((s) => s.unit);
    return relevant.length > 0 ? relevant.slice(0, limit) : units.slice(0, limit);
  }

  private async callAiDirect(system: string, messages: ChatMessage[]): Promise<string> {
    if (config.ai.openAiCompatible.apiKey) {
      const url = `${config.ai.openAiCompatible.baseUrl.replace(/\/+$/, '')}/chat/completions`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${config.ai.openAiCompatible.apiKey}`,
        },
        body: JSON.stringify({
          model: config.ai.openAiCompatible.model,
          temperature: 0.2,
          max_tokens: 1400,
          messages: [
            { role: 'system', content: system },
            ...messages.slice(-8),
          ],
        }),
      });

      if (!response.ok) {
        throw new Error(`AI Gateway responded with status ${response.status}`);
      }

      const json = (await response.json()) as any;
      const content = json?.choices?.[0]?.message?.content;
      if (!content) throw new Error('No content received from AI');
      return content;
    }

    if (config.ai.anthropic.apiKey) {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': config.ai.anthropic.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: config.ai.anthropic.model,
          max_tokens: 1400,
          system,
          messages: messages.slice(-8).map((m) => ({
            role: m.role === 'assistant' ? 'assistant' : 'user',
            content: m.content,
          })),
        }),
      });

      if (!response.ok) {
        throw new Error(`Anthropic responded with status ${response.status}`);
      }

      const json = (await response.json()) as any;
      const text = json?.content?.[0]?.text;
      if (!text) throw new Error('No text received from Anthropic');
      return text;
    }

    throw new Error('No AI provider configured');
  }

  private generateLocalPlatformAnswer(query: string): string {
    const q = query.toLowerCase();
    if (q.includes('sanction') || q.includes('ofac') || q.includes('watchlist')) {
      return `### Sanctions & Watchlist Screening
The platform screens all transaction parties, banks, vessels (IMO), and jurisdictions against:
- **OFAC SDN & Sectoral Sanctions**
- **UN Security Council Consolidated List**
- **EU Financial Sanctions & UK OFSI/HMT**
- **FATF High-Risk Jurisdictions**

Screening evaluates legal names, aliases, corporate registries, and provides granular match confidence with timestamped audit trails.`;
    }

    if (q.includes('tbml') || q.includes('money laundering') || q.includes('fatf')) {
      return `### Trade-Based Money Laundering (TBML) Detection
The TBML Risk Module evaluates FATF red flags including:
- **Over-invoicing & Under-invoicing**: Unit pricing anomalies vs market wholesale benchmarks.
- **Customer/Product Mismatch**: Commodities inconsistent with buyer declared business.
- **Circuitous Routing**: Unnecessary transshipment through high-risk transit hubs.
- **Consignee Disconnect**: Goods shipped to parties unrelated to purchasing entity.`;
    }

    if (q.includes('scope') || q.includes('authorization') || q.includes('dual use') || q.includes('export control')) {
      return `### Scope Authorization & Dual-Use Detection
- **Trade Scope Validation**: Checks invoice items against authorized purchase orders, LC terms, and customer profiles, flagging \`OUT_OF_SCOPE_GOODS\`.
- **Export Control Screening**: Flags dual-use commodities (lasers, advanced electronics, UAVs, aerospace, precursor equipment) with suggested ECCN classifications.`;
    }

    return `### Trade Finance Compliance Intelligence Platform
The platform provides bank-grade compliance decision support for international trade documentation:
- **Document Classification & Party Extraction**: Invoices, Bills of Lading, Letters of Credit, Packing Lists.
- **Multi-Engine Screening**: Sanctions, Dual-Use, TBML, Mathematical Verification, and Cross-Document Reconciliation.
- **Explainable Decisions**: \`ALLOW\`, \`REVIEW\`, or \`BLOCK_ESCALATE\` with evidence-based reasoning and human-in-the-loop action logging.`;
  }

  private generateLocalDocumentAnswer(query: string, filename: string, passages: AnalyzedUnit[], tc?: any): string {
    if (tc) {
      return `### Document Compliance Summary: ${filename}
- **Document Type**: ${tc.documentClassification.type} (${tc.documentClassification.number})
- **Compliance Decision**: **${tc.decision.decision}** (Risk Score: ${tc.riskScores.overall}/100)
- **Buyer**: ${tc.transaction.parties.buyer.legalName} | **Seller**: ${tc.transaction.parties.seller.legalName}
- **Total Value**: ${tc.transaction.currency} ${tc.transaction.totalValue.toLocaleString()} (${tc.transaction.incoterm})

**Key Findings**:
${tc.decision.reasons.map((r: string) => `- ${r}`).join('\n')}

**Recommended Actions**:
${tc.decision.recommendedActions.map((a: string) => `- ${a}`).join('\n')}`;
    }

    return `### Document Overview: ${filename}
Extracted ${passages.length} relevant passages from the document. Please inspect the compliance scorecard and paragraph explorer for granular field citations.`;
  }
}

function getAiProviderName(): string {
  if (config.ai.provider === 'openai-compatible') return 'Groq / OpenAI Compatible Engine';
  if (config.ai.provider === 'anthropic') return 'Anthropic Claude';
  return 'Local Heuristic Engine';
}

let ragServiceInstance: RagService | null = null;
export function getRagService(): RagService {
  if (!ragServiceInstance) {
    ragServiceInstance = new RagService();
  }
  return ragServiceInstance;
}
