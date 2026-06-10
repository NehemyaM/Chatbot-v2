import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  ViewChild,
  computed,
  inject,
  signal
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { Subscription } from 'rxjs';

import { AuthSessionService } from '../auth/auth-session.service';
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
export class ChatPageComponent implements OnDestroy {
  private readonly chatApi = inject(ChatApiService);
  private readonly authSession = inject(AuthSessionService);
  private activeStream?: Subscription;
  private responseTimerId?: number;
  private responseTimeoutId?: number;

  // Signals keep the template reactive without a heavier state library.
  readonly activeConversationId = signal<string>(crypto.randomUUID());
  readonly activeConversationTitle = signal('New conversation');
  readonly conversations = signal<ChatConversationSummary[]>([]);
  readonly attachmentMenuOpen = signal(false);
  readonly attachments = signal<SelectedAttachment[]>([]);
  readonly isAuthModalOpen = signal(false);
  readonly isLoggingIn = signal(false);
  readonly loginError = signal('');
  readonly loginEmail = signal('');
  readonly loginPassword = signal('');
  readonly draft = signal('');
  readonly menuConversationId = signal<string | null>(null);
  readonly messages = signal<ChatMessage[]>([]);
  readonly renameDraft = signal('');
  readonly renamingConversationId = signal<string | null>(null);
  readonly isStreaming = signal(false);
  readonly isLoadingConversations = signal(false);
  readonly isSidebarCollapsed = signal(false);
  readonly responseElapsedSeconds = signal(0);
  readonly errorNotice = signal<ErrorNotice | null>(null);
  readonly hasMessages = computed(() => this.messages().length > 0);
  readonly runningStatusLabel = computed(() =>
    this.isStreaming() ? `Thinking ${formatElapsedTime(this.responseElapsedSeconds())}` : 'Ready'
  );
  readonly session = this.authSession.session;
  readonly isLoggedIn = computed(() => Boolean(this.session()));

  @ViewChild('messagesViewport')
  private messagesViewport?: ElementRef<HTMLElement>;

  @ViewChild('fileInput')
  private fileInput?: ElementRef<HTMLInputElement>;

  constructor() {
    if (this.isLoggedIn()) {
      void this.refreshConversations();
    } else {
      this.openAuthModal('Log in to use this chatbot.');
    }
  }

  ngOnDestroy(): void {
    this.activeStream?.unsubscribe();
    this.stopResponseClock();
  }

  // Refresh the saved conversation list shown in the sidebar.
  async refreshConversations(): Promise<void> {
    if (!this.isLoggedIn()) {
      this.conversations.set([]);
      this.isLoadingConversations.set(false);
      return;
    }

    this.isLoadingConversations.set(true);

    try {
      this.conversations.set(await this.chatApi.listConversations());
      this.clearError();
    } catch (error) {
      this.showError('Could not load chats', getFriendlyErrorMessage(error));
    } finally {
      this.isLoadingConversations.set(false);
    }
  }

  // Load a saved conversation and show its messages in the chat panel.
  async openConversation(conversationId: string): Promise<void> {
    if (this.isStreaming()) {
      return;
    }

    if (!this.requireLogin('Log in to open saved chats.')) {
      return;
    }

    try {
      const conversation = await this.chatApi.getConversation(conversationId);

      this.closeConversationMenu();
      this.clearError();
      this.activeConversationId.set(conversation.id);
      this.activeConversationTitle.set(conversation.title);
      this.messages.set(conversation.messages.map(toUiMessage));
      this.draft.set('');
      this.queueScrollToBottom();
    } catch (error) {
      this.showError('Could not open this chat', getFriendlyErrorMessage(error));
    }
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
    if (!this.requireLogin('Log in to rename saved chats.')) {
      return;
    }

    const title = this.renameDraft().trim();

    if (!title) {
      return;
    }

    try {
      const conversation = await this.chatApi.renameConversation(conversationId, title);

      if (conversation.id === this.activeConversationId()) {
        this.activeConversationTitle.set(conversation.title);
      }

      this.renamingConversationId.set(null);
      this.renameDraft.set('');
      this.clearError();
      await this.refreshConversations();
    } catch (error) {
      this.showError('Rename failed', getFriendlyErrorMessage(error));
    }
  }

