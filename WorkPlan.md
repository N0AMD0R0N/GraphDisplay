# Work Plan: System Graph Explorer

| | |
|---|---|
| **Status** | Draft for approval |
| **Inputs** | [`BasePlan.md`](docs/BasePlan.md) (requirements), [`implementation-options.md`](docs/implementation-options.md) (option analysis), [`json-review.md`](docs/json-review.md) (input data analysis) |
| **Sample data** | [`train-ticket-be.json`](train-ticket-be.json) |

### Status legend

| Label | Meaning |
|---|---|
| **Decided** | Chosen by the project owner |
| **Proposed** | Default derived from the decided items and the base plan; applies unless changed |
| **Open** | Can't be inferred; needs a manual decision. None remain; resolved items are listed in [§9](#9-resolved-decisions). |

---

## 1. Scope

Build a web application that ingests a JSON graph describing a software system (services, databases, queues → nodes; calls → directed edges). It exposes a REST API for **route queries**: property filters, route length, and union/intersection/difference. A React UI renders the graph and lets the user browse the matching routes.

Out of scope for this iteration: authentication, CORS, API versioning, dark theme, connecting segmented graphs (the API reserves room for it, but it isn't implemented).

---

## 2. Architecture

```
┌─────────────────────────── client (Vite · React 19) ───────────────────────────┐
│  Query drawer ── lang-cypher-ui (builder formatter, editor)                      │
│  Graph canvas ── @xyflow/react · styled-components                               │
│  TanStack Query (server state) · Zustand (UI state) · generated API client      │
└──────────────────────────────────────┬──────────────────────────────────────────┘
                                       │ REST / JSON (OpenAPI contract)
┌──────────────────────────────────────▼──────────────────────────────────────────┐
│ server (Node 24 LTS · Fastify)                     no direct DB/cache connections │
│  graphs ── forwards uploads to the ingestion service (status + body passed through)│
│  query  ── query-core (set tree, limits) → lang-cypher (compile/wrap)            │
│  view   ── degree ranking · 200-node cap · stubs · elkjs layout                  │
│  ingest-client · dal-client ── typed clients for the internal contracts          │
└──────────────┬──────────────────────────────────────────────┬───────────────────┘
               │ internal REST (ingest contract)               │ internal REST (DAL contract)
┌──────────────▼───────────────────────────┐                   │
│ ingest (Node 24 LTS · Fastify)           │                   │
│  graph-core: parse · validate · normalise│                   │
│  placeholders · cycles · degree          │                   │
│  schema discovery · new-kind registration│                   │
│  seeder (boot) · artefact rebuild        │                   │
└──────────────┬───────────────────────────┘                   │
               │ internal REST (DAL contract)                  │
               └──────────────────────┬────────────────────────┘
                          ┌───────────▼────────────────┐
                          │ dal-lb (nginx, round-robin) │
                          └──────┬─────────────┬────────┘
                    ┌────────────▼───┐   ┌─────▼──────────┐
                    │ dal replica 1  │ … │ dal replica N  │   stateless, Node 24 · Fastify
                    │ storage · cache · expiry (GraphEngine = engine-neo4j) │
                    └───────┬────────┘   └──────┬─────────┘
                            │ Bolt (neo4j-driver)│ RESP
                    ┌───────▼────────┐   ┌──────▼────────┐
                    │ Neo4j Community│   │ Redis         │
                    └────────────────┘   └───────────────┘
   All services run under Docker Compose. Only client, server and (dev) ingest, dal-lb,
   Neo4j Browser and Redis ports are published, and only on localhost.
```

### 2.0 Responsibility split

| Tier | Owns | Does not do |
|---|---|---|
| **server** | Public HTTP API for the UI; forwarding uploads to ingest; query compilation (lang-*) and set-op combining; views and layout | Parse input JSON; open connections to Neo4j or Redis |
| **ingest** | Turning raw input JSON into a stored graph: parsing, validation, normalisation, placeholders, cycle detection, degree (graph-core); schema discovery; registering new kinds for colours; seeding on boot; rebuilding derived ingest artefacts (schema) when they were evicted | Serve the UI; run user queries; compute layouts; open connections to Neo4j or Redis |
| **DAL** | **Every** read, write and delete against Neo4j and Redis; cache read-through/write-through; graph and cache expiry; colour assignment | Parse input JSON, compile queries, compute layouts |
| **Neo4j / Redis** | Persistence / cache | — |

### 2.1 Repository layout (npm workspaces)

```
/apps
  /server            Fastify app, public routes, query/view/layout logic, ingest and DAL clients
  /ingest            Ingestion service: parse, validate, normalise, schema discovery, seeding
  /dal               Data Access Layer service: storage, cache, expiry (load-balanced replicas)
  /client            Vite + React app
/packages
  /api-contract      openapi.yaml (source of truth) + generated types, Valibot schemas, client
  /ingest-contract   ingest.openapi.yaml (internal server↔ingest contract) + generated types and client
  /dal-contract      dal.openapi.yaml (internal server/ingest↔DAL contract) + generated types and client
  /graph-core        input parsing, normalisation, validation, cycle detection (isomorphic)
  /query-core        language-agnostic query model: set tree, conditions, Route, limits, interfaces
  /lang-cypher       Cypher implementation of QueryLanguage (compile builder tree, wrap raw query)
  /lang-cypher-ui    React: Cypher editor + react-querybuilder formatter
  /engine-neo4j      Neo4j implementation of GraphEngine (ingest, run, delete)
/tests               unit · api · perf · fixtures · reporter (single Jest entry point)
/tools/generator     seeded synthetic graph generator
/docker              Dockerfiles, compose file, seed config
```

### 2.2 Replaceable query-language boundary (Decided intent, Proposed design)

The query language and the engine can be swapped without touching the server routes or the UI shell. Only `lang-*` and `engine-*` packages know about Cypher or Neo4j. The server compiles queries with a `QueryLanguage`. The **DAL** executes the resulting `NativeQuery` through its `GraphEngine`, so replacing Neo4j only affects the DAL and the matching `lang-*` package.

```ts
// packages/query-core
interface QueryLanguage {
  id: string;                                         // "cypher"
  compile(tree: ConditionTree, ctx: CompileContext): NativeQuery;  // builder → native
  prepare(raw: string, ctx: CompileContext): NativeQuery;          // validate + wrap raw text
}
interface GraphEngine {
  ingest(graph: NormalizedGraph): Promise<void>;
  run(query: NativeQuery, limits: QueryLimits): Promise<RouteRow[]>;
  delete(graphId: string): Promise<void>;
}
interface CompileContext { graphId: string; maxHops: number; limit: number; schema: GraphSchema }

// packages/lang-cypher-ui (client side of the same boundary)
interface QueryLanguageUI {
  id: string;
  Editor: React.ComponentType<EditorProps>;            // raw query editor
  formatBuilderTree(tree: ConditionTree): string;      // builder → raw text (one-way export)
}
```

API requests name the language explicitly: `{ "language": "cypher", "text": "…" }`. That lets another language be added later without breaking the endpoint.

---

## 3. Backend decisions

| ID | Area | Decision | Notes | Status |
|---|---|---|---|---|
| A1 | Repository | npm workspaces (layout in §2.1) | — | Decided |
| A1.1 | Contract style | **OpenAPI-first**: `packages/api-contract/openapi.yaml` is the single source of truth | TS types, Valibot schemas and the typed fetch client are **generated** (e.g. `@hey-api/openapi-ts` with its Valibot plugin; check plugin maturity at setup). Generated code is committed and regenerated by `npm run contract:gen`. | Decided / Proposed tooling |
| A2 | HTTP framework | Fastify | Routes are bound to OpenAPI `operationId`s (e.g. `fastify-openapi-glue`). Request validation uses Fastify's built-in Ajv against the same OpenAPI JSON Schemas. | Decided / Proposed binding |
| A3 | Graph store | Neo4j Community + `neo4j-driver`, behind `GraphEngine` (§2.2), accessed only through the DAL (A13) | One user database (Community): graphs are namespaced by a `graphId` property. Constraint `(graphId, name)` is unique. Indexes on `kind`, `publicExposed`, `_isSink`, `` `vulnerabilities._count` `` and `` `vulnerabilities._maxSeverityRank` `` (the anchor candidates of A4.6). | Decided |
| A3.1 | Property storage | Flatten scalars; node properties are **never** modelled as separate nodes | Rules in §3.1 | Decided / Proposed rules |
| A3.2 | Derived properties | The ingestion service adds derived, queryable properties to every node: `_isSink`, `_isTerminal`, `_degree`, `` `vulnerabilities._maxSeverityRank` `` (§3.1.1) | Make common filters simple, fast and independent of raw string formats | Proposed |
| A3.3 | Sink definition | A **sink** is a node whose `kind` is in the configurable list `SINK_KINDS` (default `rds,sqs`). This is separate from a **terminal** node (no outgoing edges), which is exposed as `_isTerminal`. Placeholder (`unknown`) nodes are never sinks. | "Sink" means datastore. Adding a new datastore kind is a config change, not a query change. | Proposed |
| A3.4 | Severity scale | Ordinal map `SEVERITY_SCALE` (default `info=0, low=1, medium=2, high=3, critical=4`). An unknown severity value gets no rank and produces an ingest warning. | Enables "severity ≥ X" comparisons | Proposed |
| A3.5 | Correlated nested-property queries | **Limitation accepted for this iteration:** rules on array-of-object fields (e.g. `vulnerabilities.*`) are evaluated per field, so they can't be tied to *the same* element. "High **and** CWE-89" means "has a high vulnerability and has a CWE-89 vulnerability". A future iteration may change the querying mechanism (the replaceable language/engine boundary, §2.2, allows it). | Consequence of A3.1 (properties aren't stored as nodes). See §9-3. | Decided |
| A4 | Route queries | Builder-generated Cypher plus a server-side wrapper that enforces `graphId`, hop limit and `LIMIT` on raw queries | Default `maxHops = 50`. Per-request `limit` override is allowed (see A4.1). | Decided |
| A4.1 | Limits | Default `limit` (routes) = **1,000**; request override up to **10,000**. `maxHops` override up to **100**. Neo4j transaction timeout **5 s** → `504` with a message. | Values guard memory and payload size (§3.2). Configurable through env. | Proposed |
| A4.2 | Raw query contract | Raw queries must return **one column** whose rows are a **path** or a **single node** (= a single-node route). Anything else → `422` with an explanation. Write clauses are rejected; the query runs in a read transaction (`executeRead`). | Single nodes map to length-1 routes | Decided / Proposed details |
| A4.3 | Route sorting | Longest first; ties broken by the route's node names in order (lexicographic) | Deterministic order for the static tests | Proposed |
| A4.4 | Cycle marker | `closesTo` = the node in the route that the last node points back to. This applies to **any** node in the route, not only the first. | Generalises the base-plan rule (`A→B→C→D→A`) to `…D→B` | Proposed |
| A4.6 | Query anchoring | `lang-cypher` builds each path pattern around its **most selective rule**, so Neo4j starts expanding from an indexed set of nodes instead of enumerating every path: a `first` rule anchors the start node, a `last` rule anchors the end node, and when only `any` rules exist the pattern goes through an anchor node `(a)-[*0..h]->(v)-[*0..h]->(b)` with `RETURN DISTINCT p`. Selectivity is estimated from the value counts in the stored schema. | Keeps rules like "has a vulnerability" in the standard-query range (§3.9) | Proposed |
| A4.7 | Value normalisation | String values in builder rules and in raw-query parameters are trimmed and lower-cased before comparison, matching the stored queryable copies (§3.1). Raw Cypher **literals** aren't rewritten; the editor shows a lint hint when a string literal contains upper-case letters. | Without this, searching `CWE-89` finds nothing | Proposed |
| A4.8 | Sub-routes | By default a route that **lies inside another route of the result** (the same nodes in the same order, as a contiguous part, so the same edges) is **left out**: no returned route is part of another. `includeSubRoutes=true` (query parameter; `sub=1` in the UI's URL, a checkbox in the panel) returns them too. The comparison is among the routes of the result (a route stays when no route of the result contains it) and runs after the set operations. | The search therefore looks further than `limit`: it collects up to the API ceiling (10,000 routes, longest first), removes the sub-routes, and `limit` applies to what is left. If the search itself stopped at the ceiling the result is flagged `truncated` with an explanatory warning. See §12.3 for the cost. | Decided (requested after the first delivery) |
| A4.5 | Route mode | The set of routes **searched**: **all sub-paths**: every simple path, including each prefix and suffix of longer routes. What is returned by default is narrowed by A4.8 | Many more results than maximal routes; combine a start rule with an end rule (sink or terminal) for full routes (§3.9). See §9-1. | Decided |
| A5 | Set operations | API-level set tree `{op: union\|intersect\|except, args: [...]}`; leaves are builder trees or raw queries. Leaves run concurrently; results are combined by canonical route key (ordered node ids). | If a leaf was truncated, the result carries a `warnings` entry because the set result is approximate | Decided |
| A5.1 | Query size | "Condition" = one builder leaf rule. Standard ≤ 20, heavy ≤ 70 (base plan). Hard cap 200 leaves → `422`. | Protects the server from extreme payloads | Proposed |
| A6 | Ingestion validation | Valibot (generated from OpenAPI) for structure, plus semantic checks in `graph-core`. Runs in the **ingestion service** (A14). | Pipeline in §3.3 | Decided |
| A6.1 | HTTP outcomes for upload | Valid → `201`. Derivable missing data → `207` with per-issue `422` entries and messages. Invalid format → `401` (per base plan). | `401` normally means "unauthenticated" and some clients treat it as a login prompt. Kept as specified. | Decided |
| A7 | Cache | Redis | Accessed only through the DAL (A13). Contents and TTLs in §3.4. If Redis is unavailable, the DAL degrades to no-cache (cache reads return a miss, writes are skipped) and logs a warning; it doesn't fail requests. | Decided / Proposed behaviour |
| A7.1 | Graph lifetime | When the TTL (default 1 day) expires, the **graph itself is deleted**: its Neo4j data and all its Redis keys. Done by the DAL expiry sweeper (A13.3, §3.7); a pinned seed graph is exempt (`SEED_PIN`). | See §9-2 | Decided |
| A8 | Kind colours | Fixed map for known kinds, plus a deterministic hash into a palette for unseen kinds, with a distinctness check | Algorithm in §3.5 | Decided / Proposed algorithm |
| A9 | Endpoints | See §3.6 | | Proposed |
| A10 | Configuration | All connection settings and limits come from env vars, with `.env.example` committed. **Server:** `PORT`, `DAL_URL`, `INGEST_URL`, `MAX_HOPS`, `DEFAULT_LIMIT`, `MAX_UPLOAD_BYTES`. **Ingest:** `INGEST_PORT`, `DAL_URL`, `SEED_FILE`, `SEED_PIN`, `MAX_UPLOAD_BYTES`, `INGEST_TIMEOUT_MS`, `SINK_KINDS`, `SEVERITY_SCALE`. **DAL:** `DAL_PORT`, `NEO4J_URI`, `NEO4J_USER`, `NEO4J_PASSWORD`, `REDIS_URL`, `CACHE_TTL_SECONDS`, `EXPIRY_SWEEP_INTERVAL_SECONDS`, `NEO4J_TX_TIMEOUT_MS`. **Compose:** `DAL_REPLICAS`. | Lets services move between containers and hosts without code changes | Proposed |
| A11 | Seeding | On boot, if `SEED_FILE` is set, the **ingestion service** ingests it (once the DAL is healthy). `graphId` = a content hash of the normalised graph, so a restart re-uses the same graph instead of duplicating it. | `npm start` seeds `train-ticket-be.json` | Proposed |
| A12 | Graph naming | `POST /graphs?name=<label>` (optional); default label = `graphId` prefix | The input JSON has no name field, but the UI graph picker needs a label | Proposed |
| A13 | Data Access Layer | A separate **DAL service** (`apps/dal`) is the only component that talks to Neo4j and Redis. It handles storing, pulling (read-through cache) and deleting graphs and cache entries, and runs expiry for both stores. | Design in §3.7 | Decided |
| A13.1 | DAL load balancing | N stateless DAL replicas (`DAL_REPLICAS`, default 2) behind an nginx round-robin load balancer (`dal-lb`). The server calls only `dal-lb`. | Scales the access tier. Neo4j Community and Redis remain single instances (see §10). | Decided / Proposed mechanism |
| A13.2 | Server ↔ DAL protocol | Internal REST/JSON defined OpenAPI-first in `dal-contract` (same tooling as A1.1) | Consistent with the public API approach. gRPC was considered but adds a second contract toolchain. | Proposed |
| A13.3 | Expiry coordination | Only one replica sweeps at a time: Redis lock `lock:expiry` (`SET NX PX`, lease = 2 × sweep interval, renewed while running). Deletes are idempotent, so a crashed sweep is safely retried by any replica. | Avoids duplicate sweeps across replicas | Proposed |
| A14 | Ingestion service | A separate **ingestion service** (`apps/ingest`) owns turning raw input JSON into a stored graph: the full §3.3 pipeline, schema discovery, new-kind registration and seeding. It stores everything through the DAL and has no database connections of its own. | Design in §3.8 | Decided |
| A14.1 | Upload flow | The public `POST /graphs` stays on the API server (single public API, single origin). The server streams the body to `POST /ingest/graphs` and returns the ingest service's status code and body unchanged (`201` / `207` / `401`). | The UI and the public contract are unchanged | Proposed |
| A14.2 | Sync vs async | **Synchronous** for this iteration: the upload request waits for ingestion to finish, so the `201`/`207`/`401` outcome can be returned directly (A6.1). An async job mode (`202` + status polling) is reserved in the ingest contract for very large or segmented graphs. | At 1k/10k scale ingestion takes seconds, not minutes | Proposed |
| A14.3 | Scaling | One instance by default. The service is stateless, so it can be scaled with `INGEST_REPLICAS` behind the same pattern as `dal-lb` later. Concurrent uploads of the same graph are safe because the content-hash `graphId` makes the DAL store idempotent. | Not load-balanced now (not requested); ready for it | Proposed |
| A14.4 | Artefact rebuild | If the schema artefact is missing from Redis while the graph still exists (e.g. after a Redis restart), the server calls `POST /ingest/graphs/:graphId/rebuild`. The ingestion service pulls the graph from the DAL, re-runs schema discovery and stores the result. Layouts and views are rebuilt by the server itself. | Keeps every artefact recoverable without re-uploading | Proposed |

### 3.1 Property flattening rules (Proposed)

Neo4j properties can't hold maps or lists of maps. Rules:

| Input shape | Stored as | Example |
|---|---|---|
| Scalar | Same key | `kind: "rds"` |
| Nested object | Dot-path keys (queried with backticks) | `` `metadata.cloud`: "aws" `` |
| Array of scalars | List property | `tags: ["a","b"]` |
| Array of objects | One list per field (parallel lists) + `<key>._count` | `` `vulnerabilities.severity`: ["high","medium"] ``, `` `vulnerabilities._count`: 2 `` |
| Nested object inside an array of objects | The dot-path continues through the nested object; still one parallel list per leaf field | `` `vulnerabilities.metadata.cwe`: ["cwe-22: improper limitation …", …] `` |
| Whole original node | `_raw` (JSON string, returned unchanged in results) | — |

- **String normalisation:** every string is trimmed (including trailing `\n`). **Queryable copies** are lower-cased. The original casing is kept in `_raw`, which satisfies both "uniform strings" and "keep all original properties". Query values are normalised the same way (A4.7).
- **Missing property ≠ false.** Builder operators include `exists` / `not exists`.
- **Consequence:** parallel lists can't express "*the same* vulnerability is high **and** CWE-89". They answer "has a high vulnerability **and** has a CWE-89 vulnerability". See §9-3.
- The discovered property paths, types and observed values (with counts) are published by `GET /graphs/:id/schema` and drive the query builder. The schema also publishes the `SINK_KINDS` list and the `SEVERITY_SCALE`.

### 3.1.1 Derived properties (Proposed)

Computed by the ingestion service (§3.3 step 5) and stored on every node. Derived names start with `_` so they can't clash with input properties.

| Property | Type | Definition | Used by |
|---|---|---|---|
| `_isSink` | boolean | `kind ∈ SINK_KINDS` (A3.3) | "Ends in a sink" filter |
| `_isTerminal` | boolean | No outgoing edges | Maximal-route filters, topological "end" |
| `_degree` | integer | In-degree + out-degree | View ranking (200-node cap) |
| `` `vulnerabilities._maxSeverityRank` `` | integer or absent | Highest `SEVERITY_SCALE` rank among the node's vulnerabilities; absent when the node has none | "Severity ≥ X" filter |

### 3.2 Result payload (Proposed, revised)

A query returns the **routes only**: lists of node and edge ids, plus how complete the list is. The nodes and edges themselves are not part of it, so external services receive just the routes; whoever needs their properties asks for them by id (`GET /graphs/:id/nodes?id=…`, `GET /graphs/:id/edges?id=…`, at most 1,000 ids per request, repeat the `id` parameter). The UI draws a route from its ids and fetches the node details (names, kinds, vulnerabilities) once per result, in chunks.

```ts
interface QueryResult {
  routes: Route[];                       // sorted per A4.3, no route inside another unless includeSubRoutes (A4.8)
  total: number | null;                  // null when unknown due to truncation
  truncated: boolean;
  warnings: Warning[];
}
interface Route {
  id: string;                            // canonical key (hash of ordered node ids)
  nodeIds: NodeId[];                     // ordered, length ≥ 1
  edgeIds: EdgeId[];                     // length = nodeIds.length - 1, each "from->to"
  length: number;                        // node count
  closesTo?: NodeId;                     // cycle marker target (A4.4)
}
// GET /graphs/:id/nodes?id=a&id=b  ->  GraphNode[]  (all original properties + id, incomplete flag; request order)
// GET /graphs/:id/edges?id=a->b    ->  GraphEdge[]  (normalised { id, from, to, ...props })
```

### 3.3 Ingestion pipeline (Proposed)

All steps run in the **ingestion service** (A14).

1. Parse the JSON. A syntax error → `401` (A6.1).
2. Structural validation (Valibot): `nodes[].name` required; `edges[].from` required; `edges[].to: string | string[]`.
3. Normalise: trim strings, coerce `to` to an array, assign ids (`nodeId` = name, `edgeId` = `from->to`).
4. Semantic checks:
   - duplicate node name → `401` (error);
   - duplicate edge → deduplicate, with a warning;
   - edge to an undefined node → create a placeholder node (`kind: "unknown"`, `incomplete: true`), reported as a `207` / `422` entry;
   - cycles (Tarjan SCC) → listed in the warnings.
5. Compute the derived properties (§3.1.1): `_degree`, `_isTerminal`, `_isSink`, `` `vulnerabilities._maxSeverityRank` `` (an unknown severity value → warning).
6. Send the normalised graph, with its derived properties, to the DAL (`PUT /dal/graphs/:graphId`). The DAL writes it to Neo4j in one transaction (batched `UNWIND`) and sets `expiresAt`.
7. Discover the property schema (§3.1) and store it through the DAL cache endpoints. Register any new kinds with the DAL so they receive colours (§3.5).
8. Return `201` or `207` (with the `422` entries) to the caller. The full-graph layout isn't computed here: the server computes it on the first view request and caches it through the DAL (B5).

### 3.4 Redis contents (Proposed)

| Key | Content | TTL |
|---|---|---|
| `colors:kinds` | Global kind → colour map (append-only) | none (must stay uniform across UI instances) |
| `graph:{id}:meta` | Name, status, warnings, counts | `CACHE_TTL_SECONDS` (default 86,400) |
| `graph:{id}:schema` | Property paths, types, values | same |
| `graph:{id}:layout:{viewKey}` | elkjs positions per view | same |
| `graph:{id}:view:{viewKey}` | Ranked 200-node view + stubs | same |
| `graph:{id}:q:{hash}` | Query results (hash of normalised request) | same |
| `graph:{id}:keys` | Set of all cache keys belonging to the graph (lets the DAL delete them without `SCAN`) | same |
| `lock:expiry` | Expiry-sweeper lease held by one DAL replica (A13.3) | lease (PX) |

All keys are read and written only by the DAL.

### 3.5 Colour assignment (Proposed algorithm)

- **Reserved colours:** `unknown`/incomplete (grey), the dim overlay, the highlight accent, the ghost marker. These are never assigned to a kind.
- **Fixed kinds:** `service`, `rds`, `sqs` (plus `unknown`, reserved).
- **New kind:** hash(kind) → start hue. Probe forward in 10° steps until the **circular hue distance** `min(|h₁−h₂|, 360−|h₁−h₂|)` is **≥ 30°** from every assigned and reserved hue. Saturation and lightness are fixed.
- **When all 12 hue slots are used:** second ring at a different lightness. Distinctness is then checked on the (hue, lightness) pair.
- The result is persisted in `colors:kinds`, so the first assignment wins everywhere.

### 3.6 Endpoints (Proposed)

| Method & path | Purpose |
|---|---|
| `POST /graphs?name=` | Upload a graph → `201` / `207` / `401` (A6.1). Forwarded to the ingestion service (A14.1). |
| `GET /graphs` | List graphs (id, name, status, counts) |
| `GET /graphs/:id` | Graph metadata and warnings |
| `DELETE /graphs/:id` | Remove the graph and its cache entries |
| `GET /graphs/:id/nodes?id=…` · `GET /graphs/:id/edges?id=…` | Node and edge details by id (repeat `id`, at most 1,000), in the order requested; unknown ids are left out |
| `GET /graphs/:id/schema` | Property schema + kind colours (feeds the builder and the renderer) |
| `GET /graphs/:id/view?focus=&limit=200` | Ranked view, stubs, hidden-component summary, layout positions |
| `POST /graphs/:id/view/expand` | Body `{ nodeId, mode: "neighbors" | "component", visible: [{id,x,y}] }` → extended view for a "+N" stub or a hidden component (existing nodes keep their positions) |
| `GET /graphs/:id/routes/query?q=<SetTree as JSON>&limit=&maxHops=&routeMode=&includeSubRoutes=` | The query is part of the URL (bookmarkable, shareable) → `QueryResult`. Missing or non-JSON `q` → `400`. |
| *(reserved)* `POST /graphs/:id/links` | Future: connect segmented graphs; declared in OpenAPI, returns `501` |

### 3.7 Data Access Layer (DAL) service (Proposed design)

**Responsibilities**
- **Store:** ingest normalised graphs into Neo4j (`GraphEngine.ingest`) with a `(:Graph {graphId, name, status, expiresAt, pinned})` metadata node.
- **Pull:** execute native queries (`GraphEngine.run`) and serve cached artefacts. On a cache miss it returns `404`, and the owner of that artefact recomputes and stores it back: the server for layouts and views, the ingestion service for the schema (A14.4). Query results are cached by the DAL automatically.
- **Delete:** remove a graph from Neo4j and all its keys from Redis (`graph:{id}:keys`). Used by `DELETE /graphs/:id` and by expiry.
- **Expire:** periodic sweep (`EXPIRY_SWEEP_INTERVAL_SECONDS`, default 300) of graphs whose `expiresAt` has passed (per §9-2), unless `pinned`. Redis artefacts also carry their own TTL, so they disappear even if a sweep is missed.
- **Colour map:** atomic append to `colors:kinds` (Redis `HSETNX`), so concurrent replicas can't assign two colours to one kind.

**Internal endpoints** (`dal-contract`, not exposed to the browser)

| Method & path | Purpose |
|---|---|
| `PUT /dal/graphs/:graphId` | Store a normalised graph (idempotent by content-hash `graphId`) |
| `GET /dal/graphs` · `GET /dal/graphs/:graphId` | List graphs and read graph metadata |
| `DELETE /dal/graphs/:graphId` | Delete the graph and its cache keys (idempotent) |
| `POST /dal/graphs/:graphId/run` | Execute a `NativeQuery` with limits → route rows |
| `GET /dal/graphs/:graphId/topology` · `POST /dal/graphs/:graphId/entities` | Cached node degrees + edge pairs for views and stubs; full nodes/edges by id |
| `GET` · `PUT` · `DELETE /dal/cache/:graphId/:artifact` | Cached artefacts (schema, layout, view, query result) |
| `GET /dal/colors` · `POST /dal/colors` | Read the colour map; atomically assign colours to new kinds (body `{ kinds: [...] }`) |
| `POST /dal/maintenance/expire` | Trigger a sweep manually (also used by tests) |
| `GET /dal/health` | Liveness + Neo4j/Redis connectivity (used by `dal-lb` and compose healthchecks) |

**Load balancing**
- Replicas are stateless: each holds its own Neo4j driver pool and Redis connection, and no request depends on a particular replica.
- `dal-lb` is nginx with an `upstream` over the `dal` service name. Docker DNS resolves it to every replica, and nginx uses round-robin with `max_fails`/`fail_timeout` passive health checks.
- Any replica can serve any request, and writes are idempotent, so retries after a replica failure are safe (`proxy_next_upstream` for idempotent methods).
- Changing the replica count needs a `dal-lb` reload. Traefik with the Docker provider is the alternative if dynamic discovery is wanted later.

### 3.8 Ingestion service (Proposed design)

**Responsibilities**
- Receive raw graph JSON (from the API server, or the seed file at boot) and run the §3.3 pipeline.
- Decide the upload outcome (`201` / `207` with `422` entries / `401`) and build the response body (`graphId`, status, warnings, counts).
- Discover the property schema and store it through the DAL. Register new kinds for colour assignment.
- Seed `SEED_FILE` on boot (idempotent by content hash; pinned if `SEED_PIN=true`).
- Rebuild the schema artefact on request (A14.4).

**Internal endpoints** (`ingest-contract`, not exposed to the browser)

| Method & path | Purpose |
|---|---|
| `POST /ingest/graphs?name=` | Ingest a raw graph JSON body → `201` / `207` / `401` |
| `POST /ingest/graphs/:graphId/rebuild` | Recompute and store the schema artefact for an existing graph |
| *(reserved)* `POST /ingest/jobs` · `GET /ingest/jobs/:id` | Async ingestion (`202` + polling) for future large or segmented graphs (A14.2); returns `501` |
| `GET /ingest/health` | Liveness + DAL reachability |

**Limits:** `MAX_UPLOAD_BYTES` (enforced on both the server and the ingest service) and `INGEST_TIMEOUT_MS` (server-side timeout on the forwarded call → `504`).

### 3.9 Common filters: Cypher mapping (Proposed)

The three primary filters of the product, as builder rules (and presets, B3.1), with the Cypher that `lang-cypher` generates. `$g` = graphId, `h` = maxHops. The no-repeated-node check and `LIMIT` are added by the wrapper (A4) and are omitted here.

| Filter | Builder rule | Generated Cypher (core) | Anchor (A4.6) |
|---|---|---|---|
| Starts in a public service | first node · `publicExposed` = true | `MATCH p = (a:Node {graphId:$g, publicExposed:true})-[:CALLS*0..h]->(b)` | start |
| Ends in a sink | last node · `_isSink` = true | `MATCH p = (a)-[:CALLS*0..h]->(b:Node {graphId:$g, _isSink:true})` | end |
| Has any vulnerability | any node · `vulnerabilities._count` > 0 | `MATCH p = (a)-[:CALLS*0..h]->(v:Node {graphId:$g})-[:CALLS*0..h]->(b) WHERE v.`vulnerabilities._count` > 0 AND length(p) <= h RETURN DISTINCT p` | via node |
| Vulnerability with severity ≥ X | any node · `vulnerabilities._maxSeverityRank` ≥ rank(X) | same shape, `WHERE v.`vulnerabilities._maxSeverityRank` >= $rank` | via node |
| A specific vulnerability (CWE or text) | any node · `vulnerabilities.metadata.cwe` contains "cwe-89" (or `vulnerabilities.message` contains …) | same shape, `WHERE any(c IN v.`vulnerabilities.metadata.cwe` WHERE c CONTAINS $value)` | via node |

**Combined** (public entry → sink, passing a high-severity vulnerability). When several rules are present, the most selective one is the anchor and the others become `WHERE` predicates:

```cypher
MATCH p = (a:Node {graphId:$g, publicExposed:true})-[:CALLS*0..50]->(b:Node {_isSink:true})
WHERE any(n IN nodes(p) WHERE n.`vulnerabilities._maxSeverityRank` >= 3)
RETURN p
```

**Known limits**
- With the "all sub-paths" route mode (§9-1), "starts in a public service" on its own also returns every shorter prefix of each route. Combine it with an end rule (sink or terminal) for full routes.
- Rules on vulnerability fields can't be tied to *the same* vulnerability (§9-3).
- **Sample-data note:** on `train-ticket-be.json` the combined query and "public → vulnerable" return **no routes**, because no public node reaches a vulnerable service or a datastore (`docs/json-review.md` D5). The SQL-injection findings are also labelled CWE-22, so searching for CWE-89 finds nothing. Tests use a crafted fixture where these queries are non-empty (D8).

---

## 4. Frontend decisions

| ID | Area | Decision | Notes | Status |
|---|---|---|---|---|
| B1 | Build | Vite, React 19 (latest stable, exact version pinned), TypeScript | — | Decided |
| B2 | State | TanStack Query (server state) + Zustand (UI state: selected route, view mode, open tooltip, expanded stubs, drawer state) | — | Decided |
| B3 | Query builder | react-querybuilder; fields from `/schema` | Rule model: **position** (`first` / `last` / `any` / `all` / `none` node) × **property path** × **operator** (`=`, `≠`, `in`, `contains`, `exists`, `<`, `>`) × **value**, plus a route **length** rule (min/max). Groups AND/OR, top-level union/intersect/except. | Decided / Proposed model |
| B3.1 | Query presets | A presets menu at the top of the Builder tab inserts ready-made rules, which the user can then edit or combine: **Public entry** (first node public), **Ends in sink** (last node `_isSink`), **Has vulnerability…** (any node; a picker for "any", minimum severity from `SEVERITY_SCALE`, or a specific CWE from the schema's observed values), and **Public → vulnerable → sink** (all three combined). Presets are defined in `lang-cypher-ui` as builder trees, not Cypher text, so they survive a language swap. | Covers the product's primary filters (§3.9) in one click | Proposed |
| B4 | Raw editor | `@neo4j-cypher/react-codemirror`, delivered by `lang-cypher-ui` (§2.2) | Builder → raw is a one-way export. Editor autocompletion is fed from `/schema`. | Decided |
| B5 | Layout | elkjs `layered`, direction RIGHT. Full-graph views are laid out **on the server and cached**; single-route views are laid out on the client. | — | Decided |
| B5.1 | Incremental layout | Expanding a "+N" stub or loading a hidden component asks the server for a new view layout in which existing nodes keep their positions (elk interactive mode); cached per `viewKey` | Keeps the layout server-owned and consistent (B5) | Proposed |
| B6 | Rendering | `@xyflow/react` v12. Custom node types: `kindNode`, `ghostMarker`, `overflowStub`. All memoised. Highlight is applied by class/data flags, not by rebuilding arrays. Built-ins used: `MiniMap`, `Controls`, `Background`, `NodeToolbar`. | — | Proposed |
| B7 | Styling | styled-components v6. Theme tokens defined through `ThemeProvider`. Transient props (`$kind`, `$dimmed`). | The library is in maintenance mode; only stable features are used | Decided (base plan) |

---

## 5. UI / UX decisions

| ID | Area | Decision | Notes | Status |
|---|---|---|---|---|
| C1 | Screen layout | Collapsible left drawer (query panel: Builder / Raw tabs). When collapsed, the graph takes the full viewport. A slim top bar holds the graph picker, view-mode toggle and route stepper. | — | Decided |
| C2 | Nodes | Plain coloured circle (kind colour) + label | — | Decided |
| C2.1 | Node states | Incomplete/placeholder: dashed grey outline. Vulnerabilities: a thick **warm border with a small blur glow**, from light orange (lowest severity of the scale) to pinkish red (highest), so it differs from the crisp accent ring of a clicked node (C6.2). Public exposure: tooltip only. | The base plan requires incomplete nodes to be visibly distinct | Proposed |
| C3 | Edges | Smoothstep with arrowheads. Route edges are thicker, use the accent colour, and have an animated dash in highlight mode. The accent is **cyan** (`#0891b2`): pink to red is the vulnerability severity scale (C2.1), so the colour of routes, paths and animated edges must not collide with it. | Highlighting never navigates or redirects | Decided |
| C4 | Cycle indicator | Ghost marker node: smaller hollow dashed circle labelled `↺ <target>` in the target's kind colour. Clicking it pans to and pulses the real node. | — | Decided |
| C5 | Route selector | Top-bar stepper `◀ 3 / 128 ▶` (← / → keys) with a "(truncated)" flag, plus an expandable, virtualised route list (length, start → end, kind colour strip) | — | Decided |
| C6 | Highlight | Whole-graph mode dims non-route elements to ~15% opacity. A view-mode toggle switches between **Route only** and **Whole graph + highlight**. | — | Decided |
| C6.1 | Highlight vs 200-node cap | In whole-graph mode, the selected route's nodes are always included in the view. The remaining slots are filled by degree. | Otherwise a route could be partly invisible | Proposed |
| C7 | Overflow | "+N" stub node attached by a dashed edge. A corner chip ("N hidden components") opens a list of the disconnected groups that aren't shown. | — | Decided |
| C8 | Node details | `NodeToolbar` card with all original properties and a collapsible vulnerability list. Opens on click and stays open. One open at a time. Closes on pane click, `Esc`, or another node's click. | — | Decided |
| C9 | States | Empty: centred overlay message on the dimmed graph, with a query summary. Loading: thin progress bar, the canvas stays interactive. Query errors: inline in the builder rule or the editor lint gutter (line/column). Graph warnings: top-bar chip → list. | — | Decided |
| C6.2 | Click highlight | In the whole-graph view, clicking a **node** highlights all routes leading up to it (every node from which it can be reached, and the edges on those routes); clicking an **edge** highlights only the routes that end at the node it points to **and contain that edge** (routes to that node through its other incoming edges stay dimmed; a route never visits the end node twice). Everything else is dimmed. A chip at the bottom names the selection and has a Clear button; clicking empty space or pressing Esc also clears it. The highlight is computed from the displayed graph (hidden parts are indicated by the "+N" bubbles of highlighted nodes). It replaces the selected-route highlight until cleared. | Added after the first delivery | Decided |
| C13 | Route markers and selector | The selector reads `n / total routes`. In the route list the **text of every route entry** (e.g. "food-service → station-service") has the colour of its **highest vulnerability severity** (the colours of the vulnerable-node borders, C2.1; bold for vulnerable routes), **black** when none of its nodes has a vulnerability; the tooltip names the severity and the header explains the marker. | Added after the first delivery | Decided |
| C15 | Dropdown values in the builder | A value dropdown starts with the option it displays: a new rule on a property with few observed values (for example `kind`) holds its first option (`service`) as its value, so it counts as complete. If an operator change swaps a text box for a dropdown (for example "contains" → "="), the first option is registered as well. Values the user picked, or that come from a shared URL, are never replaced; number fields and the route length stay empty until filled in. | Fix after the first delivery | Decided |
| C14 | Combining queries | A query added to the panel is joined to the ones above by **intersection** by default (routes matching both); the operator can be changed to union or difference. | Added after the first delivery | Decided |
| C11 | Query in the address bar | The page URL mirrors the editor: `?graph=<id>&q=<set tree JSON>&mode=&hops=&limit=&run=1&route=<n>&view=`. It follows the editor while typing (builder rules and Cypher text), and opening such a URL restores the editor and, with `run=1`, runs the query and selects the route. `q` is the same JSON the API takes in `GET /graphs/:id/routes/query`. Queries that nest to the right (possible only through the API) cannot be shown in the editor and are ignored. | Added after the first delivery | Decided |
| C12 | Full graph button | A "Full graph" button next to "Collapse" in the query panel drops the query result and every highlight and returns to the whole graph (the query stays in the editor and in the URL). | Added after the first delivery | Decided |
| C10 | Theme | Light only. All colours come from theme tokens, so a dark theme can be added later with no component changes. | — | Decided |

---

## 6. Testing (from base plan; tooling Proposed)

| ID | Area | Decision | Status |
|---|---|---|---|
| D1 | Runner | Jest with the `@swc/jest` transform. `tsc -p tsconfig.json --noEmit` runs before the tests, so type errors also fail `npm test`. | Decided (Jest) / Proposed transform |
| D2 | Structure | `/tests/unit` (graph-core, query-core, lang-cypher, colour algorithm) · `/tests/api` (HTTP contract via Fastify `inject()`) · `/tests/ingest` (ingest contract: outcomes, seeding, rebuild) · `/tests/dal` (DAL contract, expiry, locking) · `/tests/perf` (API response time) · `/tests/fixtures` | Decided |
| D3 | External services | API and perf tests use **Testcontainers** (Neo4j + Redis), seeded from fixtures. The DAL and the ingestion service run **in-process** in these tests (`DalClient` and `IngestClient` each have an HTTP and an in-process implementation), so the tests need neither the load balancer nor extra containers. DAL tests (`/tests/dal`) start two DAL instances on the same containers to cover lock contention and idempotent deletes. Unit tests need no services. | Proposed (possible now that Docker is decided) |
| D4 | `npm test` | Runs everything. A custom reporter writes `reports/test-report-<timestamp>.json` (suite, test, status, duration, failure message, expected/actual diff). `reports/` is added to `.gitignore`. | Decided / Proposed format |
| D5 | `npm run test:bail` | Stops at the **first failing test**: `--runInBand --bail=1` plus a custom jest-circus environment that skips the remaining tests after the first failure (Jest's own `--bail` works per file). Prints the full failure reason. | Decided / Proposed mechanism |
| D6 | Perf tests | Record p50/p95 for standard (20 conditions) and heavy (70 conditions) queries on generated graphs. **Report only, no threshold failures** (latency isn't measured as a gate in this stage). | Proposed |
| D7 | Generator | `/tools/generator`, seeded PRNG. Emits the **input JSON format** (including quirks: string `to`, missing targets, cycles, isolated nodes), up to 1,000 nodes / 10,000 edges. The same seed gives the same file. | Decided (base plan) / Proposed details |
| D8 | Fixtures | The sample file; edge-case graphs (cycle, self-loop, duplicate name, missing target, duplicate edge, isolated node); a crafted **security fixture** where public → vulnerable → sink routes exist, with mixed severities, a CWE-89 entry and mixed-case values; generated graphs with fixed seeds. Every §3.9 filter and preset has expected results for the sample (including the expected empty results) and for the security fixture. Expectations are hand-verified and hard-coded. | Proposed |

### 6.1 Code quality (linting and formatting)

| ID | Area | Decision | Status |
|---|---|---|---|
| F1 | Linter | **ESLint** (current major, flat config) with a single root `eslint.config.js` covering every workspace | Decided |
| F2 | Rule set | **Default recommended rules only**, no custom rule tuning: `@eslint/js` `recommended` and `typescript-eslint` `recommended` everywhere. React code (`apps/client`, `lang-cypher-ui`) also uses `eslint-plugin-react-hooks` `recommended` and `eslint-plugin-react-refresh` (the Vite React template defaults). Environment globals come from `globals` (`browser` for React code, `node` for services, tools and tests). | Decided |
| F3 | Package boundaries | The single project-specific setting: the core `no-restricted-imports` rule blocks Cypher/Neo4j-specific packages outside `lang-*` and `engine-*`, and `engine-neo4j` outside `apps/dal` (§2.2, §11.3). Can be dropped if strictly default rules are wanted. | Proposed |
| F4 | Formatting | Prettier with default options. `eslint-config-prettier` is applied last, so ESLint never reports formatting issues. | Proposed |
| F5 | Ignored paths | `**/dist`, `**/generated` (contract codegen output), `reports/`, `coverage/`, `node_modules/` | Proposed |
| F6 | Scripts | `npm run lint` (all workspaces, fails on errors) · `npm run lint:fix` · `npm run format`. Linting is **not** part of `npm test`, so the test report contains only test results. | Proposed |

---

## 7. Infrastructure (Docker)

| ID | Area | Decision | Status |
|---|---|---|---|
| E1 | Compose services | `neo4j`, `redis`, `dal` (×`DAL_REPLICAS`), `dal-lb`, `ingest`, `server`, `client`, in one `docker/compose.yaml` | Decided (dockerize) / Proposed layout |
| E2 | Ports (bound to `127.0.0.1` only) | client `8080`, server `3001` (host port; `3000` is often taken, inside the container it is `3000`), DAL load balancer `4000` (published only by the dev override); the ingestion service is published nowhere (`npm run dev` runs it locally on `5000`), Neo4j Browser `7474`, Bolt `7687`, Redis `6379`. DAL replicas themselves are never published. | Proposed |
| E3 | Images | Node 24 LTS (server and DAL builds); nginx for `dal-lb`; client built by Vite and served by nginx; Neo4j Community and Redis with **exact pinned tags** chosen at setup | Proposed |
| E4 | Persistence | Named volume for Neo4j data. Redis without persistence (cache only, rebuilt on demand). | Proposed |
| E5 | Scripts | `npm start` → `docker compose up --build` (seeds the sample) · `npm run dev` → Neo4j, Redis, DAL replicas and `dal-lb` in Docker; ingest, server and client run locally with hot reload (ingest and server → DAL at `http://127.0.0.1:4000`; server → ingest at `http://127.0.0.1:5000`) · `npm stop` → `docker compose down` | Proposed |
| E6 | Health | Healthchecks on Neo4j, Redis, each DAL replica (`/dal/health`) and ingest (`/ingest/health`). Startup order: Neo4j + Redis → DAL replicas → `dal-lb` → ingest (which then seeds) → server → client. `GET /health` on the server reports DAL and ingest reachability. | Proposed |

---

## 8. Implementation phases

| Phase | Deliverables | Done when |
|---|---|---|
| **P0 Scaffolding** | Workspaces, TS project references, ESLint + Prettier (§6.1), compose file, `.env.example`, Jest and reporter skeleton, both test scripts | `npm start` brings up empty services. `npm test` and `npm run test:bail` run a placeholder test and write a report. `npm run lint` passes on the scaffold. |
| **P1 Contracts** | `openapi.yaml`, codegen pipeline, `query-core` types and interfaces (§2.2, §3.2) | Generated types compile in the server and client. Contract unit tests pass. |
| **P2 Ingestion** | `graph-core` pipeline (§3.3), generator (D7), fixtures (D8) | Unit tests cover every fixture. The sample yields 47 nodes (1 placeholder), 98 edges, 0 cycles, and the expected warnings. |
| **P3 Engine, DAL & ingestion** | `engine-neo4j` (ingest, flattening §3.1, run, delete), `dal-contract`, DAL service (store, pull, delete, cache, colour map, expiry with lock), `dal-lb`; `ingest-contract`, ingestion service (pipeline, schema discovery, kind registration, seeding, rebuild); server `dal-client` and `ingest-client`; colour assignment (§3.5) | The sample and a 1k/10k generated graph ingest through server → ingest → `dal-lb` with 2 DAL replicas. `/schema` and `/graphs` pass the API tests. Ingest tests cover every upload outcome, idempotent seeding and rebuild. DAL tests cover expiry (including two replicas racing for the lock) and idempotent delete. |
| **P4 Query** | `lang-cypher` (compile + raw wrapper, anchoring A4.6, value normalisation A4.7), set-tree executor, limits, cycle marker, sorting | API tests cover property and position filters, length, union/intersect/except, raw paths/nodes, rejection cases, truncation, and every §3.9 filter on the sample and the security fixture. Unit tests check the anchor chosen for each rule combination. |
| **P5 View & layout** | Degree ranking, 200-node cap, stubs, hidden components, server elkjs layout, incremental layout, caching | View API tests pass. Layout positions are stable across calls (from the cache). |
| **P6 UI shell** | App frame, drawer, top bar, canvas, node/edge/marker/stub types, tooltip, all states (C9) | The sample graph renders laid out left to right. Tooltip, stubs and empty state work. |
| **P7 Query panel** | `lang-cypher-ui`: builder from `/schema`, presets (B3.1), editor, one-way export, set-tree composer | Queries built in the UI return the same results as the API test fixtures |
| **P8 Route UX** | Stepper, route list, view-mode toggle, highlight, ghost marker navigation, stub expansion | Manual acceptance checklist passes on the sample and on a generated graph |
| **P9 Perf & docs** | Perf tests (D6), README (setup, scripts, API, architecture) | Perf report produced. The README covers a clean setup on a new machine. |

---

## 9. Resolved decisions

These items couldn't be derived from the base plan or the other decisions, because they change user-visible results. The project owner resolved each one; the outcomes are recorded in the decision table (A4.5, A7.1, A3.5).

1. **Default route mode (A4.5).** When a query doesn't pin the endpoints, which routes are returned?
   - **All sub-paths**: every simple path, including each prefix and suffix of longer routes. Many more results and heavy duplication.
2. **Graph lifetime (A7.1).** expiry **delete the graph** (Neo4j data included)
3. **Correlated nested-property queries (A3.5, §3.1).** Flattening without child nodes (as decided) means rules on array-of-object fields can't be tied to *the same* element. Is this limitation acceptable for this iteration (future iteration might change the querying mechanism)

---

## 10. Risks

| Risk | Mitigation |
|---|---|
| Path explosion on dense graphs | Hop limit, route limit, transaction timeout, truncation flag (A4, A4.1) |
| User Cypher harming the shared store | Read transactions, write-clause rejection, graph scoping in the wrapper (A4.2) |
| OpenAPI → Valibot codegen maturity | Checked in P1. Fallback: hand-written Valibot schemas checked against the OpenAPI schema by a contract test. |
| styled-components in maintenance mode | Only stable APIs used. Styling is isolated behind theme tokens. |
| Load balancing the DAL doesn't scale the databases: Neo4j Community and Redis stay single instances | Acceptable at 1k/10k scale. The DAL boundary makes a later move to clustered Redis or Neo4j Enterprise/Aura a DAL-only change. |
| Extra network hop (server → dal-lb → DAL) adds latency to every query | Small JSON payloads, keep-alive connections from the server to `dal-lb` and from nginx to the upstreams, and query results cached in the DAL |
| Uploads now cross three hops (server → ingest → dal-lb → DAL) and are held in memory by each | `MAX_UPLOAD_BYTES` on the server and ingest service; the body is streamed from server to ingest; `INGEST_TIMEOUT_MS`; async mode reserved (A14.2) |
| Licences: Neo4j Community (GPLv3), Redis 8 (RSALv2 / SSPLv1 / AGPLv3) | Fine for internal use. If the product is distributed, review the licences or swap Redis for Valkey (protocol-compatible). |

---

## 11. Components

The full list of runtime services, Docker elements, workspace modules and tooling in the project. Each entry lists its responsibility and dependencies. Section references point to the decisions above.

### 11.1 Runtime services

| Service | Runs as | Responsibility | Talks to |
|---|---|---|---|
| **Web client** | nginx container serving the Vite production build | Serves the SPA and reverse-proxies `/api/*` to the API server, so the browser sees one origin (CORS is out of scope, §1) | API server |
| **API server** | Node 24 LTS container (Fastify) | Public REST API (§3.6); forwards uploads to the ingestion service; query compilation and set-op combining; views and layout. Has no direct database connections and does no parsing. | Ingestion service, DAL load balancer |
| **Ingestion service** (`ingest`) | Node 24 LTS container (Fastify), stateless, one instance (A14.3) | Turns raw graph JSON into a stored graph: parse, validate, normalise, placeholders, cycles, degree, schema discovery, new-kind registration, upload outcome (`201`/`207`/`401`), schema rebuild (§3.8) | DAL load balancer |
| **Seeder** | Boot task inside the **ingestion service** | **Doesn't parse or store anything itself.** At startup it reads the file in `SEED_FILE` and runs it through the same pipeline as `POST /ingest/graphs`. With `SEED_PIN=true` the seeded graph is exempt from expiry. (A11) | (via the pipeline) DAL |
| **DAL load balancer** (`dal-lb`) | nginx container | Round-robin distribution of internal DAL requests across replicas, with passive failover (A13.1) | DAL replicas |
| **DAL** (×`DAL_REPLICAS`) | Node 24 LTS containers (Fastify), stateless | The only component that touches Neo4j and Redis: store, pull, delete graphs and cache entries; colour map; expiry (§3.7) | Neo4j, Redis |
| **Expiry sweeper** | Interval task inside **each DAL replica**; only the replica holding `lock:expiry` runs a sweep (A13.3) | Deletes graphs whose `expiresAt` has passed (Neo4j data + all Redis keys, per §9-2). The expiry time is stored on the `(:Graph)` metadata node in Neo4j, so it survives a Redis restart (E4). | Neo4j, Redis |
| **Neo4j** | `neo4j` Community container | Persistent graph store and Cypher execution (A3) | — |
| **Redis** | `redis` container | Cache for derived artefacts, the global colour map and the expiry lock (§3.4) | — |

**Who parses and stores an uploaded JSON:**

```
browser ─► client nginx /api ─► API server  routes/graphs (POST /graphs)
                                   │  ingest-client (streams body, passes status/body back)
                                   ▼
                     ingestion service  routes/ingest  (or jobs/seed at boot)
                                   │  pipeline: graph-core parse → validate → normalise → cycles → degree
                                   │  schema discovery · new-kind registration
                                   │  dal-client
                                   ▼
                          dal-lb ─► DAL replica ─► Neo4j (graph + expiresAt) · Redis (schema, colours)
```

The server computes the full-graph layout on the first view request and caches it through the DAL.

### 11.2 Docker elements

| Element | Name / path | Purpose |
|---|---|---|
| Compose file | `docker/compose.yaml` | Defines all services, healthchecks and the startup order in E6. `dal` uses `deploy.replicas: ${DAL_REPLICAS:-2}`. |
| Dev compose override | `docker/compose.dev.yaml` | Starts `neo4j`, `redis`, `dal` replicas and `dal-lb` (published on `127.0.0.1:4000`) for `npm run dev` (E5) |
| Server image | `docker/server.Dockerfile` | Multi-stage: install workspaces → build `apps/server` and its packages → slim Node 24 runtime image |
| Ingest image | `docker/ingest.Dockerfile` | Multi-stage: build `apps/ingest` + `graph-core` + `ingest-contract` + `dal-contract` → slim Node 24 runtime image |
| DAL image | `docker/dal.Dockerfile` | Multi-stage: build `apps/dal` + `engine-neo4j` + `dal-contract` → slim Node 24 runtime image |
| DAL load-balancer config | `docker/dal-lb.nginx.conf.template` (host and port filled from `DAL_HOST` / `DAL_PORT` at start) | `upstream dal { server dal:4000 max_fails=3 fail_timeout=10s; keepalive 32; }`, round-robin, `proxy_next_upstream` for idempotent methods, `/dal/health` pass-through |
| Client image | `docker/client.Dockerfile` | Multi-stage: build `apps/client` with Vite → `nginx:alpine` runtime |
| nginx config | `docker/client.nginx.conf.template` | Static file serving with SPA fallback; `location /api/ → http://${SERVER_HOST}:${API_PORT}/` (filled from the environment at start) |
| Kubernetes | `k8s/` (Kustomize) | The same services as the compose file; addresses and ports in `k8s/configmap.yaml`, the variables of `.env.example` (see `k8s/README.md`) |
| Volumes | `neo4j-data`, `neo4j-logs` | Neo4j persistence (E4). Redis has no volume. |
| Seed override | `docker/compose.seed.yaml`: `${SEED_GRAPH} → /seed/graph.json:ro` (ingest container) + `SEED_FILE`, `SEED_NAME`, `SEED_PIN` | Optional seed input for the ingestion service (A11); `npm start` uses it with the example graph |
| Network | `graphdisplay` (bridge) | Internal service-to-service traffic. Only the ports in E2 are published, on `127.0.0.1`. |
| Environment | `.env` (git-ignored) from `.env.example` | Credentials and limits (A10), shared by compose and `npm run dev` |
| Ignore file | `.dockerignore` | Excludes `node_modules`, `reports/`, `.git`, local env files |
| Test containers | Created by Testcontainers at test time (not in compose) | Isolated Neo4j and Redis for API, DAL and perf tests (D3) |

### 11.3 Workspace packages (shared modules)

Dependency direction: `apps → lang-*/engine-* → query-core → api-contract`. `graph-core` depends only on `api-contract` and is used at runtime **only by `apps/ingest`** (plus the generator and tests). `dal-contract` depends on `query-core` (it carries `NativeQuery`, route rows and normalised graphs). `ingest-contract` depends on `api-contract` (it reuses the upload response types). `engine-neo4j` is used **only by `apps/dal`**. Nothing outside `lang-*` and `engine-*` imports Cypher- or Neo4j-specific code (§2.2).

| Package | Responsibility | Depends on | Used by | Key libraries |
|---|---|---|---|---|
| `@gd/api-contract` | `openapi.yaml`; generated TS types, Valibot schemas and the fetch client (A1.1) | — | all | `@hey-api/openapi-ts`, `valibot` |
| `@gd/graph-core` | Parse, validate and normalise input graphs; placeholder nodes; duplicates; Tarjan cycle detection; derived properties (§3.1.1); flattening model; schema discovery with value counts (§3.1, §3.3). Isomorphic (no I/O). | api-contract | ingest, engine-neo4j (flattening model), generator, tests | `valibot` |
| `@gd/query-core` | Language-agnostic model: `SetTree`, `ConditionTree`, `Route`, `QueryResult`, limits; `QueryLanguage` and `GraphEngine` interfaces; set-operation combiner (canonical route keys) | api-contract | lang-*, engine-*, server, client | — |
| `@gd/lang-cypher` | `QueryLanguage` for Cypher: compile builder trees, validate and wrap raw queries (graph scoping, hop limit, `LIMIT`, read-only check, return-shape check); anchor selection by rule selectivity; value normalisation (A4–A4.7, §3.9) | query-core | server, lang-cypher-ui | Cypher parser from Neo4j's open-source language support (for raw validation) |
| `@gd/lang-cypher-ui` | `QueryLanguageUI` for Cypher: editor component (with the upper-case literal lint hint), react-querybuilder → Cypher formatter, query presets as builder trees (B3, B3.1, B4, A4.7) | query-core, lang-cypher | client | `@neo4j-cypher/react-codemirror`, `react-querybuilder` |
| `@gd/ingest-contract` | `ingest.openapi.yaml`; generated types, Valibot schemas and client for the internal server ↔ ingest API (§3.8) | api-contract | server, ingest | `@hey-api/openapi-ts`, `valibot` |
| `@gd/dal-contract` | `dal.openapi.yaml`; generated types, Valibot schemas and client for the internal server/ingest ↔ DAL API (A13.2) | query-core | server, ingest, dal | `@hey-api/openapi-ts`, `valibot` |
| `@gd/engine-neo4j` | `GraphEngine` for Neo4j: schema setup (constraints and indexes), batched ingest, path/node row mapping, delete, expiry query | query-core, graph-core | dal | `neo4j-driver` |

### 11.4 API server modules (`apps/server`)

| Module | Responsibility | Related |
|---|---|---|
| `config` | Loads and validates env vars (A10); exposes typed settings | A10 |
| `app` | Fastify instance; route binding from `openapi.yaml` by `operationId`; Ajv validation; logging (Fastify's built-in pino) | A1.1, A2 |
| `errors` | Maps domain errors to HTTP: `422` query rejections, `501` reserved, `504` timeout (query or ingest). Upload outcomes (`201`/`207`/`401`) are passed through from the ingestion service unchanged. | A4.1, A14.1 |
| `routes/graphs` | Upload (forwarded via `ingest-client`), list, get, delete (via `dal-client`) | §3.6, A14.1 |
| `routes/schema` | Property schema + colour map | §3.6 |
| `routes/view` | Ranked view, stubs, neighbourhood expansion | §3.6, C6.1, C7 |
| `routes/query` | Route query endpoint | §3.6 |
| `routes/health` | Liveness and dependency status | E6 |
| `services/query` | Resolves the language, compiles leaves, runs them concurrently through the DAL, combines with set ops, sorts, applies limits and truncation | A4, A5 |
| `services/schema` | Reads the schema and colour map from the DAL; on a miss, asks the ingestion service to rebuild the schema | A14.4 |
| `services/view` | Degree ranking (from stored node degree), 200-node cap, route pinning, stubs, hidden components | C6.1, C7 |
| `services/layout` | elkjs layered layout, including incremental layouts with fixed positions; cached through the DAL | B5, B5.1 |
| `ingest-client` | `IngestClient` interface with two implementations: HTTP (streams the upload body, `INGEST_TIMEOUT_MS`) and in-process (tests, D3) | A14.1 |
| `dal-client` | `DalClient` interface with two implementations: HTTP (via `dal-lb`, keep-alive, retries for idempotent calls) and in-process (tests, D3) | A13 |

> In all service tables, `services/*` and `jobs/*` are **code modules inside that container**, not separate runtime services. Runtime services are listed only in §11.1.

### 11.4.0 Ingestion service modules (`apps/ingest`)

| Module | Responsibility | Related |
|---|---|---|
| `config` | Port, DAL URL, seed settings, upload limit | A10 |
| `app` | Fastify instance bound to `ingest.openapi.yaml`; `/ingest/health`; body-size limit | A14 |
| `routes/ingest` | `POST /ingest/graphs`, `POST /ingest/graphs/:graphId/rebuild`, reserved job endpoints (`501`) | §3.8 |
| `pipeline` | Orchestrates the §3.3 steps using `graph-core`, including derived properties with the configured `SINK_KINDS` and `SEVERITY_SCALE`; builds the `201`/`207`/`401` outcome and the warnings body | §3.3, §3.1.1, A6.1 |
| `schema` | Property discovery with value counts (for anchor selectivity) plus the sink kinds and severity scale; stores the result through the DAL | §3.1, A4.6, A14.4 |
| `kinds` | Collects the graph's kinds and registers new ones with the DAL colour endpoint | §3.5 |
| `dal-client` | HTTP / in-process `DalClient` (shared implementation from `dal-contract`) | A13 |
| `jobs/seed` | Boot-time seeding: waits for DAL health, reads `SEED_FILE`, runs `pipeline`, pins if `SEED_PIN=true` | A11 |

### 11.4.1 DAL service modules (`apps/dal`)

| Module | Responsibility | Related |
|---|---|---|
| `config` | Neo4j/Redis connection settings, sweep interval, lock lease, cache TTL | A10 |
| `app` | Fastify instance bound to `dal.openapi.yaml`; `/dal/health` | A13.2 |
| `engine` | `GraphEngine` instance (`engine-neo4j`); driver pool; constraint and index setup on boot (idempotent) | A3 |
| `repositories/graphs` | Store, list, read metadata, delete (`(:Graph)` node + `(:Node)`/`[:CALLS]` data) | §3.7 |
| `repositories/queries` | Run `NativeQuery` with limits and the transaction timeout; map rows; cache results | A4.1 |
| `cache` | Redis adapter (`ioredis`): key builders (§3.4), per-graph key index, TTLs, no-cache fallback | A7 |
| `colors` | Atomic colour assignment (`HSETNX`) using the §3.5 algorithm | §3.5 |
| `jobs/expiry` | Lock-guarded sweeper: find expired unpinned graphs → delete Neo4j data → delete Redis keys | A13.3, §9-2 |
| `locks` | Redis lease lock (acquire, renew, release with a token check) | A13.3 |

### 11.5 Web client modules (`apps/client`)

| Module | Responsibility | Related |
|---|---|---|
| `main`, `pages/ExplorerPage` | Providers (TanStack Query, `ThemeProvider`); the one page: top bar, query drawer and canvas, address-bar sync, keyboard shortcuts | B2, B7 |
| `api` | Typed client + TanStack Query hooks (`useGraphs`, `useSchema`, `useView`) | A1.1 |
| `store` | Zustand store: selected graph and route, view mode, open node, focus, drawer state | B2 |
| `theme` | Theme tokens, built from the shared palette (`packages/api-contract/src/colors.ts`, the only file with colour values) | C10, §3.5 |
| `constants` | API base path, dev-server settings, node size | |
| `types/` | Data objects: flow node data, highlight, block, URL state, UI state, props of shared components | |
| `lib/` | Pure logic: `highlight`, `severity`, `blocks`, `urlState`, `urlSync` | C12–C15 |
| `hooks/useRouteNodes` | Fetches the nodes of the routes of the current result | |
| `components/TopBar` | Graph picker, view-mode toggle, route stepper, warnings chip, progress bar | C1, C5, C9 |
| `components/QueryDrawer` | Collapsible drawer: composes the query blocks and the run options | C1, B3, B4 |
| `components/QueryBlockCard`, `SetOperatorRow` | One query (Builder / Raw tabs, presets) and the operator between two queries | B3.1 |
| `components/Button`, `Message`, `OptionsRow` | Shared styled primitives of the drawer | |
| `components/Canvas` | `ReactFlow` setup, `fitView`, Controls, Background | B6 |
| `components/KindNode`, `GhostNode`, `StubNode` (+ `NodeBox`, `NodeDot`, `NodeLabel`, `nodeTypes`) | The three node renderers and their shared parts | C2, C2.1, C4, C7 |
| `components/NodeDetails` | `NodeToolbar` card (click-to-open, single instance) | C8 |
| `components/Overlays`, `FocusChip`, `Legend` | Empty-result overlay, hidden-components chip, focus summary, legend | C7, C9 |
| `components/RouteList` | Virtualised list of routes, coloured by vulnerability severity | C5 |

Every service app follows the same layout: `app.ts` (wiring), `api.ts` (the endpoints), `types/` (data objects),
`constants.ts` (environment variable names, defaults, error codes, key names). Shared constants (ports, loopback,
signals) are in `packages/api-contract/src/constants.ts`.

### 11.6 Tooling and test components

| Component | Location | Responsibility | Related |
|---|---|---|---|
| Contract codegen | `npm run contract:gen` (in `api-contract`) | Regenerates types, schemas and client from `openapi.yaml` | A1.1 |
| TypeScript check | root `tsconfig.json` (one project over all workspaces) | `tsc -p tsconfig.json --noEmit` before tests | D1 |
| Lint / format | Root `eslint.config.js` + Prettier config | ESLint default recommended rules for JS, TypeScript and React; package-boundary import restriction; Prettier formatting | §6.1 |
| Jest config | `tests/jest.config.ts` | Projects: `unit`, `api`, `perf`; `@swc/jest` transform | D1, D2 |
| JSON reporter | `tests/reporter/json-reporter.ts` | Writes `reports/test-report-<timestamp>.json` | D4 |
| Bail environment | `tests/env/bail-environment.ts` | jest-circus environment that skips the remaining tests after the first failure | D5 |
| Service harness | `tests/setup/containers.ts` | Starts Neo4j and Redis with Testcontainers, wires env, creates in-process DAL and ingest instances, tears down | D3 |
| Ingest tests | `tests/ingest/` | Every upload outcome (`201`/`207`/`401`), idempotent seeding, schema rebuild, upload-size limit | A14 |
| DAL tests | `tests/dal/` | Store/pull/delete, cache TTL, expiry sweep, two-instance lock contention, idempotency | A13 |
| Fixtures | `tests/fixtures/` | Sample, edge-case graphs and expected results | D8 |
| Synthetic generator | `tools/generator` (`npm run gen -- --seed --nodes --edges`) | Seeded graphs in the input format, up to 1k nodes / 10k edges | D7 |

### 11.7 Third-party libraries

| Library | Used by | Purpose |
|---|---|---|
| `react`, `react-dom` (19.x) | client | UI |
| `@xyflow/react` (12.x) | client | Graph rendering |
| `styled-components` (6.x) | client, lang-cypher-ui | Styling |
| `@tanstack/react-query` | client | Server state |
| `zustand` | client | UI state |
| `react-querybuilder` | lang-cypher-ui | Query builder |
| `@neo4j-cypher/react-codemirror` | lang-cypher-ui | Cypher editor |
| `@tanstack/react-virtual` | client | Virtualised route list |
| `vite`, `@vitejs/plugin-react-swc` | client | Build and dev server (dev `/api` proxy) |
| `fastify`, `fastify-openapi-glue` | server, ingest, dal | HTTP framework and OpenAPI route binding |
| `undici` | server, ingest (dal-client, ingest-client) | Keep-alive HTTP client to `dal-lb` and to ingest |
| `neo4j-driver` | engine-neo4j (dal) | Bolt client |
| `ioredis` | dal | Redis client |
| `nginx` (image) | client container, `dal-lb` | Static serving + `/api` proxy; DAL load balancing |
| `elkjs` | server, client | Layered layout |
| `valibot` | api-contract, ingest-contract, dal-contract, graph-core | Validation |
| `@hey-api/openapi-ts` | api-contract (dev) | Code generation |
| `jest`, `@swc/jest`, `testcontainers` | tests (dev) | Testing |
| `pure-rand` | generator | Seeded randomness |
| `eslint`, `@eslint/js`, `typescript-eslint`, `globals` | all workspaces (dev) | Linting with the default recommended rules |
| `eslint-plugin-react-hooks`, `eslint-plugin-react-refresh` | client, lang-cypher-ui (dev) | React recommended lint rules |
| `prettier`, `eslint-config-prettier` | all workspaces (dev) | Formatting, without overlapping lint rules |

Exact versions are pinned in the lockfile at P0 (React 19 is pinned to its latest stable release at that time).

---

## 12. Implementation status

All phases P0–P9 are implemented. The application runs under Docker Compose (`npm start`), `npm test` and `npm run test:bail` pass, and the UI was exercised in a real browser.

### 12.1 Verification

| What | Result |
|---|---|
| `npm test` (type-check, then Jest with Testcontainers for Neo4j and Redis) | 16 suites, 295 tests passing; writes `reports/test-report-<timestamp>.json` |
| `npm run test:bail` | Stops at the first failing test, skips the rest, prints the failure reason, exits non-zero (checked with a deliberately failing probe test) |
| `npm run lint`, type-check | Clean, default ESLint recommended rules |
| Performance test (1,000 nodes / 10,000 edges) | Timings recorded in `reports/perf-<timestamp>.json`, not gated (see §12.3) |
| Browser flows (headless Chrome against the Docker deployment) | Upload through the UI, presets, builder rules, raw Cypher editor, empty-result overlay, route stepper and list, keyboard navigation, cycle marker, "+N" stubs, hidden components, drawer collapse: all passing, no console errors |
| Load balancing | Both DAL replicas served requests (76 and 63 in one session) |

### 12.2 Differences from the plan

| Area | Plan | Implemented | Why |
|---|---|---|---|
| A1.1 contracts | Types, Valibot schemas and clients **generated** from OpenAPI | Three hand-written OpenAPI files (`openapi.yaml`, `ingest.openapi.yaml`, `dal.openapi.yaml`) plus hand-written Valibot schemas and typed clients. A contract test checks that every documented operation exists in the code and every `$ref` resolves. | This is the fallback named in §10 (codegen maturity). There is no generator step, so the YAML can drift from the code except for what the contract test covers. |
| A2 validation | Fastify's Ajv from the OpenAPI schemas | Valibot validation inside the handlers | Follows from the line above |
| D1 / P0 | TypeScript project references | One root `tsconfig.json`, `tsc -p tsconfig.json --noEmit` | Simpler; all workspaces are type-checked together |
| A4.2 raw queries | Parser-based validation | A tokenising check: literals and comments are masked, then write/admin keywords, the `$g` scope, a single `RETURN` with one plain variable, and a single statement are verified. Results are additionally guarded after execution (graph scope, hop limit, simple paths). | No Cypher parser dependency. Strictness errs on the safe side (for example a property that is literally named `set` is accepted only as `n.set`). |
| Raw query ordering | "Sorted longest first" | Builder queries are ordered in Cypher; raw queries are sorted after execution, so a raw query **without its own `ORDER BY`** that exceeds the limit returns an arbitrary subset (flagged `truncated`) | A generic wrapper cannot order an unknown return expression before the limit |
| E2 ports | Server on 3000 | Host port **3001** (`SERVER_PORT`) | Port 3000 was occupied on the development machine |
| B4 editor | `@neo4j-cypher/react-codemirror` (latest) | Pinned to **1.0.4** with a plain-textarea fallback if the editor fails | The `latest` tag (2.0.0-next) ships unresolved `workspace:*` dependencies and cannot be installed |
| B6 mini-map | MiniMap listed among the built-ins | **Not included** | The mini-map computed its bounds but drew no nodes with this React Flow version; a blank widget was worse than none |
| B6 attribution | (not specified) | The React Flow attribution is shown | Hiding it requires a Pro subscription |
| B6 dragging | (not specified) | Node dragging is disabled | The layout is server-owned and consistent across clients (B5) |
| B5.1 expansion layout | Elk interactive mode with fixed positions | Existing nodes keep the positions the client sends; the new nodes are laid out as one block to the right of them | Guarantees no overlap and unchanged existing nodes |
| A9 query endpoint | `POST /graphs/:id/routes/query` with a body | **`GET`** with the query in the URL (`q`, `limit`, `maxHops`, `routeMode`). The server accepts up to 64 KB of headers and the UI's nginx up to 64 KB of request line, so even a 200-condition query (about 25 KB) fits. | Requested after the first delivery: the query is visible and shareable as a URL |
| A11 / seeding | (not specified) | `SEED_NAME` names the seeded graph (default: the file name) | The mounted file is called `graph.json` |
| A11 graph id | Content hash | Hash of the normalised graph **and only** the settings that change derived properties (`SINK_KINDS`, `SEVERITY_SCALE`). Ports, URLs and seed settings do not change it. | A regression found during manual verification: hashing the whole service config created a new graph on every config change |
| Pinned graphs | Seed is pinned | Storing an existing graph with `pinned: true` also **pins it** and removes its expiry | Otherwise a seed that already existed unpinned would expire |
| Test tooling | `pure-rand` 8, default Jest module handling | `pure-rand` 7.x; Jest transforms the ESM-only `cookie` package | Jest cannot load ESM-only packages |
| Dev script | `npm run dev` | `tools/dev.mjs`: Neo4j, Redis, DAL replicas and `dal-lb` in Docker; ingest, server (`:3001`) and Vite (`:5173`) run locally | As planned; the ingestion service is not published by the dev override because it runs locally |

### 12.3 Performance findings (not gated, per D6)

Measured on the development machine against the 1,000-node / 10,000-edge synthetic graph:

| Query | Typical time |
|---|---|
| Standard query (20 conditions), anchored on a start node, `maxHops` 3 | roughly 130–700 ms |
| Heavy query (70 conditions), same shape | roughly 160–1,100 ms |
| Set operation whose second operand is an unanchored "any node of kind X" rule | about 2.3–2.8 s (the engine must enumerate every route of up to 3 hops before ordering) |
| Graph view, cold (degree ranking + elk layout) / cached | about 1.0–1.2 s / about 5 ms |
| Schema, expand a "+N" stub | about 3 ms, about 60–110 ms |

The base plan's targets (100 ms standard, 500 ms heavy) are met for **anchored** queries on small result sets and **not** met for broad unanchored ones, because the number of simple paths grows exponentially with the hop limit. The guards (`maxHops`, route limit, the 5 s transaction limit → `504`) keep such queries from running away, and the schema-based anchoring (A4.6) keeps selective ones fast. Closing the gap for broad queries would need precomputed route indexes, which the plan deliberately left out of this iteration.

**After A4.8 (sub-routes removed by default).** Anchored queries are unchanged (about 130 ms median for the standard query, about 200 ms for the heavy one). The unanchored operand of the set-operation test went from about 2.3–2.8 s to about 3.4 s, because the search now collects up to 10,000 routes before removing sub-routes; it stays below the 5 s time limit. The filter itself handles 10,000 routes of up to 40 nodes in about 40 ms.

### 12.4 Known limitations

- Rules on fields inside list items (for example `vulnerabilities`) cannot be tied to the same element (A3.5, accepted).
- The sample file has no route from a public service to a vulnerable service or datastore (`docs/json-review.md` D5): the combined preset correctly returns "no routes" on it. The crafted security fixture in `tests/fixtures` covers the non-empty case.
- Neo4j Community and Redis are single instances; only the DAL tier is load balanced.
- Everything runs without authentication, as specified.
