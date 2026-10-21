# Graph Display

A system graph explorer. It ingests a JSON description of a software system (services, databases and queues as nodes, calls between them as edges), lets you query **routes** through it with filters, route length and set operations (union / intersection / difference), and shows the result in a React Flow UI.

Routes are directed simple paths (no node twice). Queries are written either in a **query builder** (generated from the graph's own properties) or in **Cypher**. Example: _"routes that start in a public service, pass a high-severity vulnerability and end in a datastore"_.

## Requirements

- **Docker Desktop** (Docker Engine with Compose v2), with about 4 GB of memory for the containers
- **Kubernetes** enabled in Docker Desktop (_Settings → Kubernetes_) and **kubectl**, for `deploy-example.sh`
- **bash** and **curl**, for `deploy-example.sh` (on Windows: Git Bash)
- **Node.js 24+** and **npm**, for `npm start`, `npm run dev` and `npm test` (run `npm install` once)
- **A graph JSON file** to load: the example is [`train-ticket-be.json`](train-ticket-be.json) (see [Input format](#input-format)); without one the app starts empty and graphs are uploaded from the UI
- **Free local ports**: 8090 (Kubernetes example); 8080, 3001, 7474, 7687 and 6379 (Compose); 5173 and 4000 (development)

## Ways to run it

| | Command | For |
|---|---|---|
| **Kubernetes example** | `./deploy-example.sh` | The app on the Kubernetes cluster of Docker Desktop, seeded with the example graph, on http://127.0.0.1:8090 |
| **Docker Compose** | `npm start` | Everything in plain Docker containers, seeded with the example graph, on http://127.0.0.1:8080 (`npm run start:empty` starts it without a graph) |
| **Development example** | `npm run dev:example` | Neo4j, Redis and the DAL in Docker; the other services run locally with hot reload, seeded, on http://127.0.0.1:5173 (`npm run dev` starts it empty) |

The example graph is [`train-ticket-be.json`](train-ticket-be.json). The application itself has no example built in: no file name or graph name is hard-coded in the apps, in `docker/compose.yaml`, in `tools/dev.mjs` or in `k8s/`, and no local address or port is hard-coded in `k8s/`. The example's values are set only by `deploy-example.sh` (Kubernetes) and `tools/example.mjs` (Compose and development). Without a seed the app starts empty, and you upload graphs from the UI or with `POST /graphs`.

## Kubernetes

### The example deployment

```bash
./deploy-example.sh
```

It does the following:

1. Checks that Docker is running and that the `docker-desktop` kubectl context exists. It deploys with `--context` and does not change your current context.
2. Builds the four images (`graphdisplay-dal`, `-ingest`, `-server`, `-client`). Docker Desktop's cluster runs images from the local Docker engine, so no registry is needed.
3. Writes a Kustomize overlay to `.deploy-example/` (ignored by git). The overlay takes the generic manifests of `k8s/` and adds the example's values: the example JSON as a ConfigMap mounted into the ingestion service, plus `SEED_FILE`, `SEED_NAME` and `SEED_PIN`.
4. Applies the overlay and waits until every service is ready.
5. Forwards **http://127.0.0.1:8090** to the UI and waits until the example graph is stored. It then keeps running, and restarts the port forward if it drops.
6. **On Ctrl+C (or a TERM signal) it shuts down and removes everything it created**: the Kubernetes resources (the namespace with its workloads and the Neo4j volume), the images it built and the overlay. A run that fails part-way is cleaned up the same way.

To change something, stop the script and run it again.

The script takes these settings from the environment:

| Variable | Default | |
|---|---|---|
| `EXAMPLE_GRAPH` | `train-ticket-be.json` | JSON file to seed (at most 1 MiB, the ConfigMap limit; upload larger graphs from the UI) |
| `EXAMPLE_GRAPH_NAME` | the file name without `.json` | Name the graph is stored under |
| `LOCAL_ADDRESS` / `LOCAL_PORT` | `127.0.0.1` / `8090` | Where the UI is opened (Compose uses 8080) |
| `KUBE_CONTEXT` / `NAMESPACE` | `docker-desktop` / `graphdisplay` | Where it is deployed |
| `SKIP_BUILD=1` | | Reuse images that are already built; they are kept on exit |

Example: `EXAMPLE_GRAPH=graph.json LOCAL_PORT=9000 ./deploy-example.sh`.

### Writing your own deployment

Start from `k8s/` (Kustomize). It holds only what every deployment needs: Neo4j (a StatefulSet with a volume), Redis, the DAL (2 replicas behind its Service), the ingestion service, the API server (2 replicas), the client (nginx) and an optional Ingress. Your overlay adds whatever is specific to it, the same way `deploy-example.sh` does:

- **Images**: push them to your registry and set `images:` in your `kustomization.yaml`.
- **Secrets**: replace `k8s/secret.yaml`, which holds the development Neo4j password (`NEO4J_PASSWORD`, `NEO4J_AUTH`).
- **Access**: give the Ingress a real host (`k8s/ingress.yaml` uses a placeholder), or use a port forward or a LoadBalancer Service.
- **Seed graph** (optional): mount a JSON file into the ingest pod and set `SEED_FILE` (path), `SEED_NAME` and `SEED_PIN=true` (seeded graphs never expire). Without a seed, the app starts empty and graphs are uploaded from the UI or with `POST /graphs`.
- **Addresses and ports between the services**: these are in `k8s/configmap.yaml`, which uses the variable names listed under [Configuration](#configuration). If you change a port there, change the matching Service and container ports.

See [`k8s/README.md`](k8s/README.md) for details.

## Docker Compose

```bash
npm install
npm start                  # seeded with the example graph
npm run start:empty        # the same without a graph: docker compose -f docker/compose.yaml up --build
```

Seeding is an optional override, `docker/compose.seed.yaml`, which takes the graph from the environment:

```bash
SEED_GRAPH=/absolute/path/graph.json SEED_NAME=my-graph \
  docker compose -f docker/compose.yaml -f docker/compose.seed.yaml up --build
```

`SEED_GRAPH` is the file on the host (absolute, or relative to `docker/`). `SEED_NAME` defaults to `graph`. Seeded graphs are pinned (they never expire) unless `SEED_PIN=false`. `npm start` runs this override with the example graph (through `tools/example.mjs`).

| URL | What |
|---|---|
| http://127.0.0.1:8080 | The UI (its nginx also proxies `/api/*` to the API) |
| http://127.0.0.1:3001 | The API server directly (`GET /health`, `GET /graphs`, ...) |
| http://127.0.0.1:7474 | Neo4j Browser (user `neo4j`, password `graphdisplay-dev`) |

`npm run start:detached` runs it in the background; `npm run stop` removes the containers (the Neo4j data volume stays). Compose builds every service address and port from environment values, so a `.env` file overrides them (see [`.env.example`](.env.example)). The nginx configs of the client and of the DAL load balancer are templates that nginx fills from the same values when it starts.

## Configuration

Each service reads only environment variables. If a variable is not set, the service falls back to a local default (loopback address, default port), so it can also run directly on a developer machine.

| Service | Variables |
|---|---|
| DAL (`apps/dal`) | `DAL_PORT`, `NEO4J_URI`, `NEO4J_USER`, `NEO4J_PASSWORD`, `REDIS_URL`, `CACHE_TTL_SECONDS` (graph lifetime, default one day), `EXPIRY_SWEEP_INTERVAL_SECONDS`, `NEO4J_TX_TIMEOUT_MS` |
| Ingestion (`apps/ingest`) | `INGEST_PORT`, `DAL_URL`, `MAX_UPLOAD_BYTES`, `SINK_KINDS`, `SEVERITY_SCALE`, and for seeding `SEED_FILE`, `SEED_NAME`, `SEED_PIN` |
| API server (`apps/server`) | `PORT`, `DAL_URL`, `INGEST_URL`, `INGEST_TIMEOUT_MS`, `MAX_HOPS`, `DEFAULT_LIMIT`, `MAX_UPLOAD_BYTES` |
| Client (nginx image) | `SERVER_HOST`, `API_PORT`: where `/api/*` is proxied |
| DAL load balancer (Compose only) | `DAL_HOST`, `DAL_PORT` |

Compose (`.env.example`) and Kubernetes (`k8s/configmap.yaml`) use the same names. Compose also uses `*_HOST` and the published ports `CLIENT_PORT`, `SERVER_PORT`, `NEO4J_HTTP_PORT`, `NEO4J_BOLT_PORT` and `REDIS_PORT`.

## Development

| Command | Purpose |
|---|---|
| `npm run dev` | Data tier in Docker; ingestion service, API server and Vite run locally with hot reload. Seeds `SEED_FILE` (with `SEED_NAME`, `SEED_PIN`) if set |
| `npm run dev:example` | The same, seeded with the example graph |
| `npm test` | Type-check, then **all** tests; writes `reports/test-report-<timestamp>.json` |
| `npm run test:bail` | Same, but **stops at the first failing test** and prints the reason |
| `npm run lint` / `npm run format` | ESLint (default recommended rules) / Prettier |
| `npm run gen -- --seed 1 --nodes 1000 --edges 10000 --out graph.json` | Seeded synthetic graph in the input format (`--quirks` adds string targets, a missing node, a cycle) |

Tests start their own isolated Neo4j and Redis with Testcontainers (Docker required). To reuse running services instead, set `TEST_NEO4J_URI`, `TEST_NEO4J_PASSWORD` and `TEST_REDIS_URL`.

## Using the UI

- **Whole graph** shows up to the 200 most connected nodes. A **+N** bubble is a node with hidden neighbours: click it to load them. The **hidden components** chip lists groups that are not connected to what is shown.
- **Query panel** (left, collapsible): build conditions as _position_ (first / last / any / every / no node) × _property_ × _operator_ × _value_, or switch to **Cypher**. **Add a preset** inserts ready-made rules (public entry, ends in sink, has vulnerability, severity at least, a CWE, public → vulnerable → sink). **+ Add a query to combine** adds another query, joined by **intersection** by default (routes that match both); the operator can be changed to union or difference.
- **Results**: the first route is shown; step with the arrows (← / → keys), the selector reads `1 / 30 routes`. The list shows every route with its text in the colour of its **highest vulnerability severity** (same colours as the node borders, bold; black when the route passes no vulnerable node). **Route only** shows the route alone, **Whole graph** highlights it (everything else is dimmed). A dashed ghost node `↺ b` marks a route whose last node calls back into the route.
- **Click a node** for all its properties (stays open until you click elsewhere or press Esc). In the whole-graph view this also **highlights every route leading up to that node**; clicking an **edge** highlights only the routes that end at the node it points to **and pass through that edge**. Click empty space, press Esc or use *Clear* to remove it.
- **Vulnerabilities** are shown as a glowing warm border, from light orange (low) to pinkish red (critical).
- **include sub-routes** (next to *Run query*) is off by default: a route that lies inside another route of the result is not listed. **Full graph** (next to *Collapse*) drops the query result and returns to the whole graph.
- **The query is in the address bar** and follows the editor while you type, so you can bookmark or share it. Opening such a URL restores the editor and, if it showed a result, runs it and selects the same route. **Upload JSON** adds another graph.

### Input format

```json
{
  "nodes": [{ "name": "frontend", "kind": "service", "publicExposed": true }, { "name": "db", "kind": "rds" }],
  "edges": [{ "from": "frontend", "to": ["db"] }]
}
```

`name` is required and unique (case-insensitive); `to` may be a string or a list. Nodes referenced by an edge but not defined become **incomplete** placeholders (HTTP 207). Invalid input is rejected with 401. A graph is identified by a hash of its content, so uploading the same content again returns the stored graph.

## API

`POST /graphs` (upload), `GET /graphs`, `GET /graphs/:id`, `DELETE /graphs/:id`, `GET /graphs/:id/schema`, `GET /graphs/:id/view`, `POST /graphs/:id/view/expand`, `GET /graphs/:id/nodes?id=…`, `GET /graphs/:id/edges?id=…`, `GET /graphs/:id/routes/query`. The full contract is in [`packages/api-contract/openapi.yaml`](packages/api-contract/openapi.yaml). Through the UI's nginx the API is under `/api`.

```bash
# routes of 5+ nodes that end in the database, except those that pass through travel-service
# (5 routes; add --data-urlencode "includeSubRoutes=true" to also get the routes that lie inside another one)
# (the query is the "q" parameter: the set tree as JSON, URL-encoded)
Q='{"op":"except","args":[
  {"op":"leaf","builder":{"type":"group","combinator":"and","rules":[
    {"type":"rule","position":"last","path":"name","op":"eq","value":"prod-postgresdb"},
    {"type":"length","min":5}]}},
  {"op":"leaf","text":"MATCH p = (a:Node {graphId: $g})-[:CALLS*0..6]->(b:Node {graphId: $g}) WHERE any(n IN nodes(p) WHERE n.name = '"'"'travel-service'"'"') RETURN p"}]}'
curl -G "http://127.0.0.1:8080/api/graphs/<graphId>/routes/query" \
  --data-urlencode "q=$Q" --data-urlencode "limit=1000" --data-urlencode "maxHops=50" --data-urlencode "routeMode=all"
```

Raw Cypher must be read-only, scoped with `{graphId: $g}`, and return one path or node variable. The query returns **the routes only**: `{ routes, total, truncated, warnings }`. A route lists the ids of its nodes and edges, longest first. By default a route that lies inside another returned route (the same nodes in the same order) is left out, so no route is part of another; add `includeSubRoutes=true` to get them too. The properties of nodes and edges are fetched separately by id, at most 1,000 per request: `GET /graphs/<graphId>/nodes?id=frontend&id=order-service` and `GET /graphs/<graphId>/edges?id=order-service->prod-postgresdb`.

## Architecture

```
browser ─► nginx ─► API server ─┬─► ingestion service ─┐
                                └──────────────────────┴─► DAL (load balanced replicas) ─┬─► Neo4j
                                                                                         └─► Redis
```

- `apps/server`: public API, query compilation, set operations, views and layout (elkjs)
- `apps/ingest`: parse, validate, normalise, derive properties, discover the schema, seed
- `apps/dal`: the only component that touches Neo4j and Redis: storage, cache, expiry (stateless, load balanced by nginx in Compose and by its Service in Kubernetes)
- `apps/client`: Vite + React + React Flow + styled-components
- `packages/*`: shared contracts and the replaceable query-language / engine boundary (`query-core`, `lang-cypher`, `lang-cypher-ui`, `engine-neo4j`)

Graphs expire after `CACHE_TTL_SECONDS` unless pinned; seeded graphs are pinned.

### Project layout

```
apps/<service>/src/        app.ts (wiring) · api.ts (endpoints) · types/ (data objects) · constants.ts · main.ts
apps/client/src/           pages/ · components/ (one component per file) · lib/ (pure logic) · hooks/ · types/
                           constants.ts · theme.ts (tokens built from the shared palette)
packages/api-contract/     wire types, openapi.yaml, shared constants (ports, signals) and colors.ts (every colour)
docker/                    Dockerfiles, compose.yaml, nginx config templates
k8s/                       generic Kustomize manifests
deploy-example.sh          the example Kubernetes deployment
tools/example.mjs          the example Compose / development setup (npm start, npm run dev:example)
tests/                     unit, API, DAL, ingestion and performance tests
```

## Documents

| | |
|---|---|
| [`WorkPlan.md`](WorkPlan.md) | Decisions, components and implementation status (§12 lists the differences from the plan and the performance findings) |
| [`k8s/README.md`](k8s/README.md) | The Kubernetes manifests |
| [`docs/BasePlan.md`](docs/BasePlan.md) | The requirements |
| [`docs/implementation-options.md`](docs/implementation-options.md) | Options compared before the work plan |
| [`docs/base-plan-review.md`](docs/base-plan-review.md), [`docs/json-review.md`](docs/json-review.md) | Reviews of the plan and the input file |

## Development steps

1. added a base plan document, interpreting the project requirement and elaborating on edge cases
2. utilize Opus 5.5 to analyze both the plan and the JSON document for gaps in planning.
3. expand options for implementations and establish a detailed workplan
4. implementation via Sonnet
5. high-level fixes and UI changes (query mirrored in the address bar, node/edge highlighting, vulnerability markers, GET query endpoint returning routes only)
