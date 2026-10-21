# server service image (WorkPlan §11.2). Runs TypeScript directly with tsx.
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
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
RUN npm ci --omit=dev -w @gd/dal -w @gd/ingest -w @gd/server
COPY tsconfig.json ./
COPY packages packages
COPY apps/server apps/server
USER node
CMD ["node_modules/.bin/tsx", "apps/server/src/main.ts"]
