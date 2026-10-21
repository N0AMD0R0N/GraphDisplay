# client image (WorkPlan §11.2): Vite build served by nginx
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
COPY apps/dal/package.json apps/dal/
COPY apps/ingest/package.json apps/ingest/
COPY apps/server/package.json apps/server/
COPY apps/client/package.json apps/client/
COPY packages/api-contract/package.json packages/api-contract/
COPY packages/dal-contract/package.json packages/dal-contract/
COPY packages/engine-neo4j/package.json packages/engine-neo4j/
COPY packages/graph-core/package.json packages/graph-core/
COPY packages/ingest-contract/package.json packages/ingest-contract/
COPY packages/lang-cypher/package.json packages/lang-cypher/
COPY packages/lang-cypher-ui/package.json packages/lang-cypher-ui/
COPY packages/query-core/package.json packages/query-core/
COPY tools/generator/package.json tools/generator/
RUN npm ci -w @gd/client
COPY packages packages
COPY apps/client apps/client
RUN npm run build -w @gd/client

FROM nginx:1.27-alpine
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/client/dist /usr/share/nginx/html
