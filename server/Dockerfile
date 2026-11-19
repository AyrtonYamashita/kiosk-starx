FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
COPY test ./test
RUN npx tsc -p tsconfig.json

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY migrations ./migrations
COPY reader ./reader
USER node
EXPOSE 3100
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:3100/health || exit 1
CMD ["node", "dist/src/main.js"]
