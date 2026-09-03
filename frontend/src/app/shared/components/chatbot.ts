import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs/operators';
import { ChatService, type ChatMessage, type Citation } from '../../services/chat.service';
import { DocumentsService } from '../../services/documents.service';
import { Icon } from './icon';

interface StructuredSection {
  type: 'overview' | 'topics' | 'findings' | 'text';
  title?: string;
  items?: string[];
  content?: string;
}

interface UiMessage {
  id: string;
  role: 'user' | 'assistant';
  rawText: string;
  overview?: string;
  topics?: string[];
  findings?: string[];
  cleanText?: string;
  citations?: Citation[];
  model?: string;
  provider?: string;
  time: string;
}

@Component({
  selector: 'app-chatbot',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  template: `
    <!-- Floating Trigger Button -->
    <button
      class="chatbot-fab"
      [class.active]="isOpen()"
      (click)="toggleOpen()"
      [attr.aria-label]="isOpen() ? 'Close AI Assistant' : 'Open AI Assistant'"
      title="Ask AI Assistant"
    >
      <div class="fab-ambient" aria-hidden="true"></div>
      @if (isOpen()) {
        <app-icon name="close" [size]="20" />
      } @else {
        <div class="fab-icon-wrap">
          <app-icon name="sparkle" [size]="22" />
          <span class="fab-badge">AI</span>
        </div>
      }
    </button>

    <!-- Chatbot Window Panel -->
    @if (isOpen()) {
      <div class="chatbot-panel" role="dialog" aria-label="DocuIntel AI Assistant">
        <!-- Chat Header -->
        <div class="chat-header">
          <div class="row gap-12 align-center">
            <div class="chat-avatar">
              <app-icon name="sparkle" [size]="18" />
            </div>
            <div>
              <div class="chat-title font-semibold">DocuIntel AI Assistant</div>
              <div class="chat-mode small">
                @if (activeDocumentId()) {
                  <span class="mode-doc">
                    <span class="pulse-dot"></span>
                    RAG Mode · {{ activeDocName() || 'Active Document' }}
                  </span>
                } @else {
                  <span class="mode-platform">● Platform & Architecture Guide</span>
                }
              </div>
            </div>
          </div>

          <div class="row gap-6">
            <button class="btn btn-icon btn-ghost btn-sm" (click)="clearChat()" title="Clear conversation">
              <app-icon name="trash" [size]="14" />
            </button>
            <button class="btn btn-icon btn-ghost btn-sm" (click)="toggleOpen()" title="Close chat">
              <app-icon name="close" [size]="15" />
            </button>
          </div>
        </div>

        <!-- Chat Messages Body -->
        <div class="chat-body" #scrollContainer>
          @if (messages().length === 0) {
            <div class="chat-welcome">
              <div class="welcome-icon-wrap">
                <div class="welcome-icon">
                  <app-icon name="sparkle" [size]="28" />
                </div>
              </div>
              <div class="welcome-title font-semibold mt-14">How can I assist you today?</div>
              <p class="welcome-desc small muted text-center mt-6">
                @if (activeDocumentId()) {
                  Ask questions about the uploaded document, request purpose analysis, key findings, sentiment summaries, or inspect specific topics.
                } @else {
                  Ask about DocuIntel AI features, supported formats (PDF/DOC/DOCX), 7-stage processing pipeline, or classification dimensions.
                }
              </p>

              <!-- Suggestion Chips -->
              <div class="suggestions-list mt-16">
                @for (prompt of suggestions(); track prompt) {
                  <button class="suggestion-chip" (click)="sendPrompt(prompt)">
                    <app-icon name="chevronRight" [size]="12" />
                    <span>{{ prompt }}</span>
                  </button>
                }
              </div>
            </div>
          }

          <!-- Message History -->
          @for (msg of messages(); track msg.id) {
            <div class="chat-bubble-wrap" [class.user]="msg.role === 'user'" [class.assistant]="msg.role === 'assistant'">
              @if (msg.role === 'assistant') {
                <div class="assistant-header row gap-6">
                  <app-icon name="sparkle" [size]="12" />
                  <span class="eyebrow">DocuIntel AI</span>
                  @if (msg.model) {
                    <span class="sep">·</span>
                    <span class="model-tag">{{ formatModelName(msg.model) }}</span>
                  }
                </div>
              }

              <div class="chat-bubble">
                @if (msg.role === 'user') {
                  <div class="user-text">{{ msg.rawText }}</div>
                } @else {
                  <!-- Assistant Structured Content Container -->
                  <div class="assistant-response-container">
                    <!-- 1. Document Overview Card (if detected) -->
                    @if (msg.overview) {
                      <div class="ai-overview-card">
                        <div class="overview-header row gap-8">
                          <app-icon name="document" [size]="14" />
                          <span class="eyebrow">Document Overview</span>
                        </div>
                        <p class="overview-body">{{ msg.overview }}</p>
                      </div>
                    }

                    <!-- 2. Key Topics Chips (if detected) -->
                    @if (msg.topics && msg.topics.length > 0) {
                      <div class="ai-topics-section">
                        <div class="section-label eyebrow">Key Topics</div>
                        <div class="topics-chips-row">
                          @for (topic of msg.topics; track topic) {
                            <span class="topic-chip">
                              <span class="topic-dot"></span>
                              {{ topic }}
                            </span>
                          }
                        </div>
                      </div>
                    }

                    <!-- 3. Key Findings Bullets (if detected) -->
                    @if (msg.findings && msg.findings.length > 0) {
                      <div class="ai-findings-section">
                        <div class="section-label eyebrow">Key Insights & Findings</div>
                        <div class="findings-list">
                          @for (finding of msg.findings; track finding) {
                            <div class="finding-item">
                              <div class="finding-icon">
                                <app-icon name="check" [size]="11" />
                              </div>
                              <div class="finding-text">{{ finding }}</div>
                            </div>
                          }
                        </div>
                      </div>
                    }

                    <!-- 4. Clean Narrative / Main Text Body -->
                    @if (msg.cleanText) {
                      <div class="ai-narrative-text" [innerHTML]="formatMarkdown(msg.cleanText)"></div>
                    }

                    <!-- 5. View Citations Button (When Citations Exist) -->
                    @if (msg.citations && msg.citations.length > 0) {
                      <div class="ai-citations-action-wrap">
                        <button class="btn-view-citations" (click)="navigateToCitations(msg)" title="View complete citations and source evidence in report">
                          <div class="citation-btn-left">
                            <span class="citation-badge-icon">
                              <app-icon name="quote" [size]="13" />
                            </span>
                            <span class="citation-btn-title">View Citations</span>
                            <span class="citation-count-pill">{{ msg.citations.length }} Sources</span>
                          </div>
                          <div class="citation-btn-right">
                            <span class="citation-btn-hint">Inspect in Report</span>
                            <app-icon name="arrowRight" [size]="13" />
                          </div>
                        </button>
                      </div>
                    }
                  </div>
                }

                <div class="chat-time">{{ msg.time }}</div>
              </div>
            </div>
          }

          <!-- Loading Shimmer Bubble -->
          @if (loading()) {
            <div class="chat-bubble-wrap assistant">
              <div class="assistant-header row gap-6">
                <app-icon name="sparkle" [size]="12" />
                <span class="eyebrow">DocuIntel AI</span>
                <span class="model-tag">Analyzing passages...</span>
              </div>
              <div class="chat-bubble typing-bubble">
                <div class="typing-ambient"></div>
                <div class="typing-dots">
                  <span class="typing-dot"></span>
                  <span class="typing-dot"></span>
                  <span class="typing-dot"></span>
                </div>
                <span class="small muted typing-label">Synthesizing document insights...</span>
              </div>
            </div>
          }
        </div>

        <!-- Chat Input Footer -->
        <div class="chat-footer">
          <form (submit)="onSubmit($event)" class="chat-form">
            <input
              #inputField
              type="text"
              class="input chat-input"
              placeholder="Ask anything about the document or platform..."
              [value]="inputText()"
              (input)="onInputChange($event)"
              [disabled]="loading()"
            />
            <button
              type="submit"
              class="btn btn-primary btn-send"
              [disabled]="!inputText().trim() || loading()"
              aria-label="Send message"
            >
              <app-icon name="arrowRight" [size]="16" />
            </button>
          </form>
        </div>
      </div>
    }
  `,
  styles: `
    .chatbot-fab {
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 1050;
      width: 56px;
      height: 56px;
      border-radius: 50%;
      background: linear-gradient(135deg, var(--accent) 0%, #7c3aed 100%);
      color: #fff;
      border: 0;
      box-shadow: 0 6px 24px color-mix(in srgb, var(--accent) 45%, transparent);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition:
        transform var(--dur) var(--ease-spring),
        box-shadow var(--dur) var(--ease);
      overflow: visible;
    }

    .chatbot-fab:hover {
      transform: scale(1.08) translateY(-2px);
      box-shadow: 0 10px 32px color-mix(in srgb, var(--accent) 60%, transparent);
    }

    .chatbot-fab.active {
      transform: rotate(90deg);
      background: var(--raised);
      color: var(--ink);
      border: 1px solid var(--line);
      box-shadow: var(--shadow-lg);
    }

    .fab-ambient {
      position: absolute;
      inset: -4px;
      border-radius: 50%;
      background: inherit;
      filter: blur(10px);
      opacity: 0.4;
      z-index: -1;
      animation: glow-pulse 3s ease-in-out infinite;
    }

    .fab-icon-wrap {
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .fab-badge {
      position: absolute;
      top: -10px;
      right: -12px;
      font-size: 0.6rem;
      font-weight: 800;
      background: linear-gradient(135deg, #ff4785 0%, #ff6b4a 100%);
      color: #fff;
      padding: 1px 5px;
      border-radius: 99px;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.25);
    }

    .chatbot-panel {
      position: fixed;
      bottom: 92px;
      right: 24px;
      z-index: 1040;
      width: 460px;
      max-width: calc(100vw - 32px);
      height: 640px;
      max-height: calc(100vh - 120px);
      background: var(--glass-bg);
      backdrop-filter: blur(24px) saturate(180%);
      -webkit-backdrop-filter: blur(24px) saturate(180%);
      border: 1px solid var(--glass-border);
      border-radius: var(--radius-xl);
      box-shadow: var(--shadow-xl), var(--shadow-glow);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      animation: modal-in 260ms var(--ease-spring);
    }

    .chat-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 14px 18px;
      background: color-mix(in srgb, var(--surface) 85%, transparent);
      border-bottom: 1px solid var(--line);
    }

    .chat-avatar {
      width: 36px;
      height: 36px;
      border-radius: 10px;
      background: linear-gradient(135deg, var(--accent) 0%, #7c3aed 100%);
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      flex: none;
      box-shadow: 0 2px 10px color-mix(in srgb, var(--accent) 35%, transparent);
    }

    .chat-title {
      font-size: 0.94rem;
      line-height: 1.2;
      color: var(--ink);
    }

    .chat-mode {
      font-size: 0.72rem;
      margin-top: 2px;
      color: var(--ink-2);
    }

    .mode-doc {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      color: var(--accent);
      font-weight: 600;
      max-width: 240px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .pulse-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--accent);
      box-shadow: 0 0 8px var(--accent);
      display: inline-block;
    }

    .chat-body {
      flex: 1 1 auto;
      overflow-y: auto;
      padding: 18px;
      display: flex;
      flex-direction: column;
      gap: 16px;
      background: var(--sunken);
    }

    .chat-welcome {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 20px 8px;
    }

    .welcome-icon-wrap {
      position: relative;
    }

    .welcome-icon {
      color: var(--accent);
      padding: 16px;
      background: var(--raised);
      border: 1px solid var(--line);
      border-radius: 50%;
      box-shadow: var(--shadow-sm), var(--glow-accent);
      animation: float 4s ease-in-out infinite;
    }

    .welcome-title {
      font-size: 1.05rem;
      color: var(--ink);
    }

    .suggestions-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
      width: 100%;
    }

    .suggestion-chip {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 14px;
      border: 1px solid var(--line);
      border-radius: var(--radius-sm);
      background: var(--raised);
      color: var(--ink-2);
      font-size: 0.82rem;
      font-weight: 550;
      text-align: left;
      cursor: pointer;
      transition: all var(--dur-fast) var(--ease);
    }

    .suggestion-chip:hover {
      background: #f1f5f9;
      border-color: var(--line-strong);
      color: var(--ink);
      transform: translateX(2px);
      box-shadow: var(--shadow-xs);
    }

    .chat-bubble-wrap {
      display: flex;
      flex-direction: column;
      animation: fade-up var(--dur-fast) var(--ease-out) both;
    }

    .chat-bubble-wrap.user {
      align-items: flex-end;
    }

    .chat-bubble-wrap.assistant {
      align-items: flex-start;
    }

    .assistant-header {
      align-items: center;
      margin-bottom: 5px;
      padding-left: 2px;
      color: var(--accent);
    }

    .model-tag {
      font-size: 0.68rem;
      color: var(--ink-3);
    }

    .chat-bubble {
      max-width: 92%;
      padding: 14px 16px;
      border-radius: var(--radius-lg);
      font-size: 0.88rem;
      line-height: 1.55;
    }

    .chat-bubble-wrap.user .chat-bubble {
      background: linear-gradient(135deg, var(--accent) 0%, color-mix(in srgb, var(--accent) 85%, #7c3aed) 100%);
      color: #fff;
      border-bottom-right-radius: 4px;
      box-shadow: 0 4px 14px color-mix(in srgb, var(--accent) 25%, transparent);
    }

    .chat-bubble-wrap.assistant .chat-bubble {
      background: var(--raised);
      border: 1px solid var(--line);
      color: var(--ink);
      border-bottom-left-radius: 4px;
      box-shadow: var(--shadow-sm);
      width: 100%;
    }

    .user-text {
      white-space: pre-wrap;
      word-break: break-word;
    }

    .assistant-response-container {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    /* ── Overview Card ── */
    .ai-overview-card {
      padding: 12px 16px;
      background: color-mix(in srgb, var(--accent) 6%, var(--raised));
      border: 1px solid color-mix(in srgb, var(--accent) 22%, var(--line));
      border-radius: var(--radius-sm);
      border-left: 3px solid var(--accent);
    }

    .overview-header {
      align-items: center;
      color: var(--accent);
      margin-bottom: 6px;
    }

    .overview-body {
      margin: 0;
      font-size: 0.85rem;
      line-height: 1.5;
      color: var(--ink);
    }

    /* ── Topics Chips ── */
    .section-label {
      font-size: 0.75rem;
      font-weight: 750;
      color: #344054;
      margin-bottom: 6px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .topics-chips-row {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }

    .topic-chip {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 3px 9px;
      background: var(--sunken);
      border: 1px solid var(--line);
      border-radius: 99px;
      font-size: 0.76rem;
      color: var(--ink-2);
      font-weight: 550;
    }

    .topic-dot {
      width: 5px;
      height: 5px;
      border-radius: 50%;
      background: var(--accent);
    }

    /* ── Findings Section ── */
    .findings-list {
      display: flex;
      flex-direction: column;
      gap: 7px;
    }

    .finding-item {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      padding: 6px 10px;
      background: var(--sunken);
      border-radius: var(--radius-sm);
      border: 1px solid var(--line);
      font-size: 0.83rem;
      line-height: 1.45;
      color: var(--ink);
    }

    .finding-icon {
      width: 17px;
      height: 17px;
      border-radius: 50%;
      background: var(--positive-soft);
      color: var(--positive);
      display: flex;
      align-items: center;
      justify-content: center;
      flex: none;
      margin-top: 1px;
    }

    /* ── Clean Narrative ── */
    .ai-narrative-text {
      font-size: 0.875rem;
      line-height: 1.6;
      color: var(--ink);
      word-break: break-word;
    }

    .ai-narrative-text p {
      margin: 0 0 8px 0;
    }
    .ai-narrative-text p:last-child {
      margin-bottom: 0;
    }

    /* ── View Citations Button ── */
    .ai-citations-action-wrap {
      margin-top: 6px;
      padding-top: 10px;
      border-top: 1px dashed var(--line);
    }

    .btn-view-citations {
      width: 100%;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 14px;
      background: linear-gradient(135deg, color-mix(in srgb, var(--accent) 10%, var(--raised)) 0%, color-mix(in srgb, #7c3aed 8%, var(--raised)) 100%);
      border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--line));
      border-radius: var(--radius);
      color: var(--ink);
      cursor: pointer;
      transition:
        background var(--dur-fast) var(--ease),
        border-color var(--dur-fast) var(--ease),
        transform var(--dur-fast) var(--ease),
        box-shadow var(--dur-fast) var(--ease);
      box-shadow: 0 2px 6px color-mix(in srgb, var(--accent) 12%, transparent);
    }

    .btn-view-citations:hover {
      background: linear-gradient(135deg, color-mix(in srgb, var(--accent) 18%, var(--raised)) 0%, color-mix(in srgb, #7c3aed 14%, var(--raised)) 100%);
      border-color: var(--accent);
      transform: translateY(-1px);
      box-shadow: 0 4px 12px color-mix(in srgb, var(--accent) 22%, transparent);
    }

    .citation-btn-left {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .citation-badge-icon {
      width: 22px;
      height: 22px;
      border-radius: 6px;
      background: var(--accent);
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .citation-btn-title {
      font-size: 0.85rem;
      font-weight: 650;
      color: var(--ink);
    }

    .citation-count-pill {
      font-size: 0.7rem;
      font-weight: 600;
      padding: 2px 7px;
      border-radius: 99px;
      background: var(--accent-soft);
      color: var(--accent);
    }

    .citation-btn-right {
      display: flex;
      align-items: center;
      gap: 6px;
      color: var(--accent);
      font-size: 0.76rem;
      font-weight: 550;
    }

    .chat-time {
      font-size: 0.68rem;
      margin-top: 6px;
      text-align: right;
      color: var(--ink-3);
    }

    .chat-bubble-wrap.user .chat-time {
      color: rgba(255, 255, 255, 0.75);
    }

    /* ── Typing Bubble ── */
    .typing-bubble {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 14px 18px;
    }

    .typing-dots {
      display: flex;
      align-items: center;
      gap: 5px;
    }

    .typing-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--accent);
      animation: typing 1.4s infinite ease-in-out both;
    }
    .typing-dot:nth-child(1) { animation-delay: -0.32s; }
    .typing-dot:nth-child(2) { animation-delay: -0.16s; }

    @keyframes typing {
      0%, 80%, 100% { transform: scale(0.3); opacity: 0.3; }
      40% { transform: scale(1); opacity: 1; }
    }

    .chat-footer {
      padding: 12px 16px;
      background: color-mix(in srgb, var(--surface) 85%, transparent);
      border-top: 1px solid var(--line);
    }

    .chat-form {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .chat-input {
      flex: 1 1 auto;
      padding: 10px 14px;
      font-size: 0.86rem;
      border-radius: var(--radius);
    }

    .btn-send {
      padding: 10px 14px;
      flex: none;
      border-radius: var(--radius);
    }

    .font-semibold { font-weight: 650; }
    .text-center { text-align: center; }
    .sep { opacity: 0.35; margin: 0 2px; }
  `,
})
export class Chatbot {
  @ViewChild('scrollContainer') private scrollContainer?: ElementRef<HTMLDivElement>;

