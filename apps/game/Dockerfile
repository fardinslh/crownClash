FROM node:20-alpine AS build

WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/game-core/package.json ./packages/game-core/
COPY packages/platform/package.json ./packages/platform/
COPY apps/game/package.json ./apps/game/

ARG NPM_REGISTRY=https://registry.npmjs.org
RUN npm ci --registry=${NPM_REGISTRY} --fetch-retries=5 --fetch-timeout=120000 --fetch-retry-maxtimeout=60000

COPY packages/ ./packages/
COPY apps/game/ ./apps/game/
COPY apps/server-nakama/battlefields.json ./apps/server-nakama/battlefields.json
COPY art/asset-manifest.json ./art/asset-manifest.json
COPY art/arena-dressing-zones.json ./art/arena-dressing-zones.json
COPY art/arena-layout.json ./art/arena-layout.json

ARG VITE_NAKAMA_HOST
ARG VITE_NAKAMA_PORT
ARG VITE_NAKAMA_SSL
ARG VITE_NAKAMA_SERVER_KEY
ARG VITE_ENABLE_LANES
ENV VITE_NAKAMA_HOST=${VITE_NAKAMA_HOST}
ENV VITE_NAKAMA_PORT=${VITE_NAKAMA_PORT}
ENV VITE_NAKAMA_SSL=${VITE_NAKAMA_SSL}
ENV VITE_NAKAMA_SERVER_KEY=${VITE_NAKAMA_SERVER_KEY}
ENV VITE_ENABLE_LANES=${VITE_ENABLE_LANES}

RUN npm run build

FROM nginx:alpine
COPY --from=build /app/apps/game/dist /usr/share/nginx/html
COPY apps/game/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
