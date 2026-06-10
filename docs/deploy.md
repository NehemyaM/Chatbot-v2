# Online Prototype Deploy

This project is easiest to host as:

- Angular frontend on Vercel.
- One backend web service on Render that starts the API gateway plus the internal auth, chat, and OpenAI services.
- PostgreSQL on Supabase.

## 1. Supabase

1. Create a Supabase project.
2. Open SQL Editor.
3. Run `infra/database/schema.sql`.
4. Copy the database connection string.

Use the pooled connection string if Supabase gives you one for serverless-style hosting.

## 2. Render Backend

Create a Render Web Service from this GitHub repo.

Settings:

- Runtime: Node
- Build command: `npm install`
- Start command: `npm run start:backend`

Environment variables:

```text
DATABASE_URL=<your Supabase Postgres connection string>
OPENAI_API_KEY=<your OpenAI API key>
OPENAI_MODEL=gpt-4.1-mini
JWT_SECRET=<make a long random value>
```

After Render deploys, copy the backend URL, for example:

```text
https://chatbot-backend.onrender.com
```

Health check:

```text
https://chatbot-backend.onrender.com/health
```

## 3. Vercel Frontend

Before deploying the frontend, update:

```text
apps/web/public/app-config.js
```

Set it to your Render backend URL plus `/api`:

```js
window.__CHAT_API_BASE_URL__ = 'https://chatbot-backend.onrender.com/api';
```

Create a Vercel project from this GitHub repo.

Settings:

- Framework preset: Angular
- Root directory: `apps/web`
- Build command: `npm run build`
- Output directory: `dist/web/browser`

## 4. Login Accounts

Only the two seeded users can log in:

```text
nehemya@demo.local
nehemya123
```

```text
prototype@demo.local
prototype123
```

## 5. Safety Before Sharing

For a public demo, keep OpenAI billing limits enabled and do not commit `.env`.
