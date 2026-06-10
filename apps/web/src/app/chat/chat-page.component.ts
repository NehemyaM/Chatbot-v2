import { ChangeDetectionStrategy, Component, ElementRef, HostListener, ViewChild, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { Subscription } from 'rxjs';

import { ChatApiService } from './chat-api.service';
import { ChatConversationSummary } from './chat-conversation.model';
import { ChatMessage } from './chat-message.model';
import { ChatStreamEvent } from './chat-stream-event.model';

@Component({
  selector: 'app-chat-page',
  imports: [FormsModule, RouterLink],
  templateUrl: './chat-page.component.html',
  styleUrl: './chat-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ChatPageComponent {
  private readonly chatApi = inject(ChatApiService);
  private activeStream?: Subscription;

  // Signals keep the template reactive without a heavier state library.
  readonly activeConversationId = signal<string>(crypto.randomUUID());
  readonly activeConversationTitle = signal('New conversation');
  readonly conversations = signal<ChatConversationSummary[]>([]);
  readonly attachmentMenuOpen = signal(false);
  readonly attachments = signal<SelectedAttachment[]>([]);
  readonly draft = signal('');
  readonly menuConversationId = signal<string | null>(null);
  readonly messages = signal<ChatMessage[]>([]);
  readonly renameDraft = signal('');
  readonly renamingConversationId = signal<string | null>(null);
  readonly isStreaming = signal(false);
  readonly isLoadingConversations = signal(false);
  readonly isSidebarCollapsed = signal(false);
  readonly hasMessages = computed(() => this.messages().length > 0);

  @ViewChild('messagesViewport')
  private messagesViewport?: ElementRef<HTMLElement>;

  @ViewChild('fileInput')
  private fileInput?: ElementRef<HTMLInputElement>;

  constructor() {
    void this.refreshConversations();
  }

  // Refresh the saved conversation list shown in the sidebar.
  async refreshConversations(): Promise<void> {
    this.isLoadingConversations.set(true);

    try {
      this.conversations.set(await this.chatApi.listConversations());
    } finally {
      this.isLoadingConversations.set(false);
    }
  }

  // Load a saved conversation and show its messages in the chat panel.
  async openConversation(conversationId: string): Promise<void> {
    if (this.isStreaming()) {
      return;
    }

    const conversation = await this.chatApi.getConversation(conversationId);

    this.closeConversationMenu();
    this.activeConversationId.set(conversation.id);
    this.activeConversationTitle.set(conversation.title);
    this.messages.set(conversation.messages.map(toUiMessage));
    this.draft.set('');
    this.queueScrollToBottom();
  }

  // Show or hide the right-side options for one sidebar chat.
  toggleConversationMenu(conversationId: string, event: MouseEvent): void {
    event.stopPropagation();
    this.menuConversationId.update((currentId) => (currentId === conversationId ? null : conversationId));
  }

  // Close an open options menu when the user clicks elsewhere on the page.
  @HostListener('document:click')
  closeOpenMenu(): void {
    this.menuConversationId.set(null);
    this.attachmentMenuOpen.set(false);
  }

  // Start inline rename mode for the selected sidebar chat.
  startRename(conversation: ChatConversationSummary, event: MouseEvent): void {
    event.stopPropagation();
    this.renamingConversationId.set(conversation.id);
    this.renameDraft.set(conversation.title);
    this.menuConversationId.set(null);
  }

  // Persist the new title and update the active chat heading if needed.
  async saveRename(conversationId: string): Promise<void> {
    const title = this.renameDraft().trim();

    if (!title) {
      return;
    }

    const conversation = await this.chatApi.renameConversation(conversationId, title);

    if (conversation.id === this.activeConversationId()) {
      this.activeConversationTitle.set(conversation.title);
    }

    this.renamingConversationId.set(null);
    this.renameDraft.set('');
    await this.refreshConversations();
  }

  // Leave rename mode without changing the saved title.
  cancelRename(): void {
    this.renamingConversationId.set(null);
    this.renameDraft.set('');
  }

  // Delete a saved conversation and reset the panel if it was open.
  async deleteConversation(conversationId: string, event: MouseEvent): Promise<void> {
    event.stopPropagation();
    await this.chatApi.deleteConversation(conversationId);

    this.menuConversationId.set(null);

    if (conversationId === this.activeConversationId()) {
      this.startNewChat();
    }

    await this.refreshConversations();
  }

  // Open or close the composer attachment menu.
  toggleAttachmentMenu(event: MouseEvent): void {
    event.stopPropagation();
    this.attachmentMenuOpen.update((isOpen) => !isOpen);
  }

  // Open the native file picker for the selected attachment type.
  chooseAttachment(type: AttachmentKind, event: MouseEvent): void {
    event.stopPropagation();
    const input = this.fileInput?.nativeElement;

    if (!input) {
      return;
    }

    input.accept = attachmentAccept[type];
    input.click();
    this.attachmentMenuOpen.set(false);
  }

  // Store selected files locally so the user can see what will be attached later.
  addAttachments(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);

    if (files.length === 0) {
      return;
    }

    const nextAttachments = files.map((file) => ({
      id: crypto.randomUUID(),
      name: file.name,
      size: file.size,
      type: file.type || 'unknown'
    }));

    this.attachments.update((attachments) => [...attachments, ...nextAttachments]);
    input.value = '';
  }

  // Remove one selected file before sending.
  removeAttachment(attachmentId: string): void {
    this.attachments.update((attachments) => attachments.filter((attachment) => attachment.id !== attachmentId));
  }

  // Add the user message, create an empty assistant bubble, then stream into it.
  sendMessage(): void {
    const content = this.draft().trim();

    if (!content || this.isStreaming()) {
      return;
    }

    const userMessage = createMessage('user', content, 'complete');
    const assistantMessage = createMessage('assistant', '', 'streaming');
    const nextMessages = [...this.messages(), userMessage, assistantMessage];

    this.messages.set(nextMessages);
    this.draft.set('');
    this.attachments.set([]);
    this.isStreaming.set(true);
    this.queueScrollToBottom();

    const contextMessages = nextMessages.filter((message) => message.id !== assistantMessage.id);

    this.activeStream = this.chatApi.streamAssistantReply(this.activeConversationId(), contextMessages).subscribe({
      next: (event) => this.applyStreamEvent(assistantMessage.id, event),
      error: () => this.markAssistantError(assistantMessage.id),
      complete: () => this.finishAssistantMessage(assistantMessage.id)
    });
  }

  // Cancel the active SSE request and leave the partial assistant text visible.
  stopResponse(): void {
    this.activeStream?.unsubscribe();
    this.activeStream = undefined;
    this.isStreaming.set(false);
    this.updateMessageStatus('streaming', 'complete');
  }

  // Reset the local draft and message list for a fresh conversation.
  startNewChat(): void {
    this.stopResponse();
    this.closeConversationMenu();
    this.activeConversationId.set(crypto.randomUUID());
    this.activeConversationTitle.set('New conversation');
    this.messages.set([]);
    this.draft.set('');
    this.attachments.set([]);
  }

  // Enter sends the message; Shift+Enter keeps multiline input available.
  submitFromKeyboard(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.sendMessage();
    }
  }

  // Collapse or restore the conversation sidebar.
  toggleSidebar(): void {
    this.isSidebarCollapsed.update((isCollapsed) => !isCollapsed);
  }

  // Render assistant text as sanitized markdown for richer replies.
  renderAssistantMessage(message: ChatMessage): string {
    const html = marked.parse(message.content, {
      async: false,
      breaks: true,
      gfm: true
    });

    const sanitizedHtml = DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
    return addCodeCopyButtons(sanitizedHtml);
  }

  // Copy one whole assistant reply.
  copyAssistantMessage(message: ChatMessage, event: MouseEvent): void {
    event.stopPropagation();
    void this.copyToClipboard(message.content);
  }

  // Handle code block copy buttons rendered inside markdown HTML.
  onAssistantContentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;
    const copyButton = target?.closest('.code-copy-button') as HTMLButtonElement | null;

    if (!copyButton) {
      return;
    }

    const codeElement = copyButton.parentElement?.querySelector('pre code');

    if (!codeElement) {
      return;
    }

    void this.copyToClipboard(codeElement.textContent || '');
    copyButton.textContent = 'Copied';

    window.setTimeout(() => {
      copyButton.textContent = 'Copy';
    }, 1200);
  }

  // Close open sidebar menus when another action takes over.
  private closeConversationMenu(): void {
    this.menuConversationId.set(null);
    this.cancelRename();
  }

  // Apply one text delta from the streaming backend to the assistant message.
  private applyStreamEvent(assistantMessageId: string, event: ChatStreamEvent): void {
    if (isDoneEvent(event)) {
      this.finishAssistantMessage(assistantMessageId);
      return;
    }

    const delta = extractTextDelta(event);

    if (!delta) {
      return;
    }

    this.messages.update((messages) =>
      messages.map((message) =>
        message.id === assistantMessageId
          ? {
              ...message,
              content: `${message.content}${delta}`
            }
          : message
      )
    );
    this.queueScrollToBottom();
  }

  // Mark the assistant response as complete once the stream ends.
  private finishAssistantMessage(assistantMessageId: string): void {
    this.activeStream = undefined;
    this.isStreaming.set(false);
    this.messages.update((messages) =>
      messages.map((message) =>
        message.id === assistantMessageId && message.status === 'streaming'
          ? {
              ...message,
              status: 'complete'
            }
          : message
      )
    );
    void this.refreshConversations();
  }

  // Replace the empty assistant bubble with a clear error message.
  private markAssistantError(assistantMessageId: string): void {
    this.activeStream = undefined;
    this.isStreaming.set(false);
    this.messages.update((messages) =>
      messages.map((message) =>
        message.id === assistantMessageId
          ? {
              ...message,
              content: message.content || 'The assistant could not respond. Check that the backend services are running.',
              status: 'error'
            }
          : message
      )
    );
    this.queueScrollToBottom();
  }

  // Update all messages currently in one status, used when stopping a stream.
  private updateMessageStatus(from: ChatMessage['status'], to: ChatMessage['status']): void {
    this.messages.update((messages) =>
      messages.map((message) =>
        message.status === from
          ? {
              ...message,
              status: to
            }
          : message
      )
    );
  }

  // Use the Clipboard API first and fall back for older browser contexts.
  private async copyToClipboard(text: string): Promise<void> {
    if (!text) {
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.append(textarea);
      textarea.focus();
      textarea.select();
      document.execCommand('copy');
      textarea.remove();
    }
  }

  // Keep the latest assistant text visible while streaming.
  private queueScrollToBottom(): void {
    window.setTimeout(() => {
      const element = this.messagesViewport?.nativeElement;
      element?.scrollTo({ top: element.scrollHeight, behavior: 'smooth' });
    });
  }
}

