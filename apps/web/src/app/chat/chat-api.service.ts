import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { AuthSessionService } from '../auth/auth-session.service';
import { API_BASE_URL } from '../config/api-base-url';
import { ChatConversation, ChatConversationSummary } from './chat-conversation.model';
import { ChatMessage } from './chat-message.model';
import { ChatStreamEvent } from './chat-stream-event.model';

@Injectable({ providedIn: 'root' })
export class ChatApiService {
  private readonly authSession = inject(AuthSessionService);

  // Load lightweight conversation rows for the sidebar.
  async listConversations(): Promise<ChatConversationSummary[]> {
    const response = await fetch(`${API_BASE_URL}/chat/conversations`, {
      headers: this.authHeaders()
    });

    if (!response.ok) {
      throw new Error(`Conversation list failed with status ${response.status}`);
    }

    const body = (await response.json()) as { conversations: ChatConversationSummary[] };
    return body.conversations;
  }

  // Load a full conversation when the user clicks it in the sidebar.
  async getConversation(conversationId: string): Promise<ChatConversation> {
    const response = await fetch(`${API_BASE_URL}/chat/conversations/${conversationId}`, {
      headers: this.authHeaders()
    });

    if (!response.ok) {
      throw new Error(`Conversation load failed with status ${response.status}`);
    }

    const body = (await response.json()) as { conversation: ChatConversation };
    return body.conversation;
  }

  // Rename a saved conversation.
  async renameConversation(conversationId: string, title: string): Promise<ChatConversationSummary> {
    const response = await fetch(`${API_BASE_URL}/chat/conversations/${conversationId}`, {
      method: 'PATCH',
      headers: {
        ...this.authHeaders(),
        'content-type': 'application/json'
      },
      body: JSON.stringify({ title })
    });

    if (!response.ok) {
      throw new Error(`Conversation rename failed with status ${response.status}`);
    }

    const body = (await response.json()) as { conversation: ChatConversationSummary };
    return body.conversation;
  }

  // Delete a saved conversation and its messages.
  async deleteConversation(conversationId: string): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/chat/conversations/${conversationId}`, {
      method: 'DELETE',
      headers: this.authHeaders()
    });

    if (!response.ok) {
      throw new Error(`Conversation delete failed with status ${response.status}`);
    }
  }

  // Expose the backend SSE stream as an Angular-friendly Observable.
  streamAssistantReply(conversationId: string, messages: ChatMessage[], options: ChatStreamOptions = {}): Observable<ChatStreamEvent> {
    return new Observable((subscriber) => {
      const abortController = new AbortController();

      this.openStream(conversationId, messages, options, abortController.signal, (event) => subscriber.next(event))
        .then(() => subscriber.complete())
        .catch((error: unknown) => {
          if (!abortController.signal.aborted) {
            subscriber.error(error);
          }
        });

      return () => abortController.abort();
    });
  }

  // Send the current conversation to the gateway and keep the HTTP stream open.
  private async openStream(
    conversationId: string,
    messages: ChatMessage[],
    options: ChatStreamOptions,
    signal: AbortSignal,
    onEvent: (event: ChatStreamEvent) => void
  ): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/chat/stream`, {
      method: 'POST',
      headers: {
        ...this.authHeaders(),
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        conversationId,
        save: options.save ?? true,
        messages: messages.map((message) => ({
          id: message.id,
          role: message.role,
          content: message.content,
          createdAt: message.createdAt
        }))
      }),
      signal
    });

    if (!response.ok || !response.body) {
      throw new Error(`Chat stream failed with status ${response.status}`);
    }

    await this.readServerSentEvents(response.body, onEvent);
  }

  // Attach the remembered login token to private chat endpoints.
  private authHeaders(): Record<string, string> {
    const token = this.authSession.session()?.token;
    return token ? { authorization: `Bearer ${token}` } : {};
  }

  // Convert raw Server-Sent Events bytes into parsed chat stream events.
  private async readServerSentEvents(
    body: ReadableStream<Uint8Array>,
    onEvent: (event: ChatStreamEvent) => void
  ): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split('\n\n');
      buffer = chunks.pop() ?? '';

      for (const chunk of chunks) {
        const parsed = parseSseChunk(chunk);

        if (parsed) {
          onEvent(parsed);
        }
      }
    }
  }
}

interface ChatStreamOptions {
  save?: boolean;
}

// Parse one SSE frame, for example: event: message.delta + data: {"text":"Hi"}.
function parseSseChunk(chunk: string): ChatStreamEvent | null {
  const lines = chunk.split('\n');
  const event = lines.find((line) => line.startsWith('event:'))?.replace('event:', '').trim() ?? 'message';
  const data = lines
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.replace('data:', '').trim())
    .join('\n');

  if (!data || data === '[DONE]') {
    return null;
  }

  try {
    return {
      event,
      data: JSON.parse(data)
    };
  } catch {
    return {
      event,
      data
    };
  }
}
