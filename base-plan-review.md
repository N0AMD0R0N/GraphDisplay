# Base Plan Review

Review of `BasePlan.md`: what it is trying to achieve, what it leaves undefined, and changes worth considering before design starts.

---

## 1. Intention (as understood)

Build a **system-graph explorer** with two faces:

1. **Backend / API**: loads a JSON description of a software system (services, databases, queues, … as nodes; calls between them as directed edges). It exposes REST "search" routes. Each route returns a **subset of the original graph** (same shape as the input JSON), so the UI can render it directly.
2. **Frontend / UI**: a React + react-flow app that shows the full graph or just the subgraph a query returns.

The core concept is the **route**: a chain of elements from one node to another (e.g. `frontend → admin-basic-info-service → station-service`). Queries filter routes by:
- **properties of elements in the route** (e.g. "the first element is publicly exposed", "some element has a high-severity vulnerability", "the last element is a DB"),
- **route length** (number of elements),
- **set composition** of the above (union / intersection / difference).

The sample data (`train-ticket-be.json`) has `publicExposed`, `vulnerabilities`, `kind: rds|sqs`. That strongly suggests the real use case is **security / attack-path analysis**, e.g. "show every route from a public entry point to a database that passes through a vulnerable service". The design should be tuned for this kind of query even though the plan only gives a generic "red color" example.

Non-functional goals: reads matter more than writes, latency targets of about 100 ms for a standard query and about 500 ms for a heavy one, and a deterministic test suite with two run modes.

---

## 2. Gaps & undefined areas

### 2.1 Definition of a "route" (most important gap)
The plan never defines exactly what a route is. Each reading below gives very different results and costs:

| Question | Options | Impact |
|---|---|---|
| Directed or undirected? | Follow edge direction (`from` calls `to`) / ignore direction | Undirected breaks the meaning ("who can reach whom") and makes the number of paths explode. |
| Which paths count? | (a) only **maximal** paths (a source with no inbound edges to a sink with no outbound edges); (b) **every** simple path between any two nodes; (c) paths between user-specified endpoints | On the sample: (a) is **217** paths, (b) is **440** paths. On larger graphs (b) grows exponentially. |
| Single-node route? | Is an isolated node (e.g. `gateway-service`) a route of length 1? | Decides whether isolated nodes ever show up in results. |
| Cycles? | Sample is acyclic, but real systems often aren't (A↔B calls) | Need "simple paths only" (no repeated node) and a depth cap. Otherwise enumeration may never finish. |

### 2.2 Query model / language
- **No syntax is defined.** It's unclear how a client expresses "first element is red AND length ≤ 4, UNION routes ending in an `rds`". Query-string params can't express nested set operations cleanly.
- **Positional predicates are only hinted at** ("first element"). The plan also needs *last*, *any*, *all*, *none*, and maybe *at index n*.
- **Property access isn't defined** for nested or array data: `metadata.cloud`, `vulnerabilities[].severity`, existence checks (`has vulnerabilities`), missing keys (`publicExposed` absent on the DB nodes).
- **Operators aren't defined**: equality only? `in`, `exists`, `contains`, numeric/ordinal comparison (severity `low < medium < high < critical`), regex/prefix on names?
- **"Number of elements" is ambiguous**: nodes vs edges, and exact vs min/max range.
- **Edge predicates**: edges carry no properties today. Should querying by edge be supported later (protocol, sync/async)?

### 2.3 Set-operation semantics
- Do union/intersection/difference operate on **sets of routes** or on the **resulting subgraphs (node/edge sets)**? The results differ. For example, *routes A minus routes B* can still share every node and edge with B. A subgraph difference can leave dangling edges or orphaned nodes.
- Does the operator order or precedence need to be defined, or is it always an explicit tree?

### 2.4 Result shape
- "Sub-groups of the original JSON graph": is the result **one merged subgraph** (union of all matched routes), or a **list of routes**, or both?
- Should node and edge objects in the result keep **all original properties**, or only the ids?
- Should edges in the result keep the grouped `{from, to: [...]}` form of the input, or be normalised?
- Pagination or limits for huge result sets? Should the result include a count?

