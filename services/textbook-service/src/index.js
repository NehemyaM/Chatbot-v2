import "dotenv/config";
import { randomUUID } from "node:crypto";
import { getPath, json, listen, methodNotAllowed, readJson } from "../../../packages/shared/src/http.js";
import { createTextbookRepository } from "./textbook-repository.js";

const port = Number(process.env.TEXTBOOK_SERVICE_PORT || 4104);
const model = process.env.TEXTBOOK_MODEL || process.env.OPENAI_MODEL || "gpt-4.1-mini";
const workflowId = process.env.OPENAI_TEXTBOOK_WORKFLOW_ID || "wf_6a2a0b2a079c8190b0e8912320150fb801f1bd940b4313ac";
const outOfContextMessage = "This question is out of context and cannot be answered based on the provided textbook.";
const repository = await createTextbookRepository();

listen("textbook-service", port, async (req, res) => {
  const path = getPath(req);
  const userId = req.headers["x-user-id"];

  if (path === "/health") {
    json(res, 200, {
      service: "textbook-service",
      status: "ok",
      model,
      mode: process.env.OPENAI_API_KEY ? "openai" : "mock"
    });
    return;
  }

  if (!userId) {
    json(res, 401, { error: "login_required" });
    return;
  }

  if (path === "/textbooks" && req.method === "GET") {
    json(res, 200, {
      textbooks: await repository.listTextbooks(userId)
    });
    return;
  }

  if (path === "/textbooks/upload") {
    if (req.method !== "POST") {
      methodNotAllowed(res);
      return;
    }

    await uploadTextbook(req, res, userId);
    return;
  }

  const askMatch = path.match(/^\/textbooks\/([^/]+)\/ask$/);

  if (askMatch) {
    if (req.method !== "POST") {
      methodNotAllowed(res);
      return;
    }

    await askTextbook(req, res, userId, askMatch[1]);
    return;
  }

  json(res, 404, { error: "not_found" });
});

async function uploadTextbook(req, res, userId) {
  const upload = await readMultipartFile(req);

  if (!upload) {
    json(res, 400, { error: "file_required" });
    return;
  }

  if (!process.env.OPENAI_API_KEY) {
    json(res, 500, { error: "openai_api_key_required" });
    return;
  }

  const openaiFile = await uploadFileToOpenAI(upload);
  const vectorStore = await createVectorStore(upload.filename);
  await attachFileToVectorStore(vectorStore.id, openaiFile.id);
  await waitForVectorStoreFile(vectorStore.id, openaiFile.id);

  const textbook = await repository.addTextbook(userId, {
    id: randomUUID(),
    title: cleanTitle(upload.filename),
    openaiFileId: openaiFile.id,
    vectorStoreId: vectorStore.id,
    workflowId,
    status: "ready"
  });

  json(res, 201, { textbook });
}

async function askTextbook(req, res, userId, textbookId) {
  const textbook = await repository.getTextbook(userId, textbookId);

  if (!textbook) {
    json(res, 404, { error: "textbook_not_found" });
    return;
  }

  const { question } = await readJson(req);
  const trimmedQuestion = question?.trim();

  if (!trimmedQuestion) {
    json(res, 400, { error: "question_required" });
    return;
  }

  if (!process.env.OPENAI_API_KEY) {
    json(res, 200, {
      answer: `Mock textbook answer for "${trimmedQuestion}". Add OPENAI_API_KEY to use the real textbook agent.`,
      citations: []
    });
    return;
  }

  const searchResults = await searchVectorStore(textbook.vectorStoreId, trimmedQuestion);
  const context = toContext(searchResults);

  if (!context) {
    json(res, 200, { answer: outOfContextMessage, citations: [] });
    return;
  }

  const answer = await answerFromContext(trimmedQuestion, context);

  json(res, 200, {
    answer,
    citations: searchResults.map((result) => ({
      fileId: result.file_id,
      filename: result.filename,
      score: result.score
    }))
  });
}

async function uploadFileToOpenAI(upload) {
  const formData = new FormData();
  formData.set("purpose", "assistants");
  formData.set("file", new File([upload.buffer], upload.filename, { type: upload.contentType }));

  const response = await fetch("https://api.openai.com/v1/files", {
    method: "POST",
    headers: openAiHeaders(false),
    body: formData
  });

  return readOpenAiJson(response);
}

async function createVectorStore(filename) {
  const response = await fetch("https://api.openai.com/v1/vector_stores", {
    method: "POST",
    headers: openAiHeaders(),
    body: JSON.stringify({
      name: `Textbook: ${cleanTitle(filename)}`
    })
  });

  return readOpenAiJson(response);
}