  private readonly chatService = inject(ChatService);
  private readonly docsService = inject(DocumentsService);
  private readonly router = inject(Router);

  protected readonly isOpen = signal(false);
  protected readonly inputText = signal('');
  protected readonly loading = signal(false);
  protected readonly messages = signal<UiMessage[]>([]);
  protected readonly activeDocumentId = signal<string | null>(null);
  protected readonly activeDocName = signal<string | null>(null);

  protected readonly suggestions = computed(() => {
    if (this.activeDocumentId()) {
      return [
        'Tell me about this document',
        'Summarize the key findings and purpose',
        'What are the positive and negative points?',
        'What are the main topics discussed?',
      ];
    }
    return [
      'What file formats are supported?',
      'How does multi-dimensional classification work?',
      'How are large multi-page documents chunked?',
      'What is included in the downloadable .txt report?',
    ];
  });

  constructor() {
    this.router.events
      .pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd))
      .subscribe((event) => {
        const url = event.urlAfterRedirects;
        const match = url.match(/\/analysis\/([a-zA-Z0-9_-]+)/);
        const docId = match ? match[1] : null;
        this.activeDocumentId.set(docId);
        if (docId) {
          this.docsService.detail(docId).subscribe({
            next: (doc) => this.activeDocName.set(doc.filename),
            error: () => this.activeDocName.set(null),
          });
        } else {
          this.activeDocName.set(null);
        }
      });
  }

  toggleOpen(): void {
    this.isOpen.update((v) => !v);
    if (this.isOpen()) {
      setTimeout(() => this.scrollToBottom(), 100);
    }
  }

  clearChat(): void {
    this.messages.set([]);
  }

  onInputChange(event: Event): void {
    this.inputText.set((event.target as HTMLInputElement).value);
  }

  sendPrompt(prompt: string): void {
    this.inputText.set(prompt);
    this.executeSend();
  }

  onSubmit(event: Event): void {
    event.preventDefault();
    this.executeSend();
  }

  private executeSend(): void {
    const text = this.inputText().trim();
    if (!text || this.loading()) return;

    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const userMsg: UiMessage = {
      id: 'user-' + Date.now(),
      role: 'user',
      rawText: text,
      time,
    };

    this.messages.update((list) => [...list, userMsg]);
    this.inputText.set('');
    this.loading.set(true);
    setTimeout(() => this.scrollToBottom(), 50);

    const apiMessages: ChatMessage[] = this.messages().map((m) => ({
      role: m.role,
      content: m.rawText,
    }));

    const docId = this.activeDocumentId();
    const req = docId
      ? this.chatService.chatDocument(docId, apiMessages)
      : this.chatService.chatPlatform(apiMessages);

    req.subscribe({
      next: (res) => {
        const parsed = this.parseAssistantResponse(res.answer);
        const botMsg: UiMessage = {
          id: 'bot-' + Date.now(),
          role: 'assistant',
          rawText: res.answer,
          overview: parsed.overview,
          topics: parsed.topics,
          findings: parsed.findings,
          cleanText: parsed.cleanText,
          citations: res.citations && res.citations.length > 0 ? res.citations : undefined,
          model: res.model,
          provider: res.provider,
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        };
        this.messages.update((list) => [...list, botMsg]);
        this.loading.set(false);
        setTimeout(() => this.scrollToBottom(), 50);
      },
      error: () => {
        const botMsg: UiMessage = {
          id: 'bot-err-' + Date.now(),
          role: 'assistant',
          rawText: 'I could not process that query. Please try again.',
          cleanText: 'I could not process that query. Please try again.',
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        };
        this.messages.update((list) => [...list, botMsg]);
        this.loading.set(false);
        setTimeout(() => this.scrollToBottom(), 50);
      },
    });
  }

  protected navigateToCitations(msg: UiMessage): void {
    const docId = this.activeDocumentId();
    if (docId) {
      this.router.navigate(['/analysis', docId], { fragment: 'citations' }).then(() => {
        const el = document.getElementById('citations');
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
          el.classList.add('highlight-pulse');
          setTimeout(() => el.classList.remove('highlight-pulse'), 2500);
        }
      });
    }
  }

  private parseAssistantResponse(raw: string): {
    overview?: string;
    topics?: string[];
    findings?: string[];
    cleanText: string;
  } {
    // 1. Strip raw markdown tables (e.g. | Finding | Supporting Passage | etc.)
    let text = raw.replace(/\|[^\n]+\|\n\|[-:\s|]+\|\n(\|[^\n]+\|\n?)*/g, '').trim();

    // 2. Strip technical inline citation markers like *([Page 1, Para 4, ...])* or [1], [Passage 1]
    text = text.replace(/\*\(\[Page\s+\d+[^\]]*\]\)\*/gi, '');
    text = text.replace(/\[Page\s+\d+[^\]]*\]/gi, '');
    text = text.replace(/\[\d+\]/g, '');

    let overview: string | undefined;
    const topics: string[] = [];
    const findings: string[] = [];

    // Check for Overview section
    const overviewMatch = text.match(/(?:\*\*Document Overview(?:\s*\/\s*Purpose)?\*\*|###\s*Document Overview)[:\s]*([\s\S]*?)(?=(?:\*\*(?:Key Topics|Key Findings|Summary)|###|$))/i);
    if (overviewMatch && overviewMatch[1]?.trim()) {
      overview = overviewMatch[1].trim();
      text = text.replace(overviewMatch[0], '').trim();
    }

    // Check for Topics section
    const topicsMatch = text.match(/(?:\*\*Key Topics\*\*|###\s*Key Topics)[:\s]*([\s\S]*?)(?=(?:\*\*(?:Key Findings|Summary|Conclusion)|###|$))/i);
    if (topicsMatch && topicsMatch[1]?.trim()) {
      const rawTopics = topicsMatch[1].split(/\n|·|,/).map(t => t.replace(/^[-*•\d.)\s]+/, '').trim()).filter(t => t.length > 1 && t.length < 50);
      topics.push(...rawTopics.slice(0, 8));
      text = text.replace(topicsMatch[0], '').trim();
    }

    // Check for Findings section
    const findingsMatch = text.match(/(?:\*\*Key Findings(?:\s*&\s*Insights)?\*\*|###\s*Key Findings)[:\s]*([\s\S]*?)(?=(?:\*\*(?:Summary|Next Steps|Document Structure)|###|$))/i);
    if (findingsMatch && findingsMatch[1]?.trim()) {
      const rawFindings = findingsMatch[1].split(/\n/).map(f => f.replace(/^[-*•\d.)\s]+/, '').trim()).filter(f => f.length > 5);
      findings.push(...rawFindings.slice(0, 6));
      text = text.replace(findingsMatch[0], '').trim();
    }

    // Clean up residual headers and multiple newlines
    text = text.replace(/^\s*\*\*Summary\*\*[:\s]*/i, '');
    text = text.replace(/\n{3,}/g, '\n\n').trim();

    return {
      overview,
      topics: topics.length > 0 ? topics : undefined,
      findings: findings.length > 0 ? findings : undefined,
      cleanText: text,
    };
  }

  protected formatMarkdown(md: string): string {
    if (!md) return '';
    let html = md
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // Bold
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    // Italic
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    // Inline code
    html = html.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');
    // Headings
    html = html.replace(/^###\s+(.+)$/gm, '<div class="md-h3 font-semibold mt-8 mb-4">$1</div>');
    html = html.replace(/^##\s+(.+)$/gm, '<div class="md-h2 font-semibold mt-10 mb-4">$1</div>');
    // Paragraphs
    html = html.replace(/\n\n+/g, '</p><p>');
    html = `<p>${html}</p>`;
    // Clean empty paragraphs
    html = html.replace(/<p>\s*<\/p>/g, '');

    return html;
  }

  protected formatModelName(model: string): string {
    if (model.includes('gpt-oss-120b')) return 'GPT-OSS 120B';
    if (model.includes('gpt-oss-20b')) return 'GPT-OSS 20B';
    if (model.includes('llama')) return 'Llama 3.3';
    return model;
  }

  private scrollToBottom(): void {
    if (this.scrollContainer) {
      this.scrollContainer.nativeElement.scrollTop = this.scrollContainer.nativeElement.scrollHeight;
    }
  }
}
