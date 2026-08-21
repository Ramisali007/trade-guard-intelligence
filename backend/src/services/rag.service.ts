import { config } from '../config';
import { getDocumentService } from './document.service';
import type { AnalyzedUnit } from '../models/document.model';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface Citation {
  pageNumber: number;
  paragraphNumber: number;
  section: string | null;
  snippet: string;
}

export interface ChatResponse {
  answer: string;
  citations: Citation[];
  model: string;
  provider: string;
}

const PLATFORM_KNOWLEDGE = `
You are the DocuIntel AI Assistant, an advanced AI reasoning system integrated into the DocuIntel Document Intelligence Platform.

YOUR TASK:
Analyze the user's inquiry and provide a comprehensive, intelligent, and accurate response based on the platform's architecture and capabilities.

STRICT DOMAIN BOUNDARY:
- You are strictly scoped to the DocuIntel AI Platform, document analysis, multi-dimensional classification, and uploaded document processing.
- If the user asks about unrelated topics (e.g. fashion/shoes like Nike, cooking, sports, general pop trivia, weather, etc.), politely refuse and inform the user that you are specialized in DocuIntel AI and document analysis, and invite them to ask about the website's features, pipeline, classifications, or their uploaded documents.

DocuIntel Platform Knowledge:
- Architecture: Angular standalone frontend + Express TypeScript backend.
- Workflow: Multi-format Upload (PDF, DOC, DOCX up to 50MB) -> Text Extraction -> Normalization -> Structural Segmentation -> Token-Budgeted Chunking -> AI Multi-Dimensional Classification -> Statistical Aggregation -> Structured .txt Report Generation.
- Classification Dimensions:
  * Sentiment: Positive, Negative, Neutral.
  * Emotion: Happy, Sad, Angry, Excited, Fear, Surprise, Neutral.
  * Content Type: Mathematical, Technical, Informational, Narrative, Question, Instruction, Opinion, Complaint, Feedback, Other.
  * Topic: Finance, Technology, Healthcare, Education, Business, Legal, Marketing, Customer Support, Research, etc.
  * Confidence: Exact probabilistic certainty score per paragraph.
- Scalability: Handles large documents with hundreds/thousands of pages using smart chunking and concurrent queue processing.
- Visualizations: Animated KPIs, Sentiment Donut Chart, Emotion Distribution Bar Chart, Content Types Bar Chart, Document Timeline Progression.
- Detailed Explorer: Instant keyword search, multi-faceted filtering, confidence scoring, expand/collapse text.
`;

export class RagService {
  /**
   * Chat about the DocuIntel AI platform/website using live AI model.
   */
  async chatPlatform(messages: ChatMessage[]): Promise<ChatResponse> {
    const hasLiveAi = Boolean(config.ai.openAiCompatible.apiKey || config.ai.anthropic.apiKey);

    if (hasLiveAi) {
      try {
        const systemPrompt = `${PLATFORM_KNOWLEDGE}\nRespond strictly and intelligently as the DocuIntel AI platform assistant.`;
        const answer = await this.callAiDirect(systemPrompt, messages);
        return {
          answer,
          citations: [],
          model: config.ai.openAiCompatible.model || 'live-ai-model',
          provider: 'Groq Cloud / Llama 3.3 70B',
        };
      } catch (err: any) {
        console.error('Live AI call failed, falling back to local reasoning:', err?.message || err);
      }
    }

    const userQuery = messages[messages.length - 1]?.content || '';
    return {
      answer: this.generateLocalPlatformAnswer(userQuery),
      citations: [],
      model: 'local-knowledge-engine',
      provider: 'DocuIntel Knowledge Base',
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

    const citations: Citation[] = topPassages.map((p) => ({
      pageNumber: p.pageNumber,
      paragraphNumber: p.paragraphNumber,
      section: p.section,
      snippet: p.text.length > 220 ? p.text.slice(0, 217) + '...' : p.text,
    }));

    const hasLiveAi = Boolean(config.ai.openAiCompatible.apiKey || config.ai.anthropic.apiKey);

    if (hasLiveAi) {
      try {
        const contextText = topPassages
          .map(
            (p, i) =>
              `[Passage ${i + 1} | Page ${p.pageNumber}, Para ${p.paragraphNumber}${p.section ? ', Section: ' + p.section : ''} | Sentiment: ${p.classification.sentiment}, Type: ${p.classification.contentType}]\n${p.text}`,
          )
          .join('\n\n');

        const systemPrompt = `You are DocuIntel AI Assistant. You are analyzing the uploaded document "${doc.filename}".
Analyze the user's query and provide a thorough, accurate answer based on the following extracted document passages.
STRICT INSTRUCTIONS:
1. Always cite the exact Page number and Paragraph number when stating facts from the text.
2. If the user asks about an off-topic subject unrelated to "${doc.filename}" or the platform, politely decline and remind them to ask about "${doc.filename}".
3. Provide a clear, insightful, professional response.

DOCUMENT CONTEXT PASSAGES:
========================================
${contextText}
========================================`;

        const answer = await this.callAiDirect(systemPrompt, messages);
        return {
          answer,
          citations,
          model: config.ai.openAiCompatible.model || 'live-ai-model',
          provider: 'Groq Cloud / Llama 3.3 70B',
        };
      } catch (err: any) {
        console.error('Live document AI call failed, falling back:', err?.message || err);
      }
    }

    const localAnswer = this.generateLocalDocumentAnswer(userQuery, doc.filename, topPassages);
    return {
      answer: localAnswer,
      citations,
      model: 'local-rag-v1',
      provider: 'DocuIntel Local RAG',
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
            ...messages.map((m) => ({ role: m.role, content: m.content })),
          ],
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`AI API Error ${response.status}: ${errText}`);
      }

