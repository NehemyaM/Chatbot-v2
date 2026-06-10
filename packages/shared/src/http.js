import { createServer } from "node:http";

// Send a consistent JSON response from every backend service.
export function json(res, statusCode, body, headers = {}) {
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    ...headers
  });
  res.end(JSON.stringify(body));
}

// Return the same method error shape across services.
export function methodNotAllowed(res) {
  json(res, 405, { error: "method_not_allowed" });
}

// Read and parse a JSON request body without adding a framework yet.
export async function readJson(req) {
  const chunks = [];

  for await (const chunk of req) {
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

// Wrap each service with development CORS and one central error handler.
export function withCors(handler) {
  return async (req, res) => {
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    res.setHeader("access-control-allow-headers", "content-type,authorization");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      await handler(req, res);
    } catch (error) {
      console.error(error);
      json(res, 500, { error: "internal_server_error" });
    }
  };
}

// Start a small HTTP service with the shared CORS/error wrapper.
export function listen(name, port, handler) {
  const server = createServer(withCors(handler));

  server.listen(port, () => {
    console.log(`${name} listening on http://localhost:${port}`);
  });

  return server;
}

// Extract only the URL path so route checks stay simple and readable.
export function getPath(req) {
  return new URL(req.url, "http://localhost").pathname;
}

// Headers required for Server-Sent Events streaming.
export function sseHeaders() {
  return {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive"
  };
}

// Write one Server-Sent Events frame.
export function writeSse(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}