  // Leave rename mode without changing the saved title.
  cancelRename(): void {
    this.renamingConversationId.set(null);
    this.renameDraft.set('');
  }

  // Delete a saved conversation and reset the panel if it was open.
  async deleteConversation(conversationId: string, event: MouseEvent): Promise<void> {
    event.stopPropagation();

    if (!this.requireLogin('Log in to delete saved chats.')) {
      return;
    }

    try {
      await this.chatApi.deleteConversation(conversationId);

      this.menuConversationId.set(null);
      this.clearError();

      if (conversationId === this.activeConversationId()) {
        this.startNewChat();
      }

      await this.refreshConversations();
    } catch (error) {
      this.showError('Delete failed', getFriendlyErrorMessage(error));
    }
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

    if (!this.requireLogin('Log in to send messages.')) {
      return;
    }

    const userMessage = createMessage('user', content, 'complete');
    const assistantMessage = createMessage('assistant', '', 'streaming');
    const nextMessages = [...this.messages(), userMessage, assistantMessage];

    this.messages.set(nextMessages);
    this.draft.set('');
    this.attachments.set([]);
    this.startResponseClock();
    this.queueScrollToBottom();

    const contextMessages = nextMessages.filter((message) => message.id !== assistantMessage.id);

    this.clearError();
    this.startAssistantStream(assistantMessage.id, contextMessages);
  }

  // Terminate the active SSE request and leave any partial assistant text visible.
  terminateResponse(reason: TerminationReason = 'manual'): void {
    if (!this.activeStream && !this.isStreaming()) {
      return;
    }

    this.activeStream?.unsubscribe();
    this.activeStream = undefined;
    this.stopResponseClock();
    this.finalizeTerminatedMessages(reason);

    if (reason === 'timeout') {
      this.showError(
        'Response timed out',
        `The assistant took longer than ${MAX_RESPONSE_SECONDS} seconds, so the request was terminated.`,
        true
      );
      return;
    }

    if (reason === 'manual') {
      this.showError('Response terminated', 'The running request was stopped. You can send a new message when ready.', false);
    }
  }

  // Backward-compatible name for the existing composer action.
  stopResponse(): void {
    this.terminateResponse('manual');
  }

  // Reset the local draft and message list for a fresh conversation.
  startNewChat(): void {
    this.stopResponse();
    this.closeConversationMenu();
    this.clearError();
    this.activeConversationId.set(crypto.randomUUID());
    this.activeConversationTitle.set('New conversation');
    this.messages.set([]);
    this.draft.set('');
    this.attachments.set([]);
  }

  // Show the login modal when a visitor tries to use the chatbot.
  openAuthModal(message = ''): void {
    this.loginError.set(message);
    this.isAuthModalOpen.set(true);
  }

  closeAuthModal(): void {
    this.isAuthModalOpen.set(false);
    this.loginError.set('');
  }

  async login(): Promise<void> {
    const email = this.loginEmail().trim();
    const password = this.loginPassword();

    if (!email || !password) {
      this.loginError.set('Enter an email and password.');
      return;
    }

    this.isLoggingIn.set(true);

    try {
      await this.authSession.login(email, password);
      this.closeAuthModal();
      await this.refreshConversations();
    } catch (error) {
      this.loginError.set(error instanceof Error ? error.message : 'Login failed.');
    } finally {
      this.isLoggingIn.set(false);
    }
  }

