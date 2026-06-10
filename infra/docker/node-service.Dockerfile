FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY packages ./packages
COPY services ./services
COPY infra ./infra

ENV NODE_ENV=production

EXPOSE 8080 4101 4102 4103

CMD ["node", "services/api-gateway/src/index.js"]
