# Production image, built from the main branch by CI/CD (never by copying files onto a server).
# Contains the API and the built portal; the API serves both. ffmpeg/ffprobe are needed for direct
# recorder connections (RTSP picture capture and the "Test connection" button).
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/portal/package.json apps/portal/
COPY apps/edge-agent/package.json apps/edge-agent/
COPY packages/shared packages/shared
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production PORT=3001
WORKDIR /app
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/package.json ./
COPY --from=build /app/packages/shared/package.json packages/shared/
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/apps/api/package.json apps/api/
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/api/migrations apps/api/migrations
COPY --from=build /app/apps/portal/dist apps/portal/dist
USER node
EXPOSE 3001
CMD ["node", "apps/api/dist/index.js"]
