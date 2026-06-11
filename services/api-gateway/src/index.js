import "dotenv/config";
import { createHmac, timingSafeEqual } from "node:crypto";
import { json, listen, getPath } from "../../../packages/shared/src/http.js";

const port = Number(process.env.GATEWAY_PORT || 8080);
const jwtSecret = process.env.JWT_SECRET || "development-secret";

const routes = [
  { prefix: "/api/auth", target: process.env.AUTH_SERVICE_URL || "http://localhost:4101" },
  { prefix: "/api/chat", target: process.env.CHAT_SERVICE_URL || "http://localhost:4102" },
  { prefix: "/api/textbooks", target: process.env.TEXTBOOK_SERVICE_URL || "http://localhost:4104" }
];

// Forward a public gateway request to the matching internal service.
async function proxy(req, res, target) {
  const upstreamUrl = new URL(req.url.replace(/^\/api/, ""), target);
  const headers = { ...req.headers };
  delete headers.host;

  const upstream = await fetch(upstreamUrl, {
    method: req.method,
    headers,
    body: ["GET", "HEAD"].includes(req.method || "") ? undefined : req,
    duplex: "half"
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

// Public entry point used by the Angular app.
listen("api-gateway", port, async (req, res) => {
  const path = getPath(req);

  if (path === "/health") {
    json(res, 200, { service: "api-gateway", status: "ok" });
    return;
  }

  const route = routes.find((item) => path.startsWith(item.prefix));

  if (!route) {
    json(res, 404, {
      error: "route_not_found",
      availableRoutes: routes.map((item) => item.prefix)
    });
    return;
  }

  const tokenPayload = getBearerTokenPayload(req);

  if ((route.prefix === "/api/chat" || route.prefix === "/api/textbooks") && !tokenPayload) {
    json(res, 401, { error: "login_required" });
    return;
  }

  if (tokenPayload) {
    req.headers["x-user-id"] = tokenPayload.sub;
    req.headers["x-user-email"] = tokenPayload.email;
  }

  await proxy(req, res, route.target);
});

// The prototype token is signed by auth-service as base64url(payload).hmac.
function getBearerTokenPayload(req) {
  const authorization = req.headers.authorization || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";
  const [body, signature] = token.split(".");

  if (!body || !signature) {
    return null;
  }

  const expectedSignature = createHmac("sha256", jwtSecret).update(body).digest("base64url");
  const actual = Buffer.from(signature);
  const expected = Buffer.from(expectedSignature);

  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    return payload.sub && payload.email ? payload : null;
  } catch {
    return null;
  }
}
