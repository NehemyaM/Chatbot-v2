# Chat Frontend

Angular frontend for the ChatGPT-like microservices app.

## Main Files

- `src/app/chat/chat-page.component.ts` - chat screen state and user actions
- `src/app/chat/chat-api.service.ts` - streaming API client for the backend gateway
- `src/app/chat/chat-page.component.html` - chat layout
- `src/app/chat/chat-page.component.scss` - chat styling and responsive layout

## Run

From the repository root:

```bash
npm run dev:web -- --host 127.0.0.1 --port 4200
```

The frontend expects the backend gateway at:

```text
http://localhost:8080
```

## Build

From the repository root:

```bash
npm run build:web
```
