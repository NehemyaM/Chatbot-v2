import { spawn } from "node:child_process";

const gatewayPort = process.env.PORT || process.env.GATEWAY_PORT || "8080";

const services = [
  {
    name: "openai-service",
    script: "services/openai-service/src/index.js",
    env: {
      OPENAI_SERVICE_PORT: process.env.OPENAI_SERVICE_PORT || "4103"
    }
  },
  {
    name: "auth-service",
    script: "services/auth-service/src/index.js",
    env: {
      AUTH_SERVICE_PORT: process.env.AUTH_SERVICE_PORT || "4101"
    }
  },
  {
    name: "chat-service",
    script: "services/chat-service/src/index.js",
    env: {
      CHAT_SERVICE_PORT: process.env.CHAT_SERVICE_PORT || "4102",
      OPENAI_SERVICE_URL: process.env.OPENAI_SERVICE_URL || "http://127.0.0.1:4103"
    }
  },
  {
    name: "textbook-service",
    script: "services/textbook-service/src/index.js",
    env: {
      TEXTBOOK_SERVICE_PORT: process.env.TEXTBOOK_SERVICE_PORT || "4104"
    }
  },
  {
    name: "api-gateway",
    script: "services/api-gateway/src/index.js",
    env: {
      GATEWAY_PORT: gatewayPort,
      AUTH_SERVICE_URL: process.env.AUTH_SERVICE_URL || "http://127.0.0.1:4101",
      CHAT_SERVICE_URL: process.env.CHAT_SERVICE_URL || "http://127.0.0.1:4102",
      TEXTBOOK_SERVICE_URL: process.env.TEXTBOOK_SERVICE_URL || "http://127.0.0.1:4104"
    }
  }
];

const children = services.map((service) => {
  const child = spawn("node", [service.script], {
    stdio: "inherit",
    env: {
      ...process.env,
      NODE_ENV: "production",
      ...service.env
    }
  });

  child.on("exit", (code) => {
    console.log(`${service.name} exited with code ${code}`);
  });

  return child;
});

function stopChildren(signal) {
  for (const child of children) {
    child.kill(signal);
  }
}

process.on("SIGINT", () => {
  stopChildren("SIGINT");
  process.exit(0);
});

process.on("SIGTERM", () => {
  stopChildren("SIGTERM");
  process.exit(0);
});
