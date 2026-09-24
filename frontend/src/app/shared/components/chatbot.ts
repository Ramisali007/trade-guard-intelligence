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
      <div class="chatbot-panel" role="dialog" aria-label="TradeGuard AI Assistant">
        <!-- Chat Header -->
        <div class="chat-header">
          <div class="row gap-12 align-center">
            <div class="chat-avatar">
              <app-icon name="sparkle" [size]="18" />
            </div>
            <div>
              <div class="chat-title font-semibold">TradeGuard AI Assistant</div>
              <div class="chat-mode small">
                @if (activeDocumentId()) {
                  <span class="mode-doc">
                    <span class="pulse-dot"></span>
                    RAG Mode · {{ activeDocName() || 'Active Presentation' }}
                  </span>
                } @else {
                  <span class="mode-platform">
                    <span class="pulse-dot platform-dot"></span>
                    Platform &amp; Trade Compliance Guide
                  </span>
                }
              </div>
            </div>
          </div>

          <div class="row gap-6">
            <button class="chat-header-btn" (click)="clearChat()" title="Clear conversation" aria-label="Clear conversation">
              <app-icon name="trash" [size]="14" />
            </button>
            <button class="chat-header-btn" (click)="toggleOpen()" title="Close chat" aria-label="Close chat">
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
              <div class="welcome-title font-semibold mt-14">How can I assist your trade screening today?</div>
              <p class="welcome-desc small muted text-center mt-6">
                @if (activeDocumentId()) {
                  Ask questions about trade compliance, UCP 600 discrepancies, OFAC sanctions hits, dual-use risk, or counterparty verification.
                } @else {
                  Ask about TradeGuard AI compliance features, sanctions lists (OFAC/UN/EU/UK/SBP), TBML red flags, or master data management.
                }
              </p>

              <!-- Suggestion Chips -->
              <div class="suggestions-list mt-16">
                @for (prompt of suggestions(); track prompt) {
                  <button class="suggestion-chip" (click)="sendPrompt(prompt)">
                    <span class="suggestion-chevron">
                      <app-icon name="chevronRight" [size]="12" />
                    </span>
                    <span class="suggestion-text">{{ prompt }}</span>
                  </button>
                }
              </div>
            </div>
          }

          <!-- Message History -->
          @for (msg of messages(); track msg.id) {
            <div class="chat-bubble-wrap" [class.user]="msg.role === 'user'" [class.assistant]="msg.role === 'assistant'">
              @if (msg.role === 'assistant') {
                <div class="assistant-header-bar">
                  <div class="assistant-brand-meta">
                    <span class="assistant-sparkle-dot">
                      <app-icon name="sparkle" [size]="12" />
                    </span>
                    <span class="assistant-brand-name">TradeGuard AI</span>
                    @if (msg.model) {
                      <span class="model-badge">{{ formatModelName(msg.model) }}</span>
                    }
                  </div>
                  <button type="button" class="btn-copy-bubble" (click)="copyMessageText(msg)" title="Copy response to clipboard">
                    <app-icon [name]="copiedMessageId() === msg.id ? 'check' : 'document'" [size]="12" />
                    <span>{{ copiedMessageId() === msg.id ? 'Copied' : 'Copy' }}</span>
                  </button>
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
                <span class="eyebrow">TradeGuard AI</span>
                <span class="model-tag">Analyzing trade presentation...</span>
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
              class="chat-input"
              placeholder="Ask anything about the document or platform..."
              [value]="inputText()"
              (input)="onInputChange($event)"
              [disabled]="loading()"
            />
            <button
              type="submit"
              class="btn-send"
              [disabled]="!inputText().trim() || loading()"
              aria-label="Send message"
              title="Send message"
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
      bottom: clamp(14px, 3vw, 24px);
      right: clamp(14px, 3vw, 24px);
      z-index: 1050;
      width: 56px;
      height: 56px;
      border-radius: 50%;
      background: linear-gradient(135deg, #00d4d4 0%, #00a8a8 55%, #008f8f 100%);
      color: #fff;
      border: 2px solid rgba(255, 255, 255, 0.45);
      box-shadow: 0 8px 26px rgba(0, 168, 168, 0.48), 0 0 16px rgba(0, 212, 212, 0.32);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition:
        transform var(--dur) var(--ease-spring),
        box-shadow var(--dur) var(--ease),
        background var(--dur) var(--ease);
      overflow: visible;
    }

    .chatbot-fab:hover {
      transform: scale(1.08) translateY(-2px);
      background: linear-gradient(135deg, #26e6e6 0%, #00bcbc 55%, #009999 100%);
      box-shadow: 0 12px 34px rgba(0, 168, 168, 0.65), 0 0 24px rgba(0, 212, 212, 0.5);
    }

    .chatbot-fab.active {
      transform: rotate(90deg);
      background: #0a1638;
      color: #ffffff;
      border: 1px solid rgba(0, 168, 168, 0.4);
      box-shadow: 0 8px 24px rgba(10, 22, 56, 0.3);
    }

    .fab-ambient {
      position: absolute;
      inset: -4px;
      border-radius: 50%;
      background: #00a8a8;
      filter: blur(10px);
      opacity: 0.45;
      z-index: -1;
      animation: glowPulse 3s ease-in-out infinite;
    }

    .fab-icon-wrap {
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .fab-badge {
      position: absolute;
      top: -8px;
      right: -10px;
      font-size: 0.62rem;
      font-weight: 800;
      background: #0a1638;
      color: #00e5e5;
      border: 1.5px solid #00e5e5;
      padding: 1px 6px;
      border-radius: 99px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
      letter-spacing: 0.04em;
    }

    .chatbot-panel {
      position: fixed;
      bottom: clamp(76px, 11vh, 92px);
      right: clamp(14px, 3vw, 24px);
      z-index: 1040;
      width: 470px;
      max-width: calc(100vw - 28px);
      height: 640px;
      max-height: calc(100dvh - 120px);
      background: #ffffff;
      border-radius: 18px;
      border: 1px solid rgba(0, 168, 168, 0.28);
      box-shadow: 0 24px 60px -12px rgba(10, 22, 56, 0.28), 0 0 0 1px rgba(10, 22, 56, 0.06);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      animation: modalScaleIn 260ms cubic-bezier(0.16, 1, 0.3, 1);
    }

    .chat-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 16px 20px;
      background: linear-gradient(135deg, #0a1638 0%, #0d1e4a 60%, #08173d 100%);
      border-bottom: 1px solid rgba(0, 168, 168, 0.25);
      position: relative;
    }

    .chat-header::after {
      content: '';
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      height: 2px;
      background: linear-gradient(90deg, #00d4d4, #2ee5b8, transparent);
    }

    .chat-avatar {
      width: 38px;
      height: 38px;
      border-radius: 10px;
      background: linear-gradient(135deg, #00d4d4 0%, #00a8a8 60%, #007a7a 100%);
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      flex: none;
      box-shadow: 0 2px 12px rgba(0, 212, 212, 0.4);
      border: 1px solid rgba(255, 255, 255, 0.25);
    }

    .chat-title {
      font-size: 0.96rem;
      line-height: 1.2;
      color: #ffffff;
      font-weight: 750;
      letter-spacing: -0.01em;
    }

    .chat-mode {
      font-size: 0.72rem;
      margin-top: 3px;
    }

    .mode-doc {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      color: #2dd4bf;
      font-weight: 650;
      max-width: 240px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .mode-platform {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      color: #00d4d4;
      font-weight: 600;
    }

    .pulse-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #00d4d4;
      box-shadow: 0 0 8px #00d4d4;
      display: inline-block;
      animation: glowPulse 2s infinite ease-in-out;
    }

    .platform-dot {
      background: #2dd4bf;
      box-shadow: 0 0 8px #2dd4bf;
    }

    .chat-header-btn {
      width: 32px;
      height: 32px;
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.12);
      color: #cbd5e1;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: all 0.2s ease;

      &:hover {
        background: rgba(255, 255, 255, 0.18);
        color: #ffffff;
        transform: scale(1.05);
      }
    }

    .chat-body {
      flex: 1 1 auto;
      overflow-y: auto;
      padding: clamp(14px, 2.5vw, 20px);
      display: flex;
      flex-direction: column;
      gap: 16px;
      background: #f8fafc;
      -webkit-overflow-scrolling: touch;

      &::-webkit-scrollbar {
        width: 6px;
      }
      &::-webkit-scrollbar-thumb {
        background: rgba(10, 22, 56, 0.15);
        border-radius: 3px;
      }
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
      color: #00a8a8;
      padding: 16px;
      background: linear-gradient(135deg, rgba(0, 168, 168, 0.12) 0%, rgba(10, 22, 56, 0.06) 100%);
      border: 2px solid rgba(0, 168, 168, 0.3);
      border-radius: 50%;
      box-shadow: 0 8px 24px rgba(0, 212, 212, 0.18);
      display: flex;
      align-items: center;
      justify-content: center;
      animation: float 4s ease-in-out infinite;
    }

    .welcome-title {
      font-size: 1.08rem;
      color: #0a1638;
      font-weight: 800;
      text-align: center;
      letter-spacing: -0.01em;
    }

    .welcome-desc {
      color: #64748b;
      line-height: 1.55;
    }

    .suggestions-list {
      display: flex;
      flex-direction: column;
      gap: 9px;
      width: 100%;
    }

    .suggestion-chip {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px 16px;
      border: 1px solid #e2e8f0;
      border-left: 3.5px solid #00a8a8;
      border-radius: 10px;
      background: #ffffff;
      color: #1e293b;
      font-size: 0.84rem;
      font-weight: 600;
      text-align: left;
      cursor: pointer;
      box-shadow: 0 2px 6px rgba(10, 22, 56, 0.03);
      transition: all 0.2s ease;
    }

    .suggestion-chevron {
      color: #00a8a8;
      display: flex;
      align-items: center;
      flex-shrink: 0;
      transition: transform 0.2s ease;
    }

    .suggestion-text {
      flex: 1;
      line-height: 1.35;
    }

    .suggestion-chip:hover {
      background: #f0fdfa;
      border-color: #00a8a8;
      border-left-color: #00d4d4;
      color: #008888;
      transform: translateX(4px);
      box-shadow: 0 4px 14px rgba(0, 168, 168, 0.15);

      .suggestion-chevron {
        transform: translateX(2px);
      }
    }

    .chat-bubble-wrap {
      display: flex;
      flex-direction: column;
      animation: fadeUp 0.2s ease-out both;
    }

    .chat-bubble-wrap.user {
      align-items: flex-end;
    }

    .chat-bubble-wrap.assistant {
      align-items: flex-start;
    }

    /* ── Assistant Header Bar ── */
    .assistant-header-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 7px;
      padding: 0 4px;
      width: 100%;
    }

    .assistant-brand-meta {
      display: flex;
      align-items: center;
      gap: 7px;
    }

    .assistant-sparkle-dot {
      color: #00a8a8;
      display: flex;
      align-items: center;
    }

    .assistant-brand-name {
      color: #00a8a8;
      font-weight: 750;
      font-size: 0.78rem;
      letter-spacing: 0.02em;
    }

    .model-badge {
      font-size: 0.68rem;
      color: #64748b;
      font-weight: 600;
      padding: 1px 7px;
      border-radius: 4px;
      background: #e2e8f0;
    }

    .btn-copy-bubble {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 3px 8px;
      border-radius: 6px;
      background: rgba(10, 22, 56, 0.04);
      border: 1px solid rgba(10, 22, 56, 0.08);
      color: #64748b;
      font-size: 0.7rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s ease;

      &:hover {
        background: rgba(0, 168, 168, 0.1);
        border-color: rgba(0, 168, 168, 0.3);
        color: #008888;
      }
    }

    .chat-bubble {
      max-width: 94%;
      padding: 15px 18px;
      border-radius: 14px;
      font-size: 0.88rem;
      line-height: 1.6;
      word-break: break-word;
    }

    .chat-bubble-wrap.user .chat-bubble {
      background: linear-gradient(135deg, #0a1638 0%, #0d1e4a 100%);
      color: #ffffff;
      border-bottom-right-radius: 4px;
      border: 1px solid rgba(0, 168, 168, 0.3);
      box-shadow: 0 4px 14px rgba(10, 22, 56, 0.15);
    }

    .chat-bubble-wrap.assistant .chat-bubble {
      background: #ffffff;
      border: 1px solid #e2e8f0;
      color: #0f172a;
      border-bottom-left-radius: 4px;
      box-shadow: 0 4px 16px rgba(10, 22, 56, 0.05);
      width: 100%;
    }

    .user-text {
      white-space: pre-wrap;
      word-break: break-word;
      font-size: 0.9rem;
      line-height: 1.5;
    }

    .assistant-response-container {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    /* ── Overview Card ── */
    .ai-overview-card {
      padding: 13px 16px;
      background: linear-gradient(135deg, rgba(0, 168, 168, 0.08) 0%, rgba(10, 22, 56, 0.03) 100%);
      border: 1px solid rgba(0, 168, 168, 0.22);
      border-left: 3.5px solid #00a8a8;
      border-radius: 9px;
    }

    .overview-header {
      align-items: center;
      color: #008888;
      margin-bottom: 6px;
      font-weight: 750;
      font-size: 0.78rem;
    }

    .overview-body {
      margin: 0;
      font-size: 0.86rem;
      line-height: 1.52;
      color: #1e293b;
    }

    /* ── Topics Chips ── */
    .section-label {
      font-size: 0.72rem;
      font-weight: 750;
      color: #64748b;
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
      padding: 3px 10px;
      background: #f1f5f9;
      border: 1px solid #cbd5e1;
      border-radius: 99px;
      font-size: 0.76rem;
      color: #0a1638;
      font-weight: 600;
    }

    .topic-dot {
      width: 5px;
      height: 5px;
      border-radius: 50%;
      background: #00a8a8;
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
      padding: 8px 12px;
      background: #f8fafc;
      border-radius: 8px;
      border: 1px solid #e2e8f0;
      font-size: 0.83rem;
      line-height: 1.45;
      color: #1e293b;
    }

    .finding-icon {
      width: 18px;
      height: 18px;
      border-radius: 50%;
      background: rgba(16, 185, 129, 0.14);
      color: #10b981;
      display: flex;
      align-items: center;
      justify-content: center;
      flex: none;
      margin-top: 1px;
    }

    /* ── Markdown Response Body ── */
    .ai-narrative-text {
      font-size: 0.88rem;
      line-height: 1.62;
      color: #0f172a;
      word-break: break-word;
    }

    .ai-p {
      margin: 0 0 10px 0;
      &:last-child {
        margin-bottom: 0;
      }
    }

    .ai-bold {
      font-weight: 700;
      color: #0a1638;
    }

    .ai-italic {
      font-style: italic;
      color: #334155;
    }

    .ai-inline-code {
      background: #f1f5f9;
      color: #008888;
      border: 1px solid #e2e8f0;
      padding: 1.5px 6px;
      border-radius: 5px;
      font-family: 'JetBrains Mono', 'Fira Code', monospace;
      font-size: 0.84em;
      font-weight: 600;
    }

    .ai-md-h3 {
      font-size: 1.05rem;
      font-weight: 800;
      color: #0a1638;
      margin: 14px 0 6px 0;
      letter-spacing: -0.01em;
    }

    .ai-md-h4 {
      font-size: 0.96rem;
      font-weight: 750;
      color: #0a1638;
      margin: 12px 0 6px 0;
    }

    .ai-md-h5 {
      font-size: 0.84rem;
      font-weight: 750;
      color: #008888;
      margin: 10px 0 4px 0;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    /* ── Custom Lists in Responses ── */
    .ai-bullet-list {
      list-style: none;
      padding: 0;
      margin: 8px 0 12px 0;
      display: flex;
      flex-direction: column;
      gap: 7px;
    }

    .ai-bullet-list li {
      display: flex;
      align-items: flex-start;
      gap: 10px;
    }

    .ai-bullet-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #00a8a8;
      margin-top: 8px;
      flex-shrink: 0;
      box-shadow: 0 0 6px rgba(0, 212, 212, 0.4);
    }

    .ai-item-content {
      flex: 1;
      line-height: 1.55;
    }

    .ai-num-list {
      list-style: none;
      padding: 0;
      margin: 8px 0 12px 0;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .ai-num-list li {
      display: flex;
      align-items: flex-start;
      gap: 10px;
    }

    .ai-num-circle {
      width: 19px;
      height: 19px;
      border-radius: 50%;
      background: rgba(0, 168, 168, 0.12);
      border: 1px solid rgba(0, 168, 168, 0.3);
      color: #008c8c;
      font-size: 0.7rem;
      font-weight: 800;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      margin-top: 2px;
    }

    /* ── Markdown Tables in Chat Responses ── */
    .chat-table-wrapper {
      margin: 12px 0;
      overflow-x: auto;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      background: #ffffff;
      box-shadow: 0 2px 8px rgba(10, 22, 56, 0.03);
    }

    .chat-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.8rem;
      text-align: left;
    }

    .chat-table thead th {
      background: #0a1638;
      color: #ffffff;
      font-weight: 700;
      padding: 8px 12px;
      border-bottom: 1px solid rgba(0, 168, 168, 0.3);
      white-space: nowrap;
      letter-spacing: 0.02em;
    }

    .chat-table tbody td {
      padding: 8px 12px;
      border-bottom: 1px solid #f1f5f9;
      color: #1e293b;
      line-height: 1.45;
    }

    .chat-table tbody tr:nth-child(even) td {
      background: #f8fafc;
    }

    .chat-table tbody tr:hover td {
      background: #f0fdfa;
    }

    /* ── Code Blocks in Chat Responses ── */
    .chat-code-card {
      margin: 12px 0;
      border-radius: 10px;
      background: #060b19;
      border: 1px solid rgba(0, 168, 168, 0.25);
      overflow: hidden;
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.15);
    }

    .chat-code-header {
      padding: 7px 12px;
      background: #0c1429;
      border-bottom: 1px solid rgba(255, 255, 255, 0.06);
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .chat-code-dots {
      display: flex;
      gap: 5px;
    }

    .chat-code-dots span {
      width: 8px;
      height: 8px;
      border-radius: 50%;
    }
    .d-red { background: #ef4444; }
    .d-yellow { background: #f59e0b; }
    .d-green { background: #10b981; }

    .chat-code-lang {
      font-size: 0.65rem;
      font-weight: 800;
      color: #2dd4bf;
      font-family: monospace;
      letter-spacing: 0.05em;
    }

    .chat-code-pre {
      margin: 0;
      padding: 12px 14px;
      overflow-x: auto;
      font-family: 'JetBrains Mono', 'Fira Code', monospace;
      font-size: 0.8rem;
      line-height: 1.5;
      color: #38bdf8;
      background: #060b19;
    }

    /* ── Blockquotes / Callouts ── */
    .ai-quote-callout {
      display: flex;
      gap: 10px;
      padding: 10px 14px;
      margin: 10px 0;
      background: linear-gradient(135deg, rgba(0, 168, 168, 0.07) 0%, rgba(10, 22, 56, 0.02) 100%);
      border-radius: 0 8px 8px 0;
      border-left: 3.5px solid #00a8a8;
    }

    .quote-bar {
      display: none;
    }

    .quote-text {
      color: #334155;
      font-size: 0.85rem;
      font-style: italic;
      line-height: 1.55;
    }

    /* ── Inline Risk / Status Badges ── */
    .ai-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 7px;
      border-radius: 5px;
      font-size: 0.72rem;
      font-weight: 750;
      letter-spacing: 0.02em;
      margin: 0 2px;
      vertical-align: middle;

      &.badge-danger {
        background: rgba(239, 68, 68, 0.12);
        border: 1px solid rgba(239, 68, 68, 0.28);
        color: #b91c1c;
      }

      &.badge-warning {
        background: rgba(245, 158, 11, 0.14);
        border: 1px solid rgba(245, 158, 11, 0.32);
        color: #b45309;
      }

      &.badge-success {
        background: rgba(16, 185, 129, 0.14);
        border: 1px solid rgba(16, 185, 129, 0.32);
        color: #047857;
      }

      &.badge-info {
        background: rgba(0, 168, 168, 0.12);
        border: 1px solid rgba(0, 168, 168, 0.3);
        color: #008888;
      }
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
      border-top: 1px dashed #cbd5e1;
    }

    .btn-view-citations {
      width: 100%;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 14px;
      background: linear-gradient(135deg, rgba(0, 168, 168, 0.08) 0%, rgba(10, 22, 56, 0.03) 100%);
      border: 1px solid rgba(0, 168, 168, 0.35);
      border-radius: 10px;
      color: #0a1638;
      cursor: pointer;
      transition: all 0.2s ease;
      box-shadow: 0 2px 6px rgba(0, 168, 168, 0.08);

      &:hover {
        background: linear-gradient(135deg, rgba(0, 168, 168, 0.16) 0%, rgba(10, 22, 56, 0.06) 100%);
        border-color: #00a8a8;
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(0, 168, 168, 0.2);
      }
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
      background: #00a8a8;
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .citation-btn-title {
      font-size: 0.85rem;
      font-weight: 700;
      color: #0a1638;
    }

    .citation-count-pill {
      font-size: 0.7rem;
      font-weight: 650;
      padding: 2px 7px;
      border-radius: 99px;
      background: rgba(0, 168, 168, 0.14);
      color: #008888;
    }

    .citation-btn-right {
      display: flex;
      align-items: center;
      gap: 6px;
      color: #00a8a8;
      font-size: 0.76rem;
      font-weight: 600;
    }

    .chat-time {
      font-size: 0.68rem;
      margin-top: 6px;
      text-align: right;
      color: #64748b;
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
      background: #00a8a8;
      animation: typing 1.4s infinite ease-in-out both;
    }
    .typing-dot:nth-child(1) { animation-delay: -0.32s; }
    .typing-dot:nth-child(2) { animation-delay: -0.16s; }

    @keyframes typing {
      0%, 80%, 100% { transform: scale(0.3); opacity: 0.3; }
      40% { transform: scale(1); opacity: 1; }
    }

    /* ── Chat Footer & Input ── */
    .chat-footer {
      padding: 14px 16px;
      background: #ffffff;
      border-top: 1px solid #e2e8f0;
      box-shadow: 0 -2px 10px rgba(0, 0, 0, 0.02);
    }

    .chat-form {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .chat-input {
      flex: 1 1 auto;
      min-width: 0;
      padding: 11px 16px;
      font-size: 0.88rem;
      border-radius: 12px;
      border: 1.5px solid #cbd5e1;
      background: #f8fafc;
      color: #0a1638;
      outline: none;
      transition: all 0.2s ease;

      &::placeholder {
        color: #94a3b8;
      }

      &:focus {
        background: #ffffff;
        border-color: #00a8a8;
        box-shadow: 0 0 0 3.5px rgba(0, 168, 168, 0.15);
      }
    }

    .btn-send {
      width: 42px;
      height: 42px;
      flex: none;
      border-radius: 12px;
      background: linear-gradient(135deg, #00d4d4 0%, #00a8a8 100%);
      color: #ffffff;
      border: none;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(0, 168, 168, 0.35);
      transition: all 0.2s ease;

      &:hover:not(:disabled) {
        background: linear-gradient(135deg, #26e6e6 0%, #00bcbc 100%);
        transform: translateY(-1px);
        box-shadow: 0 6px 16px rgba(0, 168, 168, 0.45);
      }

      &:disabled {
        opacity: 0.45;
        cursor: not-allowed;
        box-shadow: none;
      }
    }

    .font-semibold { font-weight: 650; }
    .text-center { text-align: center; }
    .sep { opacity: 0.35; margin: 0 2px; }

    @keyframes modalScaleIn {
      from { opacity: 0; transform: scale(0.95) translateY(12px); }
      to { opacity: 1; transform: scale(1) translateY(0); }
    }

    @keyframes glowPulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.55; transform: scale(1.12); }
    }

    @keyframes fadeUp {
      from { opacity: 0; transform: translateY(6px); }
      to { opacity: 1; transform: translateY(0); }
    }

    @keyframes float {
      0%, 100% { transform: translateY(0); }
      50% { transform: translateY(-5px); }
    }

    @media (max-width: 600px) {
      .chatbot-panel {
        inset: 10px 10px clamp(76px, 12dvh, 90px) 10px;
        width: auto;
        max-width: none;
        height: auto;
        max-height: none;
        border-radius: 16px;
      }
      .chat-bubble {
        max-width: 96%;
      }
      .mode-doc {
        max-width: 160px;
      }
      .citation-btn-hint {
        display: none;
      }
    }

    @media (max-width: 360px) {
      .mode-doc {
        max-width: 120px;
      }
      .chat-header {
        padding: 10px 12px;
      }
      .chat-avatar {
        width: 30px;
        height: 30px;
      }
    }
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

  protected readonly copiedMessageId = signal<string | null>(null);
  protected readonly suggestions = computed(() => {
    if (this.activeDocumentId()) {
      return [
        'Does this document have any sanctions red flags?',
        'Verify UCP 600 Letter of Credit discrepancies',
        'Check dual-use goods or HS code classification',
        'Summarize transshipment and maritime route risk',
      ];
    }
    return [
      'What sanctions regimes does TradeGuard screen?',
      'How does cross-document reconciliation work?',
      'Explain UCP 600 & ISBP 745 discrepancy rules',
      'How is the TBML and price corridor risk score calculated?',
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

  copyMessageText(msg: UiMessage): void {
    const textToCopy = msg.cleanText || msg.rawText;
    if (!textToCopy) return;
    navigator.clipboard.writeText(textToCopy).then(() => {
      this.copiedMessageId.set(msg.id);
      setTimeout(() => this.copiedMessageId.set(null), 2000);
    });
  }

  private parseAssistantResponse(raw: string): {
    overview?: string;
    topics?: string[];
    findings?: string[];
    cleanText: string;
  } {
    // 1. Strip technical inline citation markers like *([Page 1, Para 4, ...])* or [1], [Passage 1]
    let text = raw.replace(/\*\(\[Page\s+\d+[^\]]*\]\)\*/gi, '');
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

    // 1. Preserve code blocks
    const codeBlocks: string[] = [];
    let processed = md.replace(/```([a-zA-Z0-9_-]*)\r?\n([\s\S]*?)```/g, (_, lang, code) => {
      const escapedCode = code
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      const langLabel = lang ? lang.toUpperCase() : 'CODE';
      const placeholder = `__CHAT_CODE_BLOCK_${codeBlocks.length}__`;
      codeBlocks.push(
        `<div class="chat-code-card">` +
          `<div class="chat-code-header">` +
            `<div class="chat-code-dots"><span class="d-red"></span><span class="d-yellow"></span><span class="d-green"></span></div>` +
            `<span class="chat-code-lang">${langLabel}</span>` +
          `</div>` +
          `<pre class="chat-code-pre"><code>${escapedCode}</code></pre>` +
        `</div>`
      );
      return placeholder;
    });

    // 2. Parse Markdown Tables
    const tableRegex = /((?:\|[^\n]+\|\r?\n)+)/g;
    processed = processed.replace(tableRegex, (match) => {
      const rows = match.trim().split(/\r?\n/).map(r => r.trim()).filter(r => r.startsWith('|') && r.endsWith('|'));
      if (rows.length < 2) return match;

      const isSeparator = (r: string) => /^\|[\s-:]+(\|[\s-:]+)+\|$/.test(r);
      const splitCells = (r: string) => r.slice(1, -1).split('|').map(c => c.trim());

      let headerRow: string[] = [];
      let bodyRows: string[][] = [];

      if (rows.length >= 2 && isSeparator(rows[1])) {
        headerRow = splitCells(rows[0]);
        bodyRows = rows.slice(2).filter(r => !isSeparator(r)).map(splitCells);
      } else {
        return match;
      }

      let tableHtml = '<div class="chat-table-wrapper"><table class="chat-table">';
      if (headerRow.length > 0) {
        tableHtml += '<thead><tr>' + headerRow.map(h => `<th>${h}</th>`).join('') + '</tr></thead>';
      }
      tableHtml += '<tbody>';
      for (const row of bodyRows) {
        tableHtml += '<tr>' + row.map(c => `<td>${c}</td>`).join('') + '</tr>';
      }
      tableHtml += '</tbody></table></div>';
      return tableHtml;
    });

    // 3. Escape HTML outside of tags
    processed = processed
      .replace(/&(?!(?:amp|lt|gt|quot|#39);)/g, '&amp;')
      .replace(/<(?!(?:\/?(?:div|span|table|thead|tbody|tr|th|td|pre|code|ul|ol|li|p|strong|em|h[1-6]|app-icon)[^>]*>))/g, '&lt;');

    // 4. Compliance & Risk Status Badges
    processed = processed
      .replace(/\[(CRITICAL|HIGH RISK|TBML RED FLAG|SANCTIONS HIT)\]/gi, '<span class="ai-badge badge-danger">⚠️ $1</span>')
      .replace(/\[(NON-COMPLIANT|DISCREPANCY|DISCREPANT)\]/gi, '<span class="ai-badge badge-danger">✕ $1</span>')
      .replace(/\[(MEDIUM RISK|WARNING|ATTENTION)\]/gi, '<span class="ai-badge badge-warning">⚡ $1</span>')
      .replace(/\[(COMPLIANT|CLEAN|VERIFIED|PASSED|MATCH)\]/gi, '<span class="ai-badge badge-success">✓ $1</span>')
      .replace(/\[(INFO|NOTE|ADVISORY)\]/gi, '<span class="ai-badge badge-info">ℹ $1</span>');

    // 5. Bold & Italic
    processed = processed.replace(/\*\*([^*]+)\*\*/g, '<strong class="ai-bold">$1</strong>');
    processed = processed.replace(/\*([^*]+)\*/g, '<em class="ai-italic">$1</em>');

    // 6. Inline Code
    processed = processed.replace(/`([^`]+)`/g, '<code class="ai-inline-code">$1</code>');

    // 7. Blockquotes
    processed = processed.replace(/^>\s+(.+)$/gm, '<div class="ai-quote-callout"><span class="quote-bar"></span><span class="quote-text">$1</span></div>');

    // 8. Headings
    processed = processed.replace(/^###\s+(.+)$/gm, '<h5 class="ai-md-h5">$1</h5>');
    processed = processed.replace(/^##\s+(.+)$/gm, '<h4 class="ai-md-h4">$1</h4>');
    processed = processed.replace(/^#\s+(.+)$/gm, '<h3 class="ai-md-h3">$1</h3>');

    // 9. Unordered Lists
    processed = processed.replace(/((?:^(?:[-*•])\s+.+(?:\r?\n|$))+)/gm, (match) => {
      const items = match.trim().split(/\r?\n/).map(line => line.replace(/^[-*•]\s+/, '').trim());
      return '<ul class="ai-bullet-list">' + items.map(item => `<li><span class="ai-bullet-dot"></span><div class="ai-item-content">${item}</div></li>`).join('') + '</ul>';
    });

    // 10. Ordered Lists
    processed = processed.replace(/((?:^\d+\.\s+.+(?:\r?\n|$))+)/gm, (match) => {
      const items = match.trim().split(/\r?\n/).map(line => line.replace(/^\d+\.\s+/, '').trim());
      return '<ol class="ai-num-list">' + items.map((item, idx) => `<li><span class="ai-num-circle">${idx + 1}</span><div class="ai-item-content">${item}</div></li>`).join('') + '</ol>';
    });

    // 11. Paragraphs
    const blocks = processed.split(/\n\n+/);
    processed = blocks
      .map(b => {
        b = b.trim();
        if (!b) return '';
        if (/^<(?:div|table|ul|ol|h[1-6])/.test(b)) return b;
        return `<p class="ai-p">${b.replace(/\n/g, '<br/>')}</p>`;
      })
      .filter(Boolean)
      .join('');

    // 12. Restore code block placeholders
    codeBlocks.forEach((cb, i) => {
      processed = processed.replace(`__CHAT_CODE_BLOCK_${i}__`, cb);
    });

    return processed;
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
