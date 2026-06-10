import "dotenv/config";
import { createHmac } from "node:crypto";
import { getPath, json, listen, methodNotAllowed, readJson } from "../../../packages/shared/src/http.js";

const port = Number(process.env.AUTH_SERVICE_PORT || 4101);
const jwtSecret = process.env.JWT_SECRET || "development-secret";
const users = new Map();

seedDemoUsers();

// Prototype-only users so the local demo has predictable credentials.
function seedDemoUsers() {
  const demoUsers = [
    {
      id: "demo-owner",
      email: "nehemya@demo.local",
      password: "nehemya123",
      name: "Nehemya"
    },
    {
      id: "demo-guest",
      email: "prototype@demo.local",
      password: "prototype123",
      name: "Prototype Guest"
    }
  ];

  for (const user of demoUsers) {
    users.set(user.email, user);
  }
}

// Temporary token signer for the architecture phase.
// Later this should become a real JWT implementation with expiry.
function signToken(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", jwtSecret).update(body).digest("base64url");
  return `${body}.${signature}`;
}

// Hide internal auth fields before returning a user to the frontend.
function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name
  };
}

// Owns registration and login. Data is in memory until PostgreSQL is wired.
listen("auth-service", port, async (req, res) => {
  const path = getPath(req);

  if (path === "/health") {
    json(res, 200, { service: "auth-service", status: "ok" });
    return;
  }

  if (path === "/auth/register") {
    json(res, 403, { error: "registration_disabled" });
    return;
  }

  if (path === "/auth/login") {
    if (req.method !== "POST") {
      methodNotAllowed(res);
      return;
    }

    const { email, password } = await readJson(req);
    const user = users.get(email);

    if (!user || user.password !== password) {
      json(res, 401, { error: "invalid_credentials" });
      return;
    }

    json(res, 200, {
      user: publicUser(user),
      token: signToken({ sub: user.id, email: user.email })
    });
    return;
  }

  json(res, 404, { error: "not_found" });
});
