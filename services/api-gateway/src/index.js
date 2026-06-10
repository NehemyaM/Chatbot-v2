import { json, listen, getPath } from "../../../packages/shared/src/http.js";

const port = Number(process.env.GATEWAY_PORT || 8080);

const routes = [
  { prefix: "/api/auth", target: process.env.AUTH_SERVICE_URL || "http://localhost:4101" },
  { prefix: "/api/chat", target: process.env.CHAT_SERVICE_URL || "http://localhost:4102" }
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

  await proxy(req, res, route.target);
});