  logout(): void {
    this.authSession.logout();
    this.conversations.set([]);
    this.startNewChat();
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

  // Format the visible thinking timer in the header and assistant bubble.
  formatElapsedTime(seconds: number): string {
    return formatElapsedTime(seconds);
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

  // Retry a failed assistant response without adding a duplicate user message.
  retryFailedResponse(): void {
    if (this.isStreaming()) {
      return;
    }

    const contextMessages = this.messages().filter((message) => message.status !== 'error');

    if (contextMessages.length === this.messages().length) {
      return;
    }

    const assistantMessage = createMessage('assistant', '', 'streaming');

    this.messages.set([...contextMessages, assistantMessage]);
    this.startResponseClock();
    this.clearError();
    this.queueScrollToBottom();

    this.startAssistantStream(assistantMessage.id, contextMessages);
  }

  // Hide the current user-facing error banner.
  clearError(): void {
    this.errorNotice.set(null);
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

  // Start one assistant request and route every outcome through shared cleanup.
  private startAssistantStream(assistantMessageId: string, contextMessages: ChatMessage[]): void {
    this.activeStream = this.chatApi.streamAssistantReply(this.activeConversationId(), contextMessages, {
      save: true
    }).subscribe({
      next: (event) => this.applyStreamEvent(assistantMessageId, event),
      error: (error) => this.markAssistantError(assistantMessageId, error),
      complete: () => this.finishAssistantMessage(assistantMessageId)
    });
  }

  // Show elapsed thinking time and enforce a hard timeout for slow requests.
  private startResponseClock(): void {
    this.stopResponseClock();
    this.responseElapsedSeconds.set(0);
    this.isStreaming.set(true);

    this.responseTimerId = window.setInterval(() => {
      this.responseElapsedSeconds.update((seconds) => seconds + 1);
    }, 1000);

    this.responseTimeoutId = window.setTimeout(() => {
      if (this.isStreaming()) {
        this.terminateResponse('timeout');
      }
    }, MAX_RESPONSE_SECONDS * 1000);
  }

  // Clear timer resources whenever a request ends.
  private stopResponseClock(): void {
    if (this.responseTimerId) {
      window.clearInterval(this.responseTimerId);
      this.responseTimerId = undefined;
    }

    if (this.responseTimeoutId) {
      window.clearTimeout(this.responseTimeoutId);
      this.responseTimeoutId = undefined;
    }

    this.isStreaming.set(false);
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
    this.stopResponseClock();
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
    if (this.isLoggedIn()) {
      void this.refreshConversations();
    }
  }

  // Require one of the seeded accounts before any chatbot action runs.
  private requireLogin(message: string): boolean {
    if (this.isLoggedIn()) {
      return true;
    }

    this.openAuthModal(message);
    return false;
  }

  // Replace the empty assistant bubble with a clear error message.
  private markAssistantError(assistantMessageId: string, error: unknown): void {
    this.activeStream = undefined;
    this.stopResponseClock();
    this.showError('Response failed', getFriendlyErrorMessage(error), true);
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

  // Convert in-flight assistant bubbles into a stable stopped state.
  private finalizeTerminatedMessages(reason: TerminationReason): void {
    this.messages.update((messages) =>
      messages.map((message) => {
        if (message.status !== 'streaming') {
          return message;
        }

        if (reason === 'timeout') {
          return {
            ...message,
            content: message.content || 'The assistant took too long to respond, so this request was terminated.',
            status: 'error'
          };
        }

        return {
          ...message,
          content: message.content || 'This response was terminated before the assistant returned any text.',
          status: message.content ? 'complete' : 'error'
        };
      })
    );
  }

  // Keep error text consistent across sidebar actions and chat streaming.
  private showError(title: string, message: string, canRetry = false): void {
    this.errorNotice.set({ title, message, canRetry });
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

interface ErrorNotice {
  title: string;
  message: string;
  canRetry: boolean;
}

const attachmentAccept: Record<AttachmentKind, string> = {
  file: '.pdf,.doc,.docx,.txt,.csv,.xlsx,.json',
  image: 'image/*'
};

type TerminationReason = 'manual' | 'timeout';

const MAX_RESPONSE_SECONDS = 60;

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

// Display elapsed response time as mm:ss.
function formatElapsedTime(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

// Turn low-level fetch errors into messages that are useful in the UI.
function getFriendlyErrorMessage(error: unknown): string {
  if (error instanceof TypeError) {
    return 'The backend is not reachable. Check that the API gateway is running on port 8080.';
  }

  if (error instanceof Error && error.message.includes('status')) {
    return `${error.message}. Check the backend terminal for details.`;
  }

  return 'Something went wrong. Please try again.';
}

// Add a copy button above each markdown code block.
function addCodeCopyButtons(html: string): string {
  return html.replace(/<pre><code[\s\S]*?<\/code><\/pre>/g, (block) => {
    return `<div class="code-block">${block}<button type="button" class="code-copy-button">Copy</button></div>`;
  });
}
