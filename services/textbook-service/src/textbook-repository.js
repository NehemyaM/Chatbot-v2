import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Pool } = pg;
const currentDir = dirname(fileURLToPath(import.meta.url));
const schemaPath = resolve(currentDir, "../../../infra/database/schema.sql");

export class PostgresTextbookRepository {
  constructor(connectionString) {
    this.pool = new Pool({ connectionString });
  }

  async init() {
    const schema = await readFile(schemaPath, "utf8");
    await this.pool.query("SELECT pg_advisory_lock(842001)");

    try {
      await this.pool.query(schema);
    } finally {
      await this.pool.query("SELECT pg_advisory_unlock(842001)");
    }
  }

  async listTextbooks(userId) {
    const result = await this.pool.query(
      `
        SELECT
          id,
          title,
          openai_file_id AS "openaiFileId",
          vector_store_id AS "vectorStoreId",
          workflow_id AS "workflowId",
          status,
          created_at AS "createdAt"
        FROM textbooks
        WHERE user_id = $1
        ORDER BY created_at DESC
      `,
      [userId]
    );

    return result.rows;
  }

  async getTextbook(userId, id) {
    const result = await this.pool.query(
      `
        SELECT
          id,
          title,
          openai_file_id AS "openaiFileId",
          vector_store_id AS "vectorStoreId",
          workflow_id AS "workflowId",
          status,
          created_at AS "createdAt"
        FROM textbooks
        WHERE user_id = $1 AND id = $2
      `,
      [userId, id]
    );

    return result.rows[0] || null;
  }

  async addTextbook(userId, textbook) {
    const result = await this.pool.query(
      `
        INSERT INTO textbooks (id, user_id, title, openai_file_id, vector_store_id, workflow_id, status)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING
          id,
          title,
          openai_file_id AS "openaiFileId",
          vector_store_id AS "vectorStoreId",
          workflow_id AS "workflowId",
          status,
          created_at AS "createdAt"
      `,
      [
        textbook.id,
        userId,
        textbook.title,
        textbook.openaiFileId,
        textbook.vectorStoreId,
        textbook.workflowId || null,
        textbook.status || "ready"
      ]
    );

    return result.rows[0];
  }
}

export class MemoryTextbookRepository {
  constructor() {
    this.textbooks = new Map();
  }

  async init() {}

  async listTextbooks(userId) {
    return [...this.textbooks.values()]
      .filter((textbook) => textbook.userId === userId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async getTextbook(userId, id) {
    const textbook = this.textbooks.get(id);
    return textbook?.userId === userId ? textbook : null;
  }

  async addTextbook(userId, textbook) {
    const stored = {
      ...textbook,
      userId,
      createdAt: new Date().toISOString()
    };

    this.textbooks.set(textbook.id, stored);
    return stored;
  }
}

export async function createTextbookRepository() {
  if (!process.env.DATABASE_URL) {
    const repository = new MemoryTextbookRepository();
    await repository.init();
    console.log("textbook-service using in-memory storage");
    return repository;
  }

  const repository = new PostgresTextbookRepository(process.env.DATABASE_URL);

  try {
    await repository.init();
    console.log("textbook-service connected to PostgreSQL");
    return repository;
  } catch (error) {
    console.error("textbook-service could not connect to PostgreSQL; using in-memory storage", error.message);
    const fallback = new MemoryTextbookRepository();
    await fallback.init();
    return fallback;
  }
}