async function attachFileToVectorStore(vectorStoreId, fileId) {
  const response = await fetch(`https://api.openai.com/v1/vector_stores/${vectorStoreId}/files`, {
    method: "POST",
    headers: openAiHeaders(),
    body: JSON.stringify({ file_id: fileId })
  });

  return readOpenAiJson(response);
}

async function waitForVectorStoreFile(vectorStoreId, fileId) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const response = await fetch(`https://api.openai.com/v1/vector_stores/${vectorStoreId}/files/${fileId}`, {
      headers: openAiHeaders(false)
    });
    const body = await readOpenAiJson(response);

    if (body.status === "completed") {
      return body;
    }

    if (body.status === "failed" || body.status === "cancelled") {
      throw new Error(`Textbook processing ${body.status}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  throw new Error("Textbook processing timed out");
}

async function searchVectorStore(vectorStoreId, query) {
  const response = await fetch(`https://api.openai.com/v1/vector_stores/${vectorStoreId}/search`, {
    method: "POST",
    headers: openAiHeaders(),
    body: JSON.stringify({
      query,
      max_num_results: 10
    })
  });

  const body = await readOpenAiJson(response);
  return body.data || [];
}

async function answerFromContext(question, context) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: openAiHeaders(),
    body: JSON.stringify({
      model,
      input: [
        {
          role: "system",
          content: textbookInstructions()
        },
        {
          role: "user",
          content: `Question:\n${question}\n\nRetrieved textbook context:\n${context}`
        }
      ],
      max_output_tokens: 1400
    })
  });

  const body = await readOpenAiJson(response);
  return extractResponseText(body) || outOfContextMessage;
}

function textbookInstructions() {
  return `
You are a textbook-only study assistant created from the user's Agent Builder workflow ${workflowId}.

Use only the retrieved textbook context provided in the user message.
Do not use outside knowledge, memory, assumptions, or web knowledge.
If the answer is not clearly supported by the retrieved textbook context, reply exactly:
"${outOfContextMessage}"

For supported answers, use this format:
Textbook Evidence:
- Briefly cite or paraphrase the relevant textbook evidence.

Answer:
- Give the concise answer.

For tables, charts, figures, and diagrams, answer only from captions, labels, extracted text, or descriptions present in the retrieved context.
`.trim();
}

function toContext(results) {
  return results
    .map((result, index) => {
      const text = extractSearchText(result);

      if (!text) {
        return "";
      }

      return `Source ${index + 1} (${result.filename || result.file_id}, score ${result.score}):\n${text}`;
    })
    .filter(Boolean)
    .join("\n\n---\n\n");
}

function extractSearchText(result) {
  if (typeof result.content === "string") {
    return result.content;
  }

  if (Array.isArray(result.content)) {
    return result.content
      .map((item) => item.text || item.content || "")
      .filter(Boolean)
      .join("\n");
  }

  return result.text || "";
}

function extractResponseText(body) {
  if (body.output_text) {
    return body.output_text;
  }

  return (body.output || [])
    .flatMap((item) => item.content || [])
    .map((content) => content.text || "")
    .filter(Boolean)
    .join("\n");
}

function openAiHeaders(hasJsonBody = true) {
  const headers = {
    authorization: `Bearer ${process.env.OPENAI_API_KEY}`
  };

  if (hasJsonBody) {
    headers["content-type"] = "application/json";
  }

  return headers;
}

async function readOpenAiJson(response) {
  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(body.error?.message || `OpenAI request failed with status ${response.status}`);
  }

  return body;
}

async function readMultipartFile(req) {
  const contentType = req.headers["content-type"] || "";
  const boundary = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/)?.[1] || contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/)?.[2];

  if (!boundary) {
    return null;
  }

  const chunks = [];

  for await (const chunk of req) {
    chunks.push(chunk);
  }

  const body = Buffer.concat(chunks);
  const boundaryText = `--${boundary}`;
  const parts = body.toString("binary").split(boundaryText);

  for (const part of parts) {
    if (!part.includes("filename=")) {
      continue;
    }

    const [rawHeaders, rawContent] = part.split("\r\n\r\n");

    if (!rawContent) {
      continue;
    }

    const filename = rawHeaders.match(/filename="([^"]+)"/)?.[1] || "textbook.pdf";
    const partContentType = rawHeaders.match(/content-type:\s*([^\r\n]+)/i)?.[1] || "application/pdf";
    const content = rawContent.replace(/\r\n--$/, "").replace(/\r\n$/, "");

    return {
      filename,
      contentType: partContentType,
      buffer: Buffer.from(content, "binary")
    };
  }

  return null;
}

function cleanTitle(filename) {
  return filename.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() || "Textbook";
}
