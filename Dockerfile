FROM node:20-slim AS base
RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

# --- API build ---
FROM base AS api-build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ src/
RUN npm run build

# --- Dashboard build ---
FROM base AS dashboard-build
WORKDIR /dashboard
COPY dashboard/package.json dashboard/package-lock.json ./
RUN npm ci
COPY dashboard/ ./
RUN npm run build

# --- API production ---
FROM node:20-slim AS api
RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=api-build /app/dist/ dist/
RUN groupadd -g 1001 vap && useradd -u 1001 -g vap -s /bin/sh vap
RUN mkdir -p /app/data && chown -R vap:vap /app
USER vap
EXPOSE 3000
CMD ["node", "dist/index.js"]

# --- Test runner ---
FROM api-build AS test
COPY test/ test/
COPY vitest.config.ts ./
CMD ["npx", "vitest", "run"]

# --- Dashboard production (static serve) ---
FROM node:20-slim AS dashboard
RUN npm install -g serve
WORKDIR /app
COPY --from=dashboard-build /dashboard/dist/ dist/
RUN groupadd -g 1001 vap && useradd -u 1001 -g vap -s /bin/sh vap
RUN chown -R vap:vap /app
USER vap
EXPOSE 5173
CMD ["serve", "dist", "-l", "5173", "-s"]
