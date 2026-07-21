# syntax=docker/dockerfile:1

# Build the browser bundle with public Vite variables supplied by Compose or a
# deployment platform. VITE_* values are intentionally embedded in the client.
FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . ./

ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_PUBLISHABLE_KEY
ARG VITE_GOOGLE_MAPS_API_KEY
ARG VITE_GOOGLE_MAP_TILES_LANGUAGE=en-CA
ARG VITE_GOOGLE_MAP_TILES_REGION=CA

ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_PUBLISHABLE_KEY=$VITE_SUPABASE_PUBLISHABLE_KEY \
    VITE_GOOGLE_MAPS_API_KEY=$VITE_GOOGLE_MAPS_API_KEY \
    VITE_GOOGLE_MAP_TILES_LANGUAGE=$VITE_GOOGLE_MAP_TILES_LANGUAGE \
    VITE_GOOGLE_MAP_TILES_REGION=$VITE_GOOGLE_MAP_TILES_REGION

RUN npm run build

# The runtime image contains only the Express server, its dependencies, the
# compiled SPA, and the local map metadata/assets exposed through /api.
FROM node:22-bookworm-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --chown=node:node server ./server
COPY --chown=node:node src/data/map ./src/data/map
COPY --from=build --chown=node:node /app/dist ./dist

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "server/index.js"]
