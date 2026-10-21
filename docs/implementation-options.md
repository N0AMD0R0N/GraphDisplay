# Implementation Options

Options for building the system described in `BasePlan.md`, grouped by function. Each category has a comparison table, and ★ marks the recommended option for this project's constraints. A summary of the recommended stack and the open decisions is at the end.

---

## 0. Plan constraints that drive the choices

| Constraint (from the plan) | Effect on tool choice |
|---|---|
| **Cypher** is the query language | Either a Cypher-capable graph DB or a home-made Cypher engine. This is the main backend decision (§A3). |
| Results are **arrays of Route objects**, sorted longest-first | Path queries (`MATCH p=…`) are central. The engine must return ordered paths efficiently. |
| **Union / intersection / difference** | Cypher only has `UNION`. Intersection and difference need subqueries or composition at the API level (§A5). |
| Scale: **1,000 nodes / 10,000 edges**, reads matter more than writes | Any graph DB handles this easily, **but** enumerating all simple paths doesn't scale. A **hop limit and a route-count limit** are required whatever engine is chosen. |
| Multiple graphs, quick switching, cache TTL of 1 day | Graphs need a `graphId` namespace in the store, plus an in-process LRU+TTL cache. |
| Shared TypeScript interfaces for the API | A monorepo with a `shared` package. |
| React (latest stable), **react-flow**, **styled-components** | Fixed: React 19.x, `@xyflow/react` v12, styled-components v6. |
| Automatic **left→right layout**, a **200-node cap** with expand indicators | Layered layout engine. Incremental layout on expand (§B5). |
| **Jest**, `npm test` / `npm run test:bail`, formatted JSON report | Jest + TS transform + a custom reporter (§D). |

---

## Overall architecture

```
┌──────────────── client (Vite + React 19) ──────────────────┐
│ Query panel (builder ⇄ raw Cypher)   Graph canvas (@xyflow) │
│ TanStack Query ── fetch ── shared types (zod)               │
└──────────────────────────────┬──────────────────────────────┘
                               │ REST/JSON
┌──────────────────────────────▼──────────────────────────────┐
│ server (Node LTS + Fastify, TS)                              │
│  ├─ ingest:  parse → validate → normalise → warnings         │
│  ├─ schema:  property discovery, kind→colour map             │
│  ├─ query:   set-op tree → Cypher leaves → combine routes    │
│  ├─ view:    degree ranking, 200-node cap, overflow stubs    │
│  ├─ layout:  elkjs (full-graph layout, cached)               │
│  └─ cache:   lru-cache (graph model, schema, layouts, results)│
└──────────────────────────────┬──────────────────────────────┘
                               │ Bolt (neo4j-driver)
                    ┌──────────▼──────────┐
                    │ Graph DB (Neo4j)    │  nodes :Node {graphId, name, kind, …}
                    │ Docker container    │  rels  :CALLS {graphId}
                    └─────────────────────┘
```

---

# A. Backend: functional options

### A1. Repository structure and shared types

| Option | Pros | Cons | Fit |
|---|---|---|---|
| ★ **npm workspaces** monorepo: `/client`, `/server`, `/shared`, `/tests` | Built into npm, no extra tooling. `shared` is imported as a package by both sides. One `npm test` at the root. | Needs a TS project-references or path-alias setup. | High |
| pnpm / Turborepo / Nx | Faster installs, task caching, graph-aware builds | Extra tool to learn. Overkill for 3 packages. | Medium |
| Single package, `src/client` + `src/server` | Simplest | Client and server dependencies mixed. Harder to keep browser code free of Node code. | Low |

**Shared contract style**

