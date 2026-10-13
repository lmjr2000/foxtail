# Build the Foxtail portal as a static site.
# The portal calls the Omni Foxtail API; no backend runs here.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/portal/package.json apps/portal/
COPY packages/shared packages/shared
RUN npm ci
COPY . .
ARG VITE_OMNI_API_BASE_URL
ENV VITE_OMNI_API_BASE_URL=${VITE_OMNI_API_BASE_URL}
RUN npm run build

# Serve with a minimal static server (or copy to your preferred CDN/host).
FROM nginx:alpine
COPY --from=build /app/apps/portal/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
