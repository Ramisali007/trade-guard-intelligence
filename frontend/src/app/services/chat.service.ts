import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';

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

@Injectable({ providedIn: 'root' })
export class ChatService {
  private readonly api = inject(ApiService);

  chatPlatform(messages: ChatMessage[]): Observable<ChatResponse> {
    return this.api.post<ChatResponse>('/chat', { messages });
  }

  chatDocument(documentId: string, messages: ChatMessage[]): Observable<ChatResponse> {
    return this.api.post<ChatResponse>(`/chat/document/${documentId}`, { messages });
  }
}
