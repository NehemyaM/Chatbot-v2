import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

interface CodeFileGuide {
  id: string;
  label: string;
  path: string;
  layer: string;
  role: string;
  receivesFrom: string[];
  sendsTo: string[];
  functions: Array<{
    name: string;
    purpose: string;
  }>;
  topics: string[];
}

@Component({
  selector: 'app-learn-page',
  imports: [RouterLink],
  templateUrl: './learn-page.component.html',
  styleUrl: './learn-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class LearnPageComponent {
  readonly files: CodeFileGuide[] = [
    {
      id: 'chat-page',
      label: 'chat-page.component.ts',
      path: 'apps/web/src/app/chat/chat-page.component.ts',
      layer: 'Angular frontend',
      role: 'Main chat screen. It owns the visible chat state, sidebar state, selected conversation, composer text, streaming status, and attachment placeholder UI.',
      receivesFrom: ['User clicks and typing', 'ChatApiService stream events', 'Saved conversations API'],
      sendsTo: ['ChatApiService', 'Angular template', 'Browser file picker'],
      functions: [
        { name: 'refreshConversations()', purpose: 'Loads saved chats for the sidebar.' },
        { name: 'openConversation()', purpose: 'Loads one saved chat and displays its messages.' },
        { name: 'sendMessage()', purpose: 'Adds user/assistant bubbles and starts streaming.' },
        { name: 'applyStreamEvent()', purpose: 'Appends each streamed text delta to the assistant message.' },
        { name: 'toggleConversationMenu()', purpose: 'Opens the Rename/Delete menu for one chat.' }
      ],
      topics: ['Angular component', 'Signals', 'Computed state', 'RxJS Subscription', 'HostListener', 'ViewChild', 'Event handling']
    },
    {
      id: 'chat-api',
      label: 'chat-api.service.ts',
      path: 'apps/web/src/app/chat/chat-api.service.ts',
      layer: 'Angular frontend service',
      role: 'Single frontend API client for chat. It hides fetch calls from the component and converts backend streaming events into an Observable.',
      receivesFrom: ['ChatPageComponent method calls'],
      sendsTo: ['API Gateway at /api/chat/*', 'ChatPageComponent Observable subscription'],
      functions: [
        { name: 'listConversations()', purpose: 'GET saved conversation summaries.' },
        { name: 'getConversation()', purpose: 'GET one full conversation with messages.' },
        { name: 'renameConversation()', purpose: 'PATCH a conversation title.' },
        { name: 'deleteConversation()', purpose: 'DELETE one saved conversation.' },
        { name: 'readServerSentEvents()', purpose: 'Parses streamed response chunks.' }
      ],
      topics: ['Angular service', 'Fetch API', 'Observable', 'Server-Sent Events', 'AbortController', 'JSON parsing']
    },
    {
      id: 'chat-html',
      label: 'chat-page.component.html',
      path: 'apps/web/src/app/chat/chat-page.component.html',
      layer: 'Angular template',
      role: 'Defines the visible chat UI: sidebar, chat messages, header, composer, plus button, rename/delete menu, and streaming states.',
      receivesFrom: ['Signals and methods from ChatPageComponent'],
      sendsTo: ['User events back to ChatPageComponent'],
      functions: [
        { name: '@for conversations', purpose: 'Renders saved chats in the sidebar.' },
        { name: '@if menuConversationId()', purpose: 'Shows Rename/Delete only for the selected chat.' },
        { name: '(ngSubmit)', purpose: 'Calls sendMessage() when the composer submits.' },
        { name: '(click)', purpose: 'Routes button clicks to component methods.' }
      ],
      topics: ['Angular control flow', 'Template binding', 'Event binding', 'ngModel', 'Accessibility labels']
    },
    {
      id: 'gateway',
      label: 'api-gateway/index.js',
      path: 'services/api-gateway/src/index.js',
      layer: 'Backend gateway',
      role: 'Public backend entry point. The frontend talks to this service instead of calling every microservice directly.',
      receivesFrom: ['Angular frontend /api requests'],
      sendsTo: ['Auth Service', 'Chat Service'],
      functions: [
        { name: 'proxy()', purpose: 'Forwards the incoming request to the selected internal service.' },
        { name: 'listen()', purpose: 'Starts the gateway HTTP server.' }
      ],
      topics: ['API gateway', 'Reverse proxy', 'HTTP headers', 'Streaming proxy', 'Microservice routing']
    },
    {
      id: 'chat-service',
      label: 'chat-service/index.js',
      path: 'services/chat-service/src/index.js',
      layer: 'Backend chat service',
      role: 'Owns conversations. It saves user messages, loads history, calls the OpenAI service, streams chunks back, and saves assistant replies.',
      receivesFrom: ['API Gateway /chat/* requests', 'OpenAI Service stream chunks', 'Chat repository'],
      sendsTo: ['OpenAI Service', 'PostgreSQL through repository', 'API Gateway streaming response'],
      functions: [
        { name: 'streamFromAiService()', purpose: 'Main chat pipeline for save -> call AI -> stream -> save assistant.' },
        { name: 'normalizeIncomingMessage()', purpose: 'Adds missing ids/timestamps before saving.' },
        { name: 'extractAssistantText()', purpose: 'Turns streamed SSE frames into clean saved text.' },
        { name: 'parseSseChunk()', purpose: 'Parses one SSE frame from the AI service.' }
      ],
      topics: ['HTTP routes', 'Server-Sent Events', 'Repository pattern', 'Async iteration', 'PostgreSQL persistence']
    },
    {
      id: 'repository',
      label: 'chat-repository.js',
      path: 'services/chat-service/src/chat-repository.js',
      layer: 'Backend data layer',
      role: 'Storage layer for chat data. It provides the same methods for PostgreSQL and in-memory fallback.',
      receivesFrom: ['Chat Service method calls', 'DATABASE_URL environment variable'],
      sendsTo: ['PostgreSQL database', 'Chat Service results'],
      functions: [
        { name: 'listConversations()', purpose: 'Returns sidebar rows with message counts.' },
        { name: 'getConversation()', purpose: 'Loads one conversation and its messages.' },
        { name: 'ensureConversation()', purpose: 'Creates a conversation row if needed.' },
        { name: 'addMessage()', purpose: 'Saves a user or assistant message.' },
        { name: 'renameConversation()', purpose: 'Updates the title.' },
        { name: 'deleteConversation()', purpose: 'Deletes a conversation and its messages.' }
      ],
      topics: ['Repository pattern', 'SQL', 'PostgreSQL Pool', 'Fallback storage', 'Environment configuration']
    },
    {
      id: 'openai-service',
      label: 'openai-service/index.js',
      path: 'services/openai-service/src/index.js',
      layer: 'Backend AI service',
      role: 'Isolates the OpenAI API key. It either streams from OpenAI or returns a mock stream when no key is configured.',
      receivesFrom: ['Chat Service /ai/stream request', 'OPENAI_API_KEY environment variable'],
      sendsTo: ['OpenAI Responses API', 'Chat Service SSE stream'],
      functions: [
        { name: 'toInput()', purpose: 'Converts internal messages to model input.' },
        { name: 'mockStream()', purpose: 'Streams fake text for local development.' },
        { name: 'openAiStream()', purpose: 'Calls the OpenAI Responses API with streaming enabled.' }
      ],
      topics: ['OpenAI API', 'API key isolation', 'Streaming', 'Mock development mode', 'Service boundary']
    },
    {
      id: 'schema',
      label: 'schema.sql',
      path: 'infra/database/schema.sql',
      layer: 'Database',
      role: 'Defines the tables and indexes that make saved chat history possible.',
      receivesFrom: ['PostgreSQL container startup', 'Chat repository queries'],
      sendsTo: ['conversations table', 'messages table'],
      functions: [
        { name: 'conversations table', purpose: 'Stores chat id, title, created_at, and updated_at.' },
        { name: 'messages table', purpose: 'Stores each user/assistant message for a conversation.' },
        { name: 'indexes', purpose: 'Make loading conversations and messages faster.' }
      ],
      topics: ['SQL schema', 'UUID primary keys', 'Foreign keys', 'Indexes', 'Cascade delete']
    }
  ];

  readonly selectedFileId = signal(this.files[0].id);
  readonly selectedFile = computed(() => this.files.find((file) => file.id === this.selectedFileId()) ?? this.files[0]);

  selectFile(fileId: string): void {
    this.selectedFileId.set(fileId);
  }
}