### 2.5 Input lifecycle
- Is it one fixed file loaded at startup, a file chosen in the UI, or upload via the API? Can there be multiple graphs?
- Can the graph change at runtime (hot reload)? This decides whether precomputation is cheap or must be incremental.
- **Validation & error policy is missing.** The sample already contains bad data: edges to an undefined node and a non-array `to` (see `json-review.md`). The plan should state whether bad data is rejected, auto-fixed, or loaded with warnings.

### 2.6 Performance targets
- "Standard" vs "heavy" query aren't defined. Neither are the target graph size (46 nodes here, but what is the design limit?), the hardware, or whether network and rendering time count.
- The DB / search-engine suggestion is open-ended. For the sample size an external store is **overkill** and adds latency (IPC/network) plus operational complexity. The plan should name the expected scale before committing to Elasticsearch, Neo4j, etc.
- There is no plan for *how* the latency targets are measured or enforced, e.g. a perf test with thresholds.

### 2.7 Technology stack (partially specified)
- **Backend language and framework are not stated.** Node/Express, Fastify, NestJS? TypeScript or JS?
- "Latest stable React" is React 19.x today. Pin the exact version.
- **react-flow** is now published as **`@xyflow/react`** (v12+); the old `reactflow` package is legacy. The plan should name the new package.
- **styled-components**: the maintainers announced maintenance mode in 2025. It still works with React 19 (v6.1+), but it's worth acknowledging the risk. Keep it, since it's a stated requirement.
- **Layout**: the JSON has no x/y positions, and react-flow does no automatic layout. A layout engine is required (`dagre` or `elkjs`) and isn't mentioned.
- Build tool (Vite?), monorepo layout (client/server/shared), Node version.

### 2.8 UI requirements (barely specified)
- How does a user build a query: a form/query builder, a raw JSON editor, or saved presets?
- Is the result **filtered** (show only the subgraph) or **highlighted** (full graph with matches emphasised and the rest dimmed)? The plan says "present only", but highlighting is usually more useful for context.
- Visual encoding: node shape or colour by `kind`, badges for `publicExposed` and vulnerabilities, a details panel on click, a legend.
- Listing and stepping through individual routes in a result.
- Behaviour for an empty result or an error.

### 2.9 Testing
- "Tests should be static (no back and forth between the tests and the model)": the meaning is unclear. Most likely it means *deterministic, fixture-based tests whose expectations are hard-coded, not generated or adjusted by an AI agent during the run*. Spell this out.
- No test runner is named (Vitest fits Vite + React; Jest is the alternative).
- The two modes need concrete commands, e.g. `npm test` (run all and write a report) and `npm run test:bail` (stop at the first failure).
- No scope is given: unit (parser, query engine), API (HTTP contract), performance, UI component tests? E2E?
- "Log result": to the console, a file (JSON/JUnit), or both? `.gitignore` already ignores `report.*.json`, which suggests a file report is expected.