      const data: any = await response.json();
      return data.choices?.[0]?.message?.content || 'No response generated.';
    }

    throw new Error('No compatible AI provider configured with API key');
  }

  private generateLocalPlatformAnswer(query: string): string {
    const q = query.trim().toLowerCase();

    if (q.includes('format') || q.includes('upload') || q.includes('file') || q.includes('size') || q.includes('pdf') || q.includes('docx') || q.includes('doc')) {
      return `DocuIntel AI supports **PDF**, Microsoft Word (**DOC** and **DOCX**) documents up to **50 MB**. You can upload small memos or multi-hundred-page reports; the platform automatically performs structure detection and parallel chunking.`;
    }
    if (q.includes('classif') || q.includes('sentiment') || q.includes('emotion') || q.includes('dimension') || q.includes('category') || q.includes('math') || q.includes('topic')) {
      return `DocuIntel AI classifies document content across multiple key dimensions:\n\n1. **Sentiment**: Positive, Negative, Neutral\n2. **Emotion**: Happy, Sad, Angry, Excited, Fear, Surprise, Neutral\n3. **Content Type**: Mathematical, Technical, Informational, Narrative, Question, Instruction, Opinion, Complaint, Feedback, etc.\n4. **Topic**: Finance, Technology, Legal, Healthcare, Business, Research, etc.\n5. **Confidence Score**: Exact 0–100% certainty rating for every passage.`;
    }
    if (q.includes('report') || q.includes('txt') || q.includes('download') || q.includes('export')) {
      return `After analyzing your document, DocuIntel AI generates a clean, structured **.txt report** containing executive summaries, sentiment & emotion breakdowns, and paragraph-level detailed analysis. You can preview it inside the app or download it directly with one click!`;
    }
    if (q.includes('how') || q.includes('work') || q.includes('architecture') || q.includes('chunk') || q.includes('stage') || q.includes('pipeline')) {
      return `DocuIntel AI operates through a 7-stage pipeline:\n1. Document Upload & Magic-Byte Validation\n2. High-fidelity Text Extraction (PDF/DOCX)\n3. Structural Segmentation (Headings, Paragraphs, Lists, Math)\n4. Token-Budgeted Chunking\n5. Multi-dimensional AI Classification\n6. Statistical Aggregation & KPI Computation\n7. Structured Report & Interactive Analytics Dashboard Generation.`;
    }
    if (q === 'hi' || q === 'hello' || q === 'hey' || q === 'help' || q.startsWith('hello') || q.startsWith('hi ')) {
      return `Hello! I am your **DocuIntel AI Assistant**. I can help you understand the platform, explain how document analysis and classification work, or answer questions about your uploaded documents. What would you like to know?`;
    }

    return `I can only answer questions related to the **DocuIntel AI platform**, document intelligence, and your uploaded documents. Please feel free to ask me anything about how the website works, supported file types (PDF/DOC/DOCX), our 7-stage processing pipeline, classification categories, or your documents!`;
  }

  private generateLocalDocumentAnswer(query: string, filename: string, passages: AnalyzedUnit[]): string {
    const q = query.trim().toLowerCase();

    const offTopicKeywords = ['nike', 'adidas', 'shoe', 'shoes', 'weather', 'recipe', 'movie', 'song', 'president', 'celebrity'];
    if (offTopicKeywords.some((w) => q.includes(w))) {
      return `I can only answer questions related to the uploaded document "${filename}" and the DocuIntel AI platform. Please ask a question about the contents of "${filename}" or how the website works!`;
    }

    if (passages.length === 0 || !passages[0]) {
      return `I examined "${filename}", but could not find passages directly matching "${query}". Please try searching with different keywords related to the document.`;
    }

    const top = passages[0];
    const otherRefs = passages.slice(1, 3).map((p) => `Page ${p.pageNumber} (¶${p.paragraphNumber})`).join(', ');

    return `Based on "${filename}":\n\nIn **Page ${top.pageNumber} (Paragraph ${top.paragraphNumber})** [Classification: ${top.classification.sentiment}, ${top.classification.contentType}]:\n"${top.text.slice(0, 300)}${top.text.length > 300 ? '...' : ''}"\n\n${otherRefs ? `Related passages were also found on ${otherRefs}.` : ''}`;
  }
}

let ragServiceInstance: RagService | null = null;
export function getRagService(): RagService {
  ragServiceInstance ??= new RagService();
  return ragServiceInstance;
}
