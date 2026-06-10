import { getPath, json, listen, methodNotAllowed, readJson, sseHeaders, writeSse } from "../../../packages/shared/src/http.js";

const port = Number(process.env.OPENAI_SERVICE_PORT || 4103);
const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";

// Keep only the fields OpenAI needs from our internal message shape.
function toInput(messages) {
  return messages.map((message) => ({
    role: message.role,
    content: message.content
  }));
}

// Stream a fake response during local development when no API key is present.
async function mockStream(res, messages) {
  const latest = [...messages].reverse().find((message) => message.role === "user");
  const response = `Mock AI response: I received "${latest?.content || "your message"}". Add OPENAI_API_KEY to use the real OpenAI backend.`;

  res.writeHead(200, sseHeaders());

  for (const word of response.split(" ")) {
    writeSse(res, "message.delta", { text: `${word} ` });
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  writeSse(res, "message.done", { done: true });
  res.end();
}

// Forward a streaming request to OpenAI's Responses API.
async function openAiStream(res, messages) {
  const upstream = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model,
      input: toInput(messages),
      stream: true
    })
  });

  res.writeHead(upstream.status, Object.fromEntries(upstream.headers.entries()));

  if (!upstream.body) {
    res.end();
    return;
  }

  for await (const chunk of upstream.body) {
    res.write(chunk);
  }

  res.end();
}

// Keeps the OpenAI API key isolated from the Angular app and other services.
listen("openai-service", port, async (req, res) => {
  const path = getPath(req);

  if (path === "/health") {
    json(res, 200, {
      service: "openai-service",
      status: "ok",
      model,
      mode: process.env.OPENAI_API_KEY ? "openai" : "mock"
    });
    return;
  }

  if (path === "/ai/stream") {
    if (req.method !== "POST") {
      methodNotAllowed(res);
      return;
    }

    const { messages = [] } = await readJson(req);

    if (!process.env.OPENAI_API_KEY) {
      await mockStream(res, messages);
      return;
    }

    await openAiStream(res, messages);
    return;
  }

  json(res, 404, { error: "not_found" });
});