### 2.10 Missing non-functional items
- API versioning, error format, input limits (query depth or size, so a heavy query can't DoS the server).
- CORS (the UI and API may run on different ports in development).
- Auth: probably out of scope, but say so.
- Logging and observability for query timing.
- How to run: README instructions, Docker?

### 2.11 Minor
- The README's "Development Steps" says the plan elaborates on edge cases, but the plan contains none yet.

---

## 3. Suggested changes (optional)

### 3.1 Pin down the route definition
> **Route** = a directed, simple (no repeated node) path following edge direction.
> Default enumeration = **maximal paths**: from every *entry* node (in-degree 0, **or** `publicExposed: true`) to every *terminal* node (out-degree 0), plus isolated nodes as length-1 routes.
> Optional `from` / `to` endpoint constraints override the defaults.
> A global `maxDepth` (e.g. 12) guards against cycles and blow-ups.

### 3.2 Define a JSON query AST, sent via `POST`
```jsonc
POST /api/v1/routes/query
{
  "query": {
    "op": "difference",
    "args": [
      { "op": "and", "args": [
          { "position": "first", "where": { "publicExposed": true } },
          { "position": "any",   "where": { "vulnerabilities.severity": { "in": ["high","critical"] } } },
          { "length": { "min": 2, "max": 6 } }
      ]},
      { "position": "last", "where": { "kind": "sqs" } }
    ]
  },
  "result": { "format": "subgraph" | "routes" | "both", "limit": 500 }
}
```
- Set operators: `union`, `intersection`, `difference` (n-ary, explicit tree, no precedence rules needed). `and`/`or`/`not` work on predicates within a single route.
- Positions: `first`, `last`, `any`, `all`, `none`, `index:n`.
- Operators: `eq` (default), `in`, `exists`, `contains`, `gt/gte/lt/lte` (with an ordinal map for `severity`), `regex`.
- Dot-paths into nested objects; *any-match* semantics over arrays.
- Also offer `GET /api/v1/graph` (the full normalised graph) and `GET /api/v1/schema` (discovered property keys and values, which powers the UI query builder).

### 3.3 Make set operations route-based, then project to a subgraph
Run all set algebra on **route-id sets**. Only at the end, project the surviving routes to a subgraph: the union of their nodes and edges, keeping the original node objects. This avoids dangling-edge issues, keeps the semantics intuitive, and lets the response carry both `routes` and `subgraph`.

### 3.4 Prefer in-memory precomputation over an external DB (for now)
The workload is read-mostly and the expected graph is small to medium, so:
1. At load time, normalise the graph, enumerate all routes once, and assign ids.
2. Build **inverted indexes**: `(position, propertyPath, value) → bitset of route ids`, plus `length → bitset`.
3. Each predicate becomes a bitset lookup, and set operators become bitwise AND/OR/ANDNOT. Typical queries take microseconds to milliseconds.
4. Put this behind a `RouteStore` interface, so a graph DB (Neo4j/Memgraph) or a search engine can be swapped in if the scale grows. Revisit the decision only when route enumeration exceeds a memory budget.
5. Cache query results by a canonicalised query hash.

### 3.5 Define performance acceptance concretely
- Reference dataset: the sample plus a **synthetic generator** (e.g. 500 / 2,000 nodes) to test scaling.
- Standard query = ≤ 3 predicates, no set ops. Heavy = ≥ 3 nested set ops on the largest synthetic graph.
- Measure server-side p95 over N runs in a perf test, and fail the test if it goes over 100 / 500 ms.

### 3.6 Fix the stack
- Monorepo: `/client` (Vite + React 19 + `@xyflow/react` + styled-components + `dagre`/`elkjs`), `/server` (Node LTS + Fastify or Express), `/shared` (types, query schema), all in **TypeScript**.
- Validate input and query with a schema library (e.g. zod) shared by client and server.

### 3.7 Define the input-validation policy
Load with **warnings**, don't hard-fail. Normalise `to` to an array, create placeholder nodes for undefined references (flagged `kind: "unknown"`, `missing: true`), drop duplicate edges, and report all warnings in `GET /api/v1/graph` so the UI can show them.

### 3.8 Specify the UI baseline
- Auto-layout left→right (callers on the left, callees on the right).
- Visual encoding: shape or colour by `kind`, a ring or icon for `publicExposed`, a red badge with a count for vulnerabilities.
- Query builder generated from `/schema`, plus a raw JSON editor for advanced users.
- A **highlight mode** (dim the rest) and a **filter mode** (show only the result), a routes list panel, and a node details drawer.

### 3.9 Make the testing spec concrete
- Vitest for everything (unit and API via `supertest` or Fastify `inject`; components via Testing Library).
- `/tests/{unit,api,perf,ui}` with fixtures under `/tests/fixtures` (the sample, edge-case graphs, and expected outputs that are hard-coded and reviewed).
- Scripts:
  - `npm test`: run all, console summary plus a JSON report file (`report.<timestamp>.json`, already gitignored).
  - `npm run test:bail`: `vitest run --bail=1` (stop at the first failure and print the full reason).
- Each failing test prints the query, expected result, and actual result (a diff).

### 3.10 List edge cases explicitly in the plan
Cycles, self-loops, duplicate edges, edges to undefined nodes, isolated nodes, disconnected components, nodes missing a property used in a predicate, empty results, `difference` producing an empty set, very long paths, very large result sets, invalid queries (unknown op, bad position, bad type).
