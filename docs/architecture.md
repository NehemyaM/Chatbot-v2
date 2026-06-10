# ChatGPT-Like Microservices Architecture

## Current Services

```text
Angular Web App
  |
  v
API Gateway :8080
  |
  +-- Auth Service :4101
  |
  +-- Chat Service :4102
        |
        v
      OpenAI Service :4103
```

## Service Responsibilities

### API Gateway

The gateway is the public backend entry point. The Angular app should call the gateway only.

- Routes `/api/auth/*` to the auth service
- Routes `/api/chat/*` to the chat service
- Keeps frontend code independent from internal service URLs

### Auth Service

The auth service owns identity.

- Register
- Login
- Issue access tokens
- Later: password hashing, refresh tokens, OAuth, RBAC

The current implementation uses in-memory users for early architecture testing. Replace this with PostgreSQL before real use.

### Chat Service

The chat service owns conversations.

- Creates conversation IDs
- Stores conversation messages in PostgreSQL when `DATABASE_URL` is configured
- Falls back to in-memory storage when PostgreSQL is not available
- Sends AI requests to the OpenAI service
- Streams AI responses back through the gateway

Current endpoints:

- `GET /chat/conversations`
- `GET /chat/conversations/:id`
- `POST /chat/stream`

### OpenAI Service

The OpenAI service is the only service that should know the OpenAI API key.

- Calls OpenAI Responses API
- Streams model output
- Provides a mock streaming response when `OPENAI_API_KEY` is not configured
- Later: tool calling, model policy, cost tracking, safety checks

## Data Services

### PostgreSQL

PostgreSQL will store durable app data.

- Conversations
- Messages
- Users, later when authentication is added
- Usage records
- Uploaded file metadata

### Redis

Redis will store fast temporary data.

- Rate limits
- Sessions
- Streaming state
- Background job queues

## First Stable MVP Boundary

Keep these service boundaries first:

- `api-gateway`
- `auth-service`
- `chat-service`
- `openai-service`

After the first working chatbot, add:

- `file-service`
- `billing-service`
- `vector-search-service`
- `notification-service`

## Local Endpoints

When running locally:

- Gateway health: `GET http://localhost:8080/health`
- Register: `POST http://localhost:8080/api/auth/register`
- Login: `POST http://localhost:8080/api/auth/login`
- Stream chat: `POST http://localhost:8080/api/chat/stream`

Example streaming request:

```bash
curl -N http://localhost:8080/api/chat/stream \
  -H "content-type: application/json" \
  -d '{"messages":[{"role":"user","content":"Hello"}]}'
```