| Option | Pros | Cons | Fit |
|---|---|---|---|
| ★ **zod schemas in `/shared`**, with types from `z.infer` | One source for runtime validation **and** TS types on both sides. Also validates the uploaded graph JSON. | Runtime dependency on the client (small). | High |
| Plain TS interfaces only | Zero runtime cost | No runtime validation. Server schemas duplicated by hand. | Low |
| OpenAPI-first (generate types) | Language-neutral API docs | Extra codegen step. Heavier than needed. | Medium (later, if external consumers appear) |
| ts-rest / tRPC | End-to-end typed calls | tRPC isn't REST (the plan requires REST). ts-rest adds a layer. | Medium |

### A2. HTTP framework

| Option | Pros | Cons | Fit |
|---|---|---|---|
| ★ **Fastify 5** | Fast. Schema-based validation (zod type provider). `app.inject()` for HTTP tests without a network port. Good TS support. | Plugin/encapsulation model to learn | High |
| Express 5 | Most familiar, huge ecosystem | Slower. Validation and typing must be added by hand. Tests need supertest. | Medium |
| NestJS | Structure, DI, decorators, OpenAPI module | Heavy for ~6 endpoints. Lots of boilerplate. | Low |
| Hono | Tiny, fast, edge-ready, good typing | Smaller Node ecosystem. Less common for long-running servers with DB drivers. | Medium |

### A3. Graph store and Cypher engine (the key decision)

