import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Load local environment files so backend services pick up secrets on restart.
const initialEnvKeys = new Set(Object.keys(process.env));
const envFilePaths = [resolve(projectRoot, ".env"), resolve(projectRoot, ".env.local")];

for (const envFilePath of envFilePaths) {
  await loadEnvFile(envFilePath);
}

function parseEnvFile(contents) {
  const entries = [];

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line || line.startsWith("#")) {
      continue;
    }

    const equalsIndex = line.indexOf("=");

    if (equalsIndex === -1) {
      continue;
    }

    const key = line.slice(0, equalsIndex).trim();
    let value = line.slice(equalsIndex + 1).trim();

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    entries.push([key, value]);
  }

  return entries;
}

async function loadEnvFile(envFilePath) {
  try {
    const contents = await readFile(envFilePath, "utf8");

    for (const [key, value] of parseEnvFile(contents)) {
      if (initialEnvKeys.has(key)) {
        continue;
      }

      process.env[key] = value;
    }
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
}

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