// Create a UI message with the fields every chat bubble needs.
function createMessage(role: ChatMessage['role'], content: string, status: ChatMessage['status']): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role,
    content,
    status,
    createdAt: new Date().toISOString()
  };
}

type AttachmentKind = 'file' | 'image';

interface SelectedAttachment {
  id: string;
  name: string;
  size: number;
  type: string;
}

const attachmentAccept: Record<AttachmentKind, string> = {
  file: '.pdf,.doc,.docx,.txt,.csv,.xlsx,.json',
  image: 'image/*'
};

// Convert backend messages into UI messages with a completed status.
function toUiMessage(message: ChatMessage): ChatMessage {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    createdAt: message.createdAt,
    status: 'complete'
  };
}

// Support both our mock stream shape and OpenAI-style delta fields.
function extractTextDelta(event: ChatStreamEvent): string {
  const data = event.data as { text?: string; delta?: string };

  if (typeof event.data === 'string') {
    return event.data;
  }

  return data.text ?? data.delta ?? '';
}

// Detect stream completion events from the mock service or OpenAI.
function isDoneEvent(event: ChatStreamEvent): boolean {
  return event.event === 'message.done' || event.event === 'response.completed';
}

// Add a copy button above each markdown code block.
function addCodeCopyButtons(html: string): string {
  return html.replace(/<pre><code[\s\S]*?<\/code><\/pre>/g, (block) => {
    return `<div class="code-block">${block}<button type="button" class="code-copy-button">Copy</button></div>`;
  });
}
