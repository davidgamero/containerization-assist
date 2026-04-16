FROM node:22-slim AS build

WORKDIR /app

COPY web/package.json web/package-lock.json ./web/
RUN cd web && npm ci

COPY web ./web
COPY src/http/stages/registry.ts ./src/http/stages/registry.ts

WORKDIR /app/web
RUN npm run build

FROM nginx:alpine

COPY --from=build /app/web/dist /usr/share/nginx/html
COPY web/nginx.conf /etc/nginx/nginx.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
