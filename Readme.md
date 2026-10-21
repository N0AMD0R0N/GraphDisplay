# Graph Display

A system graph explorer. It ingests a JSON description of a software system (services, databases and queues as nodes, calls between them as edges), lets you query **routes** through it with filters, route length and set operations (union / intersection / difference), and shows the result in a React Flow UI.

Routes are directed simple paths (no node twice). Queries are written either in a **query builder** (generated from the graph's own properties) or in **Cypher**. Example: _"routes that start in a public service, pass a high-severity vulnerability and end in a datastore"_.

## Quick start

Requirements: Node 24+, Docker (Desktop).

```bash
npm install
npm start            # builds and starts everything, seeds train-ticket-be.json
```

Then open **http://127.0.0.1:8080**.

| URL | What |
|---|---|
| http://127.0.0.1:8080 | The UI (its nginx also proxies `/api/*` to the API) |
| http://127.0.0.1:3001 | The API server directly (`GET /health`, `GET /graphs`, ...) |
| http://127.0.0.1:7474 | Neo4j Browser (user `neo4j`, password `graphdisplay-dev`) |

`npm run stop` removes the containers (the Neo4j data volume stays). All settings can be overridden in a `.env` file, see `.env.example`.

## Scripts

| Command | Purpose |
|---|---|
| `npm start` | `docker compose up --build`: Neo4j, Redis, 2 DAL replicas + load balancer, ingestion service, API server, UI |
| `npm run start:detached` / `npm run stop` | Same in the background / stop everything |
| `npm run dev` | Data tier in Docker; ingestion service, API server and Vite run locally with hot reload (UI on http://127.0.0.1:5173) |
| `npm test` | Type-check, then **all** tests; writes `reports/test-report-<timestamp>.json` |
| `npm run test:bail` | Same, but **stops at the first failing test** and prints the reason |
| `npm run lint` / `npm run format` | ESLint (default recommended rules) / Prettier |
| `npm run gen -- --seed 1 --nodes 1000 --edges 10000 --out graph.json` | Seeded synthetic graph in the input format (`--quirks` adds string targets, a missing node, a cycle) |

Tests start their own isolated Neo4j and Redis with Testcontainers (Docker required). To reuse running services instead, set `TEST_NEO4J_URI`, `TEST_NEO4J_PASSWORD` and `TEST_REDIS_URL`.

## Using the UI

- **Whole graph** shows up to the 200 most connected nodes. A **+N** bubble is a node with hidden neighbours: click it to load them. The **hidden components** chip lists groups that are not connected to what is shown.
- **Query panel** (left, collapsible): build conditions as _position_ (first / last / any / every / no node) × _property_ × _operator_ × _value_, or switch to **Cypher**. **Add a preset** inserts ready-made rules (public entry, ends in sink, has vulnerability, severity at least, a CWE, public → vulnerable → sink). **+ Add a query to combine** adds a second query joined by union, intersection or difference.
- **Results**: the first route is shown; step with the arrows (← / → keys) or open the list. **Route only** shows the route alone, **Whole graph** highlights it (everything else is dimmed). A dashed ghost node `↺ b` marks a route whose last node calls back into the route.
- **Click a node** for all its properties (stays open until you click elsewhere or press Esc). **Upload JSON** adds another graph.

### Input format

```json
{
  "nodes": [{ "name": "frontend", "kind": "service", "publicExposed": true }, { "name": "db", "kind": "rds" }],
  "edges": [{ "from": "frontend", "to": ["db"] }]
}
```

`name` is required and unique (case-insensitive); `to` may be a string or a list. Nodes referenced by an edge but not defined become **incomplete** placeholders (HTTP 207). Invalid input is rejected with 401.

## API

`POST /graphs` (upload), `GET /graphs`, `GET /graphs/:id`, `DELETE /graphs/:id`, `GET /graphs/:id/schema`, `GET /graphs/:id/view`, `POST /graphs/:id/view/expand`, `POST /graphs/:id/routes/query`. The full contract is in [`packages/api-contract/openapi.yaml`](packages/api-contract/openapi.yaml).

```bash
# routes of 5+ nodes that end in the database, except those that pass through travel-service
curl -X POST http://127.0.0.1:8080/api/graphs/<graphId>/routes/query -H 'content-type: application/json' -d '{
  "query": { "op": "except", "args": [
    { "op": "leaf", "builder": { "type": "group", "combinator": "and", "rules": [
        { "type": "rule", "position": "last", "path": "name", "op": "eq", "value": "prod-postgresdb" },
        { "type": "length", "min": 5 } ] } },
    { "op": "leaf", "text": "MATCH p = (a:Node {graphId: $g})-[:CALLS*0..6]->(b:Node {graphId: $g}) WHERE any(n IN nodes(p) WHERE n.name = 'travel-service') RETURN p" }
  ] },
  "limit": 1000, "maxHops": 50, "routeMode": "all"
}'
```

Raw Cypher must be read-only, scoped with `{graphId: $g}`, and return one path or node variable. Results are `Route` objects (ordered node and edge ids; nodes and edges carry all original properties), longest first, with `total`, `truncated` and `warnings`.

## Architecture

```
browser ─► nginx ─► API server ─┬─► ingestion service ─┐
                                └──────────────────────┴─► DAL load balancer ─► DAL replicas ─┬─► Neo4j
                                                                                               └─► Redis
```

- `apps/server` public API, query compilation, set operations, views and layout (elkjs)
- `apps/ingest` parse, validate, normalise, derive properties, discover the schema, seed
- `apps/dal` the only component that touches Neo4j and Redis: storage, cache, expiry (stateless, load balanced)
- `apps/client` Vite + React + React Flow + styled-components
- `packages/*` shared contracts and the replaceable query-language / engine boundary (`query-core`, `lang-cypher`, `lang-cypher-ui`, `engine-neo4j`)

Graphs expire after `CACHE_TTL_SECONDS` (default one day) unless pinned; the seeded graph is pinned.

## Documents

| | |
|---|---|
| [`WorkPlan.md`](WorkPlan.md) | Decisions, components and implementation status (§12 lists the differences from the plan and the performance findings) |
| [`docs/BasePlan.md`](docs/BasePlan.md) | The requirements |
| [`docs/implementation-options.md`](docs/implementation-options.md) | Options compared before the work plan |
| [`docs/base-plan-review.md`](docs/base-plan-review.md), [`docs/json-review.md`](docs/json-review.md) | Reviews of the plan and the input file |

## Development steps

1. added a base plan document, interpreting the project requirement and elaborating on edge cases
2. utilize Opus 5.5 to analyze both the plan and the JSON document for gaps in planning.
3. expand options for implementations and establish a detailed workplan
4. implementation via Sonnet