| Option | Cypher fidelity | Ops / runtime | Perf at 1k/10k | Multi-graph | License | Fit |
|---|---|---|---|---|---|---|
| ★ **Neo4j Community** (Docker) | **Reference implementation.** Users' Cypher knowledge carries over 1:1. Best tooling (editor, linter). | JVM container, about 1 GB RAM. `npm start` must start it. | Easily within targets, given a hop limit | Community = one user DB → use a `graphId` property + index | GPLv3 (server only; driver is Apache-2.0) | **High** |
| Memgraph (Docker) | High (openCypher + extensions). Some dialect differences. | C++, in-memory, light container | Excellent; built for in-memory reads | Multi-tenancy is Enterprise → `graphId` property | BSL 1.1 (community) | High (good alternative if Neo4j's footprint is a problem) |
| FalkorDB (Redis module) | Partial openCypher subset | Redis container | Very fast (sparse matrices) | **Native: one graph per key** (fits graph switching well) | SSPLv1 | Medium (subset gaps in path functions) |
| Apache AGE (PostgreSQL extension) | Cypher wrapped in SQL (`SELECT * FROM cypher(...)`) | Postgres + extension build | Adequate | Native named graphs | Apache-2.0 | Low–Medium (awkward syntax, weaker path support) |
| Embedded (Kùzu) | Good Cypher, in-process, npm package | No container | Very good | Separate DB dirs | MIT | **Low**: the project was archived in late 2025 (verify current status). Risky to adopt. |
| Home-made: in-memory JS graph + Cypher-**subset** parser (e.g. reuse Neo4j's open-source Cypher grammar/parser) | Only what we implement. Anything else is rejected. | No DB at all. `npm start` is trivial. | Fastest for our own predicates | Trivial (a Map per graph) | — | Medium: full control and zero ops, but large effort, and "Cypher" that isn't real Cypher surprises users |

**Recommendation:** Neo4j Community in Docker as the store and Cypher executor. The Node server keeps a **parsed in-memory model** of each graph alongside it, for validation, schema discovery, colours, degree ranking and overflow stubs. With this hybrid, everything except user queries runs without DB round-trips.

**DB access layer**

| Option | Notes | Fit |
|---|---|---|
| ★ **`neo4j-driver`** (official) | Bolt protocol. Also works with Memgraph, so the engine stays swappable. `session.executeRead()` gives read-only transactions for user queries. | High |
| OGMs (neogma, neode) | Model layer over the driver. Little value, since we mostly run raw Cypher. | Low |
| `@neo4j/graphql` | Generates a GraphQL API. The plan requires REST + Cypher. | Low |

**Data model in the DB**

```cypher
(:Node {graphId, id, name, kind, incomplete, props...})-[:CALLS {graphId, id}]->(:Node)
CREATE CONSTRAINT node_key IF NOT EXISTS FOR (n:Node) REQUIRE (n.graphId, n.name) IS UNIQUE;
```
Options for nested properties (`vulnerabilities[]`, `metadata{}`):

| Option | Pros | Cons | Fit |
|---|---|---|---|
| ★ Flatten scalars onto the node (`metadata_cloud`, `vuln_count`, `vuln_max_severity`, `vuln_severities: [...]`) **and** keep the original object as a JSON string property (`raw`) | Queryable in plain Cypher. Originals returned untouched. | Flattening rules must be documented in `/schema` | High |
| Child nodes `(:Node)-[:HAS_VULN]->(:Vulnerability)` | Fully queryable. Natural graph modelling. | Route queries must ignore these relationships. More complex patterns for users. | Medium |
| Store the nested object as a JSON string only | Simplest | Not queryable from Cypher | Low |

### A4. Route semantics in Cypher

| Need | Implementation option |
|---|---|
| Directed simple path | `MATCH p=(a:Node {graphId:$g})-[:CALLS*1..$maxHops]->(b)`. Cypher already forbids repeated **relationships**. Repeated **nodes** must be excluded with `WHERE all(n IN nodes(p) WHERE single(m IN nodes(p) WHERE m = n))`, or with GQL path modes if the chosen Neo4j version supports them. |
| Maximal routes (source → sink) | Add `WHERE NOT ()-[:CALLS]->(a) AND NOT (b)-[:CALLS]->()` |
| Single-node routes | `MATCH (a:Node {graphId:$g}) WHERE …` returned as length-1 routes |
| Cycle marker (`…D → A`) | `OPTIONAL MATCH (last(nodes(p)))-[:CALLS]->(c) WHERE c IN nodes(p)` → `closesTo: c.id` |
| Longest-first sort | `ORDER BY length(p) DESC, [n IN nodes(p) | n.name]` (deterministic tie-break) |
| Explosion guard | Always inject `$maxHops` and `LIMIT $maxRoutes + 1` (to detect truncation), plus a server-side transaction timeout |

**Who writes these patterns?**

| Option | Pros | Cons | Fit |
|---|---|---|---|
| ★ Builder-generated Cypher **plus** a server-side **wrapper** that enforces `graphId`, the hop limit, and `LIMIT` on raw user queries | Safe defaults, and power users keep full Cypher | Wrapping arbitrary Cypher is tricky. Requiring raw queries to `RETURN p` (a path) keeps it tractable. | High |
| Raw Cypher passed through as-is | Simplest | Users can forget the graph filter or the hop limit and hang the DB | Low |

### A5. Set operations (union / intersection / difference)

| Option | Pros | Cons | Fit |
|---|---|---|---|
| ★ **API-level set tree**: `{op:"union"\|"intersect"\|"except", args:[leaf…]}` where each leaf is a Cypher query returning paths. The server runs the leaves in parallel and combines them by canonical route key (ordered node ids). | Simple, exact semantics. Any number of operands. The builder maps to it directly. The leaves can run concurrently. | Each leaf is bounded by `maxRoutes`, so a difference over a truncated leaf is approximate (flag it in `warnings`) | High |
| Pure Cypher: `UNION`, plus `WHERE [NOT] EXISTS { … }` subqueries for intersect/except | One DB round-trip. Full engine optimisation. | Hard to generate and hard for users to write. Intersection of *paths* by subquery is verbose. | Medium |
| Mixed: union in Cypher, intersect/except at the API level | — | Two mechanisms to maintain | Low |

### A6. Ingestion, parsing and validation

| Option | Pros | Cons | Fit |
|---|---|---|---|
| ★ **zod 4** (shared schema) + a custom normalisation pass | Union `to: string \| string[]` is natural. Detailed error paths for 400/422 responses. Shared with the client. | Custom semantic checks (duplicates, missing nodes, cycles) are still hand-written, which is unavoidable | High |
| TypeBox + Ajv | JSON-Schema native. Fastest validation. Fastify-native. | Types are less ergonomic. Two schema styles if the client also validates. | Medium |
| Valibot | Smallest bundle | Smaller ecosystem | Medium |

Pipeline (independent of tool choice): `parse JSON → schema validate → trim/normalise enum fields → assign ids → coerce `to` → detect duplicate names (error) → create placeholder nodes for missing targets (warning) → detect cycles (Tarjan SCC; warning + list) → compute degree → write to DB in one transaction with UNWIND batches`.

Cycle detection and degree run in the in-memory model (O(V+E)). There's no need to ask the DB.

### A7. Caching

| Option | Pros | Cons | Fit |
|---|---|---|---|
| ★ **`lru-cache`** (in-process; `max` + `ttl`, default 1 day, configurable) | No infrastructure. Per-entry TTL. Size-based eviction. | Lost on restart (fine: rebuilt from the DB). Not shared between server instances. | High |
| Redis / Valkey | Shared across instances. Survives restarts. | Another container. Serialisation cost for large layouts. | Low (now), Medium (multi-instance later) |
| Rely only on the DB | Nothing to build | Schema, layouts and colour maps would be recomputed per request | Low |

What to cache, keyed by `graphId`: parsed model, schema + colour map, full-graph layout, ranked 200-node views, and query results keyed by a hash of the normalised query.

### A8. Kind → colour mapping (served from the backend)

| Option | Pros | Cons | Fit |
|---|---|---|---|
| ★ Fixed map for known kinds (`service`, `rds`, `sqs`, `unknown`…) **plus** a deterministic hash into a categorical palette for unseen kinds | Same colour everywhere, across graphs and restarts. Readable defaults. | Hash collisions are possible once there are more kinds than palette colours | High |
| First-seen order into a palette, persisted | No collisions until the palette runs out | Order-dependent. Must be persisted. Differs between graphs. | Medium |
| Hash → HSL hue | Unlimited kinds | Adjacent hues can look alike. Contrast isn't guaranteed. | Low |

### A9. Endpoint sketch (REST, no versioning per the plan)

| Method & path | Purpose |
|---|---|
| `POST /graphs` | Upload graph JSON, per the plan: **`201`** + `{graphId, status:"complete"}` when the graph is valid; **`207`** with a body that carries a `422` sub-status and a message per derivable problem (e.g. `{graphId, status:"incomplete", results:[{status:422, code:"MISSING_NODE", target:"assurance-service", message:"…"}]}`) when missing nodes/edges were derived; **`401`** for an invalid format. Note: `401` normally means "unauthenticated", and clients or proxies may treat it as an auth prompt. Consider `400` instead; it's a one-line change if you choose to. |
| `GET /graphs` / `GET /graphs/:id` | List graphs; graph metadata, warnings |
| `GET /graphs/:id/view?focus=&limit=200` | Ranked node-capped view + overflow stubs + layout positions |
| `GET /graphs/:id/schema` | Kinds, colour map, queryable property paths and observed values |
| `POST /graphs/:id/routes/query` | Body: set tree of builder leaves or raw Cypher → `{routes, total, truncated, warnings}` |
| `GET /graphs/:id/nodes/:nodeId/neighborhood` | Data for the "load connected paths" expand indicator |
| *(reserved)* `POST /graphs/:id/links` | Future: connect segmented graphs |

---

# B. Frontend: functional options

### B1. Build tooling

| Option | Pros | Cons | Fit |
|---|---|---|---|
| ★ **Vite** (React + SWC plugin) | Fast dev server and HMR. Standard for React SPAs. | Jest needs a separate transform, since Jest doesn't use the Vite pipeline | High |
| Next.js | SSR, routing | Unneeded here (single-page tool). Adds its own server alongside Fastify. | Low |
| Create React App | — | Deprecated | None |

### B2. Server state and UI state

| Option | Pros | Cons | Fit |
|---|---|---|---|
| ★ **TanStack Query** (server data) + **Zustand** (UI state: selected route, highlight mode, open tooltip, expanded nodes) | Caching, dedupe and loading states for free. Zustand is tiny and avoids unnecessary re-renders of the canvas. | Two libraries | High |
| Redux Toolkit + RTK Query | One integrated solution, dev-tools | More boilerplate | Medium |
| React Context + `fetch` | No dependencies | Re-render storms on a 200-node canvas. Hand-written caching and loading states. | Low |

### B3. Query builder (generated from `/schema`)

| Option | Pros | Cons | Fit |
|---|---|---|---|
| ★ **react-querybuilder** | Headless-friendly (easy to style with styled-components). Nested groups. Custom fields/operators/value editors. TS-first. | No Cypher exporter: we write a formatter (the rule tree → Cypher `WHERE` + set tree), which is a contained piece of work | High |
| react-awesome-query-builder | Rich widgets, many exporters | Heavy. Tied to AntD/MUI widget sets, which clash with styled-components. No Cypher exporter either. | Low–Medium |
| Custom form | Exactly the UX we want (position selector: first/last/any/all node) | Most work. Must handle nesting and validation ourselves. | Medium |

Builder model to support: **position** (`first` / `last` / `any` / `all` / `none` node) × **property path** (from `/schema`) × **operator** × **value**, plus route **length** (min/max), grouped by AND/OR, and combined at the top level by union/intersect/except.

### B4. Raw Cypher editor

| Option | Pros | Cons | Fit |
|---|---|---|---|
| ★ **CodeMirror 6 + `@neo4j-cypher/react-codemirror`** | Neo4j's own Cypher syntax highlighting, autocompletion (can be fed labels and properties from `/schema`) and linting. Light. | Assumes the Neo4j dialect (fine if Neo4j is chosen) | High |
| Monaco + Cypher grammar | VS Code-grade editor | Heavy bundle. Cypher language support must be wired in by hand. | Medium |
| Plain `<textarea>` | Trivial | No help for the user. Errors only show after running the query. | Low |

The builder and the raw editor should be **two tabs of one panel**. Builder → raw is a one-way export (the generated Cypher opens in the editor). Raw → builder isn't supported.

### B5. Automatic layout (left → right)

| Option | Quality | Speed (200 visible / 1k total) | Incremental (keep positions on expand) | Where it runs | Fit |
|---|---|---|---|---|---|
| ★ **elkjs** (`layered`, direction RIGHT) | Best layered layout: fewer crossings, port-aware, handles cycles | Good. Runs in a Web Worker or in Node. | Partial: interactive strategies can respect existing node order | **Both** (same lib on server and client) | High |
| @dagrejs/dagre | Good, classic Sugiyama | Very fast, synchronous | No (full re-layout) | Both | Medium (simplest to start with) |
| d3-dag (Sugiyama) | Good | Slower on dense graphs | No | Both | Low–Medium |
| Force-directed (d3-force) | Organic. Doesn't respect left→right flow. | Iterative | Natural | Client | Low (violates the L→R requirement) |

**Where to compute it:**

| Option | Pros | Cons | Fit |
|---|---|---|---|
| ★ **Server-side** for full-graph views (cached per graph+view), **client-side** for single routes (trivial: a straight line) | Same layout for every client. Computed once and cached (matches the plan's cache). The client stays light. | Expanding requires a server round-trip for new positions | High |
| Client-only (elkjs in a Web Worker) | No server work. Instant re-layout for local changes. | Every client recomputes. Large initial graphs block the worker. | Medium |

### B6. react-flow integration notes (fixed library)
- Package: `@xyflow/react` v12. Use **custom node types** (`serviceNode`, `infraNode`, `placeholderNode`, `overflowStub`, `cycleMarker`), each wrapped in `React.memo`.
- Keep `nodes`/`edges` arrays stable (memoised). Apply highlight by toggling `className`/`data.dimmed`, not by rebuilding arrays.
- Use the built-ins: `<MiniMap>`, `<Controls>`, `<Background>`, `<NodeToolbar>` (for the tooltip, §C8), `fitView` on result change.
- styled-components: theme via `ThemeProvider` (the colour map from `/schema` goes into the theme). Use **transient props** (`$kind`, `$dimmed`) so styling props don't leak into the DOM. Note that styled-components is in maintenance mode: it's stable for this project, but avoid relying on new features.

---

# C. UI / UX: visual options

### C1. Screen layout (the plan wants as much area as possible for the graph)

| Option | Graph area | Query editing comfort | Fit |
|---|---|---|---|
| ★ **Collapsible left drawer** (resizable; collapses to a thin icon rail) + a slim top bar (graph picker, result counter, route stepper) | Large when collapsed, ~70% when open | Good: room for a nested builder and the editor | High |
| Floating overlay panel over the canvas (draggable, semi-transparent) | ~100% | Medium: covers part of the graph and needs to be moved around | Medium |
| Top query bar (single line, expandable) | ~90% | Poor for nested builder trees | Low–Medium |
| Bottom drawer (like browser dev-tools) | ~65% when open | Good for the raw editor, awkward for the builder | Medium |

### C2. Node visual encoding

| Option | Kind (required colour) | Extra signals (public, vulnerabilities, incomplete) | Readability at 200 nodes | Fit |
|---|---|---|---|---|
| ★ **Rounded card**: kind-coloured header/left bar + kind icon + name; corner badges: 🌐 public, ⚠ count tinted by max severity; dashed border = incomplete/placeholder | Clear | Clear and scannable | Good at normal zoom; at low zoom, fall back to a coloured dot + name | High |
| Colour fill + shape per kind (rectangle = service, cylinder = DB, parallelogram = queue) | Very clear (redundant encoding) | Badges still needed | Good | High (combine with ★ as a refinement) |
| Plain coloured circle + label | OK | Hard to show extras | Best density | Low |

Use zoom-dependent detail: hide badges and the icon below ~0.5 zoom (react-flow's `useStore` zoom selector).

### C3. Edges

| Option | Pros | Cons | Fit |
|---|---|---|---|
| ★ **Smoothstep** (orthogonal) edges with arrowheads, neutral colour; route edges thicker + accent colour + optional animated dash | Matches the L→R layered layout; direction obvious | Can overlap in dense areas | High |
| Bezier | Softer look, fewer visual overlaps | Direction less obvious when edges cross | Medium |
| Straight | Simplest | Many crossings in layered layouts | Low |

### C4. Cycle indicator (route `A→B→C→D→(A)`)

| Option | Pros | Cons | Fit |
|---|---|---|---|
| ★ **Ghost marker node**: a small dashed circle with ↺ and the target name ("↺ A"), coloured like A's kind; a dashed edge from D to it; clicking it pans to and highlights A | Matches the plan ("distinct from a node, clearly references A"). Keeps the route a straight line. | One extra pseudo-node per cyclic route | High |
| Curved back-edge from D to the real A | Shows the true topology | Clutters the layout. Hard to distinguish from a normal edge. | Medium |
| Badge on D ("↺ A") | Most compact | Easy to miss. Not clickable as a "node-like" thing. | Low–Medium |

### C5. Route selector (first route shown, selector for others, count indicator)

| Option | Pros | Cons | Fit |
|---|---|---|---|
| ★ **Stepper in the top bar**: `◀ 3 / 128 ▶` + "(truncated)" flag, **plus** an expandable list (each row: length, start → end names, mini kind-colour strip) | Fast keyboard browsing (←/→). The list allows jumping. Small footprint. | List virtualisation needed for long lists | High |
| Dropdown `<select>` of routes | Simple | Unreadable labels for long routes. Poor for 100+ items. | Low |
| Side list only | Rich overview | Takes graph area | Medium |
| Slider | Compact | Imprecise. No preview of the route. | Low |

### C6. Highlight mode (route selected while the whole graph is shown)

| Option | Pros | Cons | Fit |
|---|---|---|---|
| ★ **Dim the rest**: non-route nodes/edges at ~15% opacity; route edges thicker + accent + animated; route nodes keep full colour | Keeps context. Standard and recognisable. | Low-contrast on some themes (tune per theme) | High |
| Greyscale the rest | Strong focus while keeping shapes | Loses kind colour context | Medium |
| Hide the rest (filter) | Maximum focus | Loses context (this is the "route only" view the plan already covers) | Use as a separate toggle |

A toggle in the top bar switches between **Route only** and **Whole graph + highlight**.

### C7. Overflow indicators (200-node cap)

| Option | Pros | Cons | Fit |
|---|---|---|---|
| ★ **"+N" stub node** attached by a dashed edge to the node that has hidden neighbours; click → load neighbourhood (pinned existing positions, new nodes laid out to the right) | Clear affordance. Shows *how many* are hidden. Matches the plan's "indicator connected to the node". | Extra pseudo-nodes | High |
| Badge on the node itself ("+12") | No extra elements | Less discoverable. Conflicts with the vulnerability badge. | Medium |
| Collapsed group node (react-flow sub-flow) | Can show a preview of the hidden kinds | Complex. Interacts badly with layered layout. | Low |

For **disconnected groups** not shown (the second indicator in the plan): a fixed **"N hidden components"** chip in a canvas corner that opens a list of components (size, top node). Selecting one loads it.

### C8. Node details tooltip (click to open, stays until clicked away)

| Option | Pros | Cons | Fit |
|---|---|---|---|
| ★ **react-flow `<NodeToolbar>`** with a styled card (all properties, vulnerability list collapsible, "copy JSON" button) | Anchored to the node and follows pan/zoom with no extra library. Positioning built in. | Long content needs a max-height + scroll | High |
| floating-ui popover | Collision-aware positioning, flipping | Extra dependency. Needs manual sync with the canvas transform. | Medium |
| Side details panel | Room for long content (vulnerability messages) | Takes graph area. It's a panel, not a tooltip, unlike the plan. | Medium (possible "expand" target from the tooltip) |

Behaviour: one open at a time; close on pane click, `Esc`, or selecting another node.

### C9. Empty, loading and error states

| State | Option |
|---|---|
| ★ Empty result | Centred overlay on the dimmed graph: "No routes match", the query summary, and hints (e.g. "no public node reaches a vulnerable service in this graph"). The graph stays visible underneath. |
| Loading | Thin progress bar under the top bar. The canvas stays interactive (TanStack Query `isFetching`). |
| Query error | Inline in the query panel: Cypher errors mapped to line and column in the CodeMirror lint gutter. Builder errors shown next to the rule. |
| Graph warnings (incomplete, cycles) | Warning chip in the top bar → list. Placeholder nodes drawn dashed. |

### C10. Theme

| Option | Pros | Cons | Fit |
|---|---|---|---|
| ★ Light + dark themes via styled-components `ThemeProvider`, following `prefers-color-scheme` with a manual toggle; kind colours from the backend map, checked for contrast in both themes | Graph tools are often used for long sessions. The backend colour map stays authoritative. | The palette must work on both backgrounds | High |
| Light only | Less work | Worse for long sessions | Medium |

---

# D. Testing options (Jest, per the plan)

| Concern | Options | ★ Recommendation |
|---|---|---|
| TS transform for Jest | `ts-jest` (type-checks, slower) · `@swc/jest` (fast, no type-check) · `babel-jest` | **`@swc/jest`** + a separate `tsc --noEmit` step in `npm test` (fast tests, type errors still fail the run) |
| API tests | Fastify `app.inject()` · supertest (real HTTP) | **`app.inject()`**: no port, deterministic, fast |
| DB in tests | Testcontainers (`@testcontainers/neo4j`, a fresh DB per run) · shared docker-compose instance · mocked driver | **Testcontainers** for API/integration (static, isolated, seeded from fixtures). Parser and set-op unit tests use the in-memory model, no DB. |
| `npm run test:bail` | `jest --bail=1` · custom circus handler | Note: Jest's `--bail` stops after the first failed **test file**; other tests in that file still run. For true "stop at the first failing test", use `--bail=1 --runInBand` plus a small custom `jest-circus` test environment that skips the remaining tests after the first failure. |
| JSON report | `--json --outputFile` (raw Jest format) · `jest-junit` (XML) · custom reporter | **Custom reporter** (~50 lines) writing a formatted `reports/test-report.<timestamp>.json` with suite, test, status, duration, failure message and diff. Note: the current `.gitignore` pattern `report.N.N.N.N.json` matches Node diagnostic reports, not these files, so add `reports/` to `.gitignore`. |
| Perf tests | Record `inject()` timings per query class (standard: 20 conditions, heavy: 70) on generated graphs | Record in the report, with no threshold failures for now, per the plan |
| Synthetic generator | Custom generator with a seeded PRNG (`pure-rand`) · graphology-generators | **Custom + seeded PRNG**: emits the *input JSON format* (including quirks: string `to`, missing targets, cycles), scaled up to 1k nodes / 10k edges; the same seed gives the same file, which keeps tests static |
| Fixtures | `tests/fixtures/*.json` + `*.expected.json` | The sample file, edge-case graphs (cycle, self-loop, duplicate name → 422, missing node → warning), and hand-verified expected routes |

---

# E. Recommended stack: summary

| Layer | Choice |
|---|---|
| Repo | npm workspaces: `client`, `server`, `shared`, `tests` · TypeScript everywhere · Node LTS |
| Contracts | zod 4 schemas in `shared` (graph input, query tree, Route, QueryResult) |
| API | Fastify 5 + zod type provider |
| Graph DB / Cypher | Neo4j Community (Docker), with `neo4j-driver` read-only sessions for user queries; Memgraph as the fallback alternative |
| In-memory model | Parsed graph per `graphId`: validation, cycles (Tarjan), degree ranking, schema, colours |
| Set ops | API-level union/intersect/except tree over Cypher leaves, combined by canonical route key |
| Cache | `lru-cache` (TTL default 1 day, configurable) |
| Layout | elkjs `layered` RIGHT: server-side for graph views (cached), client-side for single routes |
| Client | Vite + React 19 + `@xyflow/react` 12 + styled-components 6 · TanStack Query + Zustand |
| Query UI | react-querybuilder (custom Cypher formatter) + CodeMirror 6 with `@neo4j-cypher/react-codemirror` |
| Tests | Jest + `@swc/jest` · `app.inject()` · Testcontainers · custom JSON reporter · seeded synthetic generator |
| Start | `npm start` → `docker compose up -d neo4j` → server loads `train-ticket-be.json` → client dev server |

## Decisions still needed from you

1. **Docker dependency.** Is requiring Docker (Desktop) for `npm start` and the integration tests acceptable? If not, the home-made in-memory engine with a Cypher subset becomes the realistic option.
2. **Neo4j vs Memgraph.** Fidelity and tooling (Neo4j) vs a lighter, faster in-memory engine (Memgraph).
3. **Route enumeration bounds.** Default `maxHops` and `maxRoutes` values, and whether the default is maximal (source → sink) routes or any sub-path. This sets the query wrapper and the "total / truncated" UI.
4. **Raw Cypher contract.** Must raw queries `RETURN` paths (`p`)? This decides how strictly the server can wrap them.
5. **Layout location.** Server-cached (consistent) or client-only (simpler server).
