# ChatGPT-Like Microservices App

This repository contains the first architecture scaffold for a ChatGPT-like app with an Angular frontend and microservices backend.

## Services

- `apps/web` - Angular frontend placeholder
- `services/api-gateway` - public backend entry point
- `services/auth-service` - login and registration boundary
- `services/chat-service` - conversation and streaming boundary
- `services/openai-service` - OpenAI API adapter
- `packages/shared` - shared backend helpers

## Run Locally

Start all backend services:

```bash
npm run dev
```

Then test:

```bash
curl http://localhost:8080/health
curl -N http://localhost:8080/api/chat/stream \
  -H "content-type: application/json" \
  -d '{"messages":[{"role":"user","content":"Hello"}]}'
```

Without `OPENAI_API_KEY`, the OpenAI service returns a mock streaming response. Add `OPENAI_API_KEY` to use the real OpenAI backend.

The chat service uses PostgreSQL when `DATABASE_URL` is set. If PostgreSQL is not available, it falls back to in-memory storage so local frontend work can continue.

## Run With Docker

```bash
docker compose up --build
```

## Environment

Copy `.env.example` to `.env` and fill in real secrets before production use.

## Architecture

See [docs/architecture.md](docs/architecture.md).
