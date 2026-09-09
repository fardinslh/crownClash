FROM node:20-alpine AS build

WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/game-core/package.json ./packages/game-core/
COPY packages/platform/package.json ./packages/platform/
COPY apps/game/package.json ./apps/game/

RUN npm ci

COPY packages/ ./packages/
COPY apps/game/ ./apps/game/

ARG VITE_NAKAMA_HOST
ARG VITE_NAKAMA_PORT
ARG VITE_NAKAMA_SSL
ARG VITE_NAKAMA_SERVER_KEY
ENV VITE_NAKAMA_HOST=${VITE_NAKAMA_HOST}
ENV VITE_NAKAMA_PORT=${VITE_NAKAMA_PORT}
ENV VITE_NAKAMA_SSL=${VITE_NAKAMA_SSL}
ENV VITE_NAKAMA_SERVER_KEY=${VITE_NAKAMA_SERVER_KEY}

RUN npm run build

FROM nginx:alpine
COPY --from=build /app/apps/game/dist /usr/share/nginx/html
COPY apps/game/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
