import { ChatMessage } from './chat-message.model';

export interface ChatConversationSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export interface ChatConversation extends ChatConversationSummary {
  messages: ChatMessage[];
}
