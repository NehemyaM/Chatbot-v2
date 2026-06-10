import "dotenv/config";
import { randomUUID } from "node:crypto";
import { getPath, json, listen, methodNotAllowed, readJson } from "../../../packages/shared/src/http.js";
import { createChatRepository } from "./chat-repository.js";

const port = Number(process.env.CHAT_SERVICE_PORT || 4102);
const openAiServiceUrl = process.env.OPENAI_SERVICE_URL || "http://localhost:4103";
const repository = await createChatRepository();

// Create/update a conversation, ask the AI service, and stream the answer back.
async function streamFromAiService(req, res) {
  const body = await readJson(req);
  const conversationId = body.conversationId || randomUUID();
  const messages = body.messages || [];
  const shouldSave = body.save !== false;
  const latestUserMessage = messages.at(-1);
  const title = latestUserMessage?.content?.slice(0, 48) || "New chat";
  let modelMessages = messages.map(normalizeIncomingMessage);

  if (shouldSave) {
    await repository.ensureConversation({ id: conversationId, title });

    for (const message of modelMessages) {
      await repository.addMessage(conversationId, message);
    }

    const conversation = await repository.getConversation(conversationId);
    modelMessages = conversation.messages;
  }

  const upstream = await fetch(new URL("/ai/stream", openAiServiceUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      conversationId,
      messages: modelMessages
    })
  });

  res.writeHead(upstream.status, Object.fromEntries(upstream.headers.entries()));

  if (!upstream.body) {
    res.end();
    return;
  }

  let assistantText = "";
  let streamBuffer = "";
  const decoder = new TextDecoder();

  for await (const chunk of upstream.body) {
    const text = decoder.decode(chunk);
    streamBuffer += text;
    const extracted = extractAssistantText(streamBuffer);
    assistantText += extracted.text;
    streamBuffer = extracted.remaining;
    res.write(chunk);
  }

  if (shouldSave) {
    await repository.addMessage(conversationId, {
      id: randomUUID(),
      role: "assistant",
      content: assistantText,
      createdAt: new Date().toISOString()
    });
  }

  res.end();
}

// Give incoming frontend messages an id and timestamp before saving.
function normalizeIncomingMessage(message) {
  return {
    id: message.id || randomUUID(),
    role: message.role,
    content: message.content,
    createdAt: message.createdAt || new Date().toISOString()
  };
}

// Pull assistant text out of SSE frames so saved history stores clean text.
function extractAssistantText(buffer) {
  const chunks = buffer.split("\n\n");
  const remaining = chunks.pop() ?? "";
  let text = "";

  for (const chunk of chunks) {
    const event = parseSseChunk(chunk);
    const data = event?.data;

    if (!data || typeof data === "string") {
      continue;
    }

    text += data.text || data.delta || "";
  }

  return { text, remaining };
}

// Parse one Server-Sent Events chunk from the AI service.
function parseSseChunk(chunk) {
  const data = chunk
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.replace("data:", "").trim())
    .join("\n");

  if (!data || data === "[DONE]") {
    return null;
  }

  try {
    return { data: JSON.parse(data) };
  } catch {
    return { data };
  }
}

// Owns chat history and delegates model calls to the OpenAI service.
listen("chat-service", port, async (req, res) => {
  const path = getPath(req);

  if (path === "/health") {
    json(res, 200, { service: "chat-service", status: "ok" });
    return;
  }

  if (path === "/chat/conversations" && req.method === "GET") {
    json(res, 200, {
      conversations: await repository.listConversations()
    });
    return;
  }

  const conversationMatch = path.match(/^\/chat\/conversations\/([^/]+)$/);

  if (conversationMatch && req.method === "GET") {
    const conversation = await repository.getConversation(conversationMatch[1]);

    if (!conversation) {
      json(res, 404, { error: "conversation_not_found" });
      return;
    }

    json(res, 200, { conversation });
    return;
  }

  if (conversationMatch && req.method === "PATCH") {
    const { title } = await readJson(req);
    const nextTitle = title?.trim();

    if (!nextTitle) {
      json(res, 400, { error: "title_required" });
      return;
    }

    const conversation = await repository.renameConversation(conversationMatch[1], nextTitle);

    if (!conversation) {
      json(res, 404, { error: "conversation_not_found" });
      return;
    }

    json(res, 200, { conversation });
    return;
  }

  if (conversationMatch && req.method === "DELETE") {
    const wasDeleted = await repository.deleteConversation(conversationMatch[1]);

    if (!wasDeleted) {
      json(res, 404, { error: "conversation_not_found" });
      return;
    }

    json(res, 200, { deleted: true });
    return;
  }

  if (path === "/chat/stream") {
    if (req.method !== "POST") {
      methodNotAllowed(res);
      return;
    }

    await streamFromAiService(req, res);
    return;
  }

  json(res, 404, { error: "not_found" });
});
