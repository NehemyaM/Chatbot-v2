import dotenv from "dotenv";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Load local environment files so backend services pick up secrets on restart.
dotenv.config({ path: resolve(projectRoot, ".env") });
dotenv.config({ path: resolve(projectRoot, ".env.local"), override: true });

// Start all backend services together during local development.
const services = [
  ["openai-service", "services/openai-service/src/index.js"],
  ["auth-service", "services/auth-service/src/index.js"],
  ["chat-service", "services/chat-service/src/index.js"],
  ["api-gateway", "services/api-gateway/src/index.js"]
];

const children = [];

for (const [name, script] of services) {
  const child = spawn("node", [script], {
    stdio: "inherit",
    env: {
      ...process.env,
      NODE_ENV: process.env.NODE_ENV || "development"
    }
  });

  children.push(child);

  child.on("exit", (code) => {
    console.log(`${name} exited with code ${code}`);
  });
}

// Stop child services when the parent dev process is stopped.
process.on("SIGINT", () => {
  for (const child of children) {
    child.kill("SIGINT");
  }

  process.exit(0);
});
