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
import { Icon } from './icon';

interface UiMessage {
  role: 'user' | 'assistant';
  text: string;
  citations?: Citation[];
  model?: string;
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
      <div class="chatbot-panel">
        <!-- Chat Header -->
        <div class="chat-header">
          <div class="row gap-10">
            <div class="chat-avatar">
              <app-icon name="sparkle" [size]="16" />
            </div>
            <div>
              <div class="chat-title font-semibold">DocuIntel AI Assistant</div>
              <div class="chat-mode small muted">
                @if (activeDocumentId()) {
                  <span class="mode-doc">● RAG Mode (Active Document)</span>
                } @else {
                  <span>● Platform & Architecture Guide</span>
                }
              </div>
            </div>
          </div>

          <div class="row gap-6">
            <button class="btn btn-icon btn-ghost btn-sm" (click)="clearChat()" title="Clear conversation">
              <app-icon name="trash" [size]="14" />
            </button>
            <button class="btn btn-icon btn-ghost btn-sm" (click)="toggleOpen()" title="Close">
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
              <div class="font-semibold text-center mt-12">How can I help you today?</div>
              <p class="small muted text-center mt-6">
                @if (activeDocumentId()) {
                  Ask questions about the currently open document or request summaries, sentiment details, and citations.
                } @else {
                  Ask about DocuIntel AI features, supported formats, 7-stage processing, classification dimensions, or architecture.
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
          @for (msg of messages(); track $index) {
            <div class="chat-bubble-wrap" [class.user]="msg.role === 'user'" [class.assistant]="msg.role === 'assistant'">
              <div class="chat-bubble">
                <div class="chat-bubble-text">{{ msg.text }}</div>

                <!-- Citations if present -->
                @if (msg.citations && msg.citations.length > 0) {
                  <div class="citations-container mt-10">
                    <div class="eyebrow citations-title">Source Citations</div>
                    <div class="citations-list">
                      @for (cite of msg.citations; track $index) {
                        <div class="citation-card">
                          <div class="citation-meta eyebrow">
                            Page {{ cite.pageNumber }} • ¶{{ cite.paragraphNumber }}
                            @if (cite.section) {
                              <span>(§ {{ cite.section }})</span>
                            }
                          </div>
                          <div class="citation-snippet small">{{ cite.snippet }}</div>
                        </div>
                      }
                    </div>
                  </div>
                }

                <div class="chat-time small muted">{{ msg.time }}</div>
              </div>
            </div>
          }

          <!-- Typing Indicator -->
          @if (loading()) {
            <div class="chat-bubble-wrap assistant">
              <div class="chat-bubble typing-bubble">
                <span class="typing-dot"></span>
                <span class="typing-dot"></span>
                <span class="typing-dot"></span>
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
      width: 420px;
      max-width: calc(100vw - 32px);
      height: 600px;
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
      background: color-mix(in srgb, var(--surface) 80%, transparent);
      border-bottom: 1px solid var(--line);
    }

    .chat-avatar {
      width: 34px;
      height: 34px;
      border-radius: 10px;
      background: linear-gradient(135deg, var(--accent) 0%, #7c3aed 100%);
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      flex: none;
      box-shadow: 0 2px 8px color-mix(in srgb, var(--accent) 30%, transparent);
    }

    .chat-title {
      font-size: 0.92rem;
      line-height: 1.2;
      color: var(--ink);
    }

    .chat-mode {
      font-size: 0.72rem;
      margin-top: 2px;
    }

    .mode-doc {
      color: var(--accent);
      font-weight: 600;
    }

    .chat-body {
      flex: 1 1 auto;
      overflow-y: auto;
      padding: 18px;
      display: flex;
      flex-direction: column;
      gap: 14px;
      background: var(--sunken);
    }

    .chat-welcome {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 16px 8px;
    }

    .welcome-icon-wrap {
      position: relative;
    }

    .welcome-icon {
      color: var(--accent);
      padding: 14px;
      background: var(--raised);
      border: 1px solid var(--line);
      border-radius: 50%;
      box-shadow: var(--shadow-sm), var(--glow-accent);
      animation: float 4s ease-in-out infinite;
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
      padding: 9px 14px;
      border: 1px solid var(--line);
      border-radius: var(--radius);
      background: var(--raised);
      color: var(--ink-2);
      font-size: 0.82rem;
      text-align: left;
      cursor: pointer;
      transition:
        background var(--dur-fast) var(--ease),
        border-color var(--dur-fast) var(--ease),
        transform var(--dur-fast) var(--ease),
        box-shadow var(--dur-fast) var(--ease);
    }

    .suggestion-chip:hover {
      background: var(--accent-soft);
      border-color: var(--accent);
      color: var(--ink);
      transform: translateX(3px);
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

    .chat-bubble {
      max-width: 88%;
      padding: 12px 16px;
      border-radius: var(--radius-lg);
      font-size: 0.875rem;
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
    }

    .chat-bubble-text {
      white-space: pre-wrap;
      word-break: break-word;
    }

    .chat-time {
      font-size: 0.68rem;
      margin-top: 5px;
      text-align: right;
    }

    .chat-bubble-wrap.user .chat-time {
      color: rgba(255, 255, 255, 0.75);
    }

    .citations-container {
      border-top: 1px solid var(--line);
      padding-top: 8px;
    }

    .citations-title {
      font-size: 0.66rem;
      color: var(--accent);
      margin-bottom: 6px;
    }

    .citations-list {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .citation-card {
      padding: 7px 10px;
      border-radius: var(--radius-sm);
      background: var(--sunken);
      border-left: 3px solid var(--accent);
    }

    .citation-meta {
      font-size: 0.66rem;
      color: var(--ink-3);
    }

    .citation-snippet {
      font-size: 0.76rem;
      color: var(--ink-2);
      margin-top: 3px;
      line-height: 1.4;
    }

    .typing-bubble {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 14px 18px;
    }

    .typing-dot {
      width: 7px;
      height: 7px;
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
  `,
})
export class Chatbot {
  @ViewChild('scrollContainer') private scrollContainer?: ElementRef<HTMLDivElement>;

  private readonly chatService = inject(ChatService);
  private readonly router = inject(Router);

  protected readonly isOpen = signal(false);
  protected readonly inputText = signal('');
  protected readonly loading = signal(false);
  protected readonly messages = signal<UiMessage[]>([]);
  protected readonly activeDocumentId = signal<string | null>(null);

  protected readonly suggestions = computed(() => {
    if (this.activeDocumentId()) {
      return [
        'Summarize the key findings in this document',
        'What are the positive and negative points?',
        'Are there mathematical formulas or calculations?',
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
        this.activeDocumentId.set(match ? match[1] : null);
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
    const userMsg: UiMessage = { role: 'user', text, time };

    this.messages.update((list) => [...list, userMsg]);
    this.inputText.set('');
    this.loading.set(true);
    setTimeout(() => this.scrollToBottom(), 50);

    const apiMessages: ChatMessage[] = this.messages().map((m) => ({
      role: m.role,
      content: m.text,
    }));

    const docId = this.activeDocumentId();
    const req = docId
      ? this.chatService.chatDocument(docId, apiMessages)
      : this.chatService.chatPlatform(apiMessages);

    req.subscribe({
      next: (res) => {
        const botMsg: UiMessage = {
          role: 'assistant',
          text: res.answer,
          citations: res.citations,
          model: res.model,
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        };
        this.messages.update((list) => [...list, botMsg]);
        this.loading.set(false);
        setTimeout(() => this.scrollToBottom(), 50);
      },
      error: () => {
        const botMsg: UiMessage = {
          role: 'assistant',
          text: 'I could not process that query. Please try again.',
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        };
        this.messages.update((list) => [...list, botMsg]);
        this.loading.set(false);
        setTimeout(() => this.scrollToBottom(), 50);
      },
    });
  }

  private scrollToBottom(): void {
    if (this.scrollContainer) {
      this.scrollContainer.nativeElement.scrollTop = this.scrollContainer.nativeElement.scrollHeight;
    }
  }
}
