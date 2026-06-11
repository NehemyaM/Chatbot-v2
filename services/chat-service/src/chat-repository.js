import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Pool } = pg;
const currentDir = dirname(fileURLToPath(import.meta.url));
const schemaPath = resolve(currentDir, "../../../infra/database/schema.sql");

// Repository used when DATABASE_URL is available and PostgreSQL is running.
export class PostgresChatRepository {
  constructor(connectionString) {
    this.pool = new Pool({ connectionString });
  }

  // Create tables on service startup so local setup stays simple.
  async init() {
    const schema = await readFile(schemaPath, "utf8");
    await this.pool.query("SELECT pg_advisory_lock(842001)");

    try {
      await this.pool.query(schema);
    } finally {
      await this.pool.query("SELECT pg_advisory_unlock(842001)");
    }
  }

  // Return lightweight conversation rows for the sidebar.
  async listConversations() {
    const result = await this.pool.query(`
      SELECT
        c.id,
        c.title,
        c.created_at AS "createdAt",
        c.updated_at AS "updatedAt",
        COUNT(m.id)::int AS "messageCount"
      FROM conversations c
      LEFT JOIN messages m ON m.conversation_id = c.id
      GROUP BY c.id
      ORDER BY c.updated_at DESC
    `);

    return result.rows;
  }

  // Load one full conversation with messages in display order.
  async getConversation(id) {
    const conversationResult = await this.pool.query(
      `
        SELECT id, title, created_at AS "createdAt", updated_at AS "updatedAt"
        FROM conversations
        WHERE id = $1
      `,
      [id]
    );

    if (conversationResult.rowCount === 0) {
      return null;
    }

    const messagesResult = await this.pool.query(
      `
        SELECT id, role, content, created_at AS "createdAt"
        FROM messages
        WHERE conversation_id = $1
        ORDER BY created_at ASC
      `,
      [id]
    );

    return {
      ...conversationResult.rows[0],
      messages: messagesResult.rows
    };
  }

  // Make sure a conversation row exists before saving messages into it.
  async ensureConversation({ id, title }) {
    const result = await this.pool.query(
      `
        INSERT INTO conversations (id, title)
        VALUES ($1, $2)
        ON CONFLICT (id) DO UPDATE
          SET updated_at = NOW()
        RETURNING id, title
      `,
      [id, title]
    );

    return result.rows[0];
  }

  // Save one message and bump the parent conversation's updated timestamp.
  async addMessage(conversationId, message) {
    await this.pool.query(
      `
        INSERT INTO messages (id, conversation_id, role, content, created_at)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (id) DO NOTHING
      `,
      [message.id || randomUUID(), conversationId, message.role, message.content, message.createdAt || new Date()]
    );

    await this.pool.query(
      `
        UPDATE conversations
        SET updated_at = NOW()
        WHERE id = $1
      `,
      [conversationId]
    );
  }

  // Rename one conversation and return the updated row.
  async renameConversation(id, title) {
    const result = await this.pool.query(
      `
        UPDATE conversations
        SET title = $2, updated_at = NOW()
        WHERE id = $1
        RETURNING id, title, created_at AS "createdAt", updated_at AS "updatedAt"
      `,
      [id, title]
    );

    return result.rows[0] || null;
  }

  // Delete one conversation and cascade-delete its messages.
  async deleteConversation(id) {
    const result = await this.pool.query("DELETE FROM conversations WHERE id = $1", [id]);
    return result.rowCount > 0;
  }
}

// In-memory fallback keeps the app usable when Postgres is not started yet.
export class MemoryChatRepository {
  constructor() {
    this.conversations = new Map();
  }

  async init() {}

  async listConversations() {
    return [...this.conversations.values()]
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map((conversation) => ({
        id: conversation.id,
        title: conversation.title,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
        messageCount: conversation.messages.length
      }));
  }

  async getConversation(id) {
    return this.conversations.get(id) || null;
  }

  async ensureConversation({ id, title }) {
    const now = new Date().toISOString();

    if (!this.conversations.has(id)) {
      this.conversations.set(id, {
        id,
        title,
        createdAt: now,
        updatedAt: now,
        messages: []
      });
    }

    const conversation = this.conversations.get(id);
    conversation.updatedAt = now;
    return conversation;
  }

  async addMessage(conversationId, message) {
    const conversation = this.conversations.get(conversationId);

    if (!conversation) {
      throw new Error(`Conversation ${conversationId} does not exist`);
    }

    conversation.messages.push({
      id: message.id || randomUUID(),
      role: message.role,
      content: message.content,
      createdAt: message.createdAt || new Date().toISOString()
    });
    conversation.updatedAt = new Date().toISOString();
  }

  async renameConversation(id, title) {
    const conversation = this.conversations.get(id);

    if (!conversation) {
      return null;
    }

    conversation.title = title;
    conversation.updatedAt = new Date().toISOString();
    return conversation;
  }

  async deleteConversation(id) {
    return this.conversations.delete(id);
  }
}

// Prefer Postgres when configured, otherwise fall back to memory.
export async function createChatRepository() {
  if (!process.env.DATABASE_URL) {
    const repository = new MemoryChatRepository();
    await repository.init();
    console.log("chat-service using in-memory storage");
    return repository;
  }

  const repository = new PostgresChatRepository(process.env.DATABASE_URL);

  try {
    await repository.init();
    console.log("chat-service connected to PostgreSQL");
    return repository;
  } catch (error) {
    console.error("chat-service could not connect to PostgreSQL; using in-memory storage", error.message);
    const fallback = new MemoryChatRepository();
    await fallback.init();
    return fallback;
  }
}
