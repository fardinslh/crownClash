FROM node:20-alpine AS build

WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/game-core/package.json ./packages/game-core/
COPY packages/platform/package.json ./packages/platform/
COPY apps/game/package.json ./apps/game/

RUN npm ci

COPY packages/ ./packages/
COPY apps/game/ ./apps/game/

ARG VITE_API_URL
ENV VITE_API_URL=${VITE_API_URL}

RUN npm run build

FROM nginx:alpine
COPY --from=build /app/apps/game/dist /usr/share/nginx/html
COPY apps/game/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
