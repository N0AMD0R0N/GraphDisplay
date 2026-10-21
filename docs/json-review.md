# JSON Review: `train-ticket-be.json`

Structure, statistics, data-quality issues, and open questions that affect how the app parses and uses this file. Figures were computed with a script over the file, not estimated.

---

## 1. Structure

```ts
interface GraphFile {
  nodes: Node[];
  edges: EdgeGroup[];
}

interface Node {
  name: string;                 // unique identifier (no separate id field)
  kind: "service" | "rds" | "sqs";
  // service-only fields
  language?: "java";
  path?: string;                // repo path, e.g. "train-ticket/ts-auth-service"
  publicExposed?: boolean;
  vulnerabilities?: Vulnerability[];
  // infrastructure-only field
  metadata?: { cloud: "AWS"; engine?: "postgres"; version?: "9.6" };
}

interface Vulnerability {
  file: string;
  severity: "medium" | "high";  // only values present in the sample
  message: string;
  metadata: { cwe: string };
}

interface EdgeGroup {
  from: string;                 // node name
  to: string[] | string;        // adjacency list (one group per source node)
}
```

- **Edges are adjacency lists**, not one object per edge. Each `from` appears only once, so there are no duplicate groups.
- **Edge direction** = the caller → the callee / dependency (`order-service → prod-postgresdb`).
- **Edges have no properties** (no protocol, endpoint, method, sync/async).

## 2. Statistics

| Metric | Value |
|---|---|
| Nodes | 46 (44 `service`, 1 `rds`, 1 `sqs`). All names are unique. |
| Edge groups | 27 |
| Individual edges | 98 |
| Cycles | **none** (the graph is a DAG) |
| Self-loops / duplicate targets | none |
| Longest path | 5 edges / 6 nodes |
| Simple paths of length ≥ 1 (any start → any end) | 440 |
| Maximal paths (in-degree-0 source → out-degree-0 sink) | 217 (by node count: 2→20, 3→61, 4→80, 5→44, 6→12) |
| Public nodes | `frontend`, `gateway-service` |
| Nodes with vulnerabilities | `auth-service` (1), `order-service` (2) |
| Isolated nodes (no edges at all) | `gateway-service`, `ticket-office-service`, `avatar-service`, `news-service`, `ui-dashboard` |

The graph is tiny. Full precomputation of every route is trivial in time and memory, so the latency targets aren't a concern for *this* file.

---

## 3. Issues

### 3.1 Parsing / integrity (must handle)

| # | Issue | Location | Impact | Suggested handling |
|---|---|---|---|---|
| P1 | **Edge target to an undefined node**: `assurance-service` | `preserve-service.to`, `preserve-other-service.to` | Lookups by name fail; react-flow drops or errors on edges whose target node doesn't exist. | Create a placeholder node (`kind: "unknown"`, `missing: true`), log a warning, and show it visually distinct. Don't silently drop the edge, because that loses information. |
| P2 | **`to` is a string, not an array** | `consign-service → "consign-price-service"` | Iterating over `to` without a check walks the string's characters and produces 20 bogus single-letter edges. | Normalise: `Array.isArray(to) ? to : [to]`. Validate with a schema that accepts `string \| string[]`. |
| P3 | **No explicit node id**: `name` is used as the key | all | Renaming a service breaks every reference; nothing in the format guarantees uniqueness. | Treat `name` as the id, and enforce uniqueness at load (reject or warn on duplicates). |
| P4 | **Heterogeneous node schema**: `publicExposed`, `language`, `path` are missing on `rds`/`sqs` | `prod-postgresdb`, `prod-sqs` | A query like `publicExposed == false` silently excludes the DB and queue unless "missing" is defined. | Decide the semantics: **missing ≠ false** (recommended), and offer an explicit `exists` operator. Optionally default `publicExposed: false` for infrastructure, but document it. |
| P5 | **`metadata` has two unrelated meanings**: infrastructure attributes on the node vs CWE info inside a vulnerability | `node.metadata`, `vulnerabilities[].metadata` | A dot-path query like `metadata.cloud` is fine, but a generic "search metadata" is ambiguous. | Address properties by full dot-path only. Generate the UI query builder from the discovered schema so the two aren't confused. |
| P6 | **Nested arrays in properties** (`vulnerabilities[]`) | 2 nodes | The query engine must define array semantics. Does `vulnerabilities.severity = high` mean *any* element matches? | Default to *any-match* over arrays, and add `count`/`exists` helpers (e.g. `vulnerabilities: { exists: true }`, `vulnerabilities.length >= 2`). |
| P7 | **No layout coordinates** | all | react-flow needs an `{x, y}` position for every node. | Compute the layout with dagre/elkjs at load time or on the client (LR direction). |

### 3.2 Data quality / semantics (clarify with the data owner)

| # | Observation | Why it matters |
|---|---|---|
| D1 | **Wrong CWE labels**: both "SQL injection" findings are tagged `CWE-22 Path Traversal` (they should be **CWE-89**). Only the `order-service` "File open from tainted variable" finding is correctly CWE-22. | Queries or filters by CWE would return misleading results. The app should display the data as-is but not *derive* anything from `cwe`. Flag it to whoever produces the file. |
| D2 | `message` of one vulnerability ends with a trailing `\n`. | This is cosmetic. Trim it on display or when indexing text. |
| D3 | **Severity is a free string** (only `medium`/`high` appear). | Range queries ("severity ≥ high") need an ordinal map (`info < low < medium < high < critical`). Unknown values need a policy. |
| D4 | **`gateway-service` is public but has no edges.** In a real train-ticket deployment the gateway routes to most services. | This looks like **missing edges** in the extraction. Any "routes from a public entry" query returns little or nothing. |
| D5 | **`frontend` (public) reaches only `admin-basic-info-service`** and 5 of its leaf services. **No public node can reach either vulnerable service, the Postgres DB, or the SQS queue**: their 5, 16, 20 and 3 ancestors are all non-public. | The obvious showcase query ("public entry → vulnerable service → DB") returns **an empty result** on this data. The test fixtures should include a crafted graph where this query is non-empty, and the demo may need an extra edge to be meaningful. Confirm whether the edges are incomplete. |
| D6 | 4 other nodes are isolated besides the gateway: `ticket-office-service`, `avatar-service`, `news-service`, `ui-dashboard`. | Decide whether isolated nodes are length-1 routes (otherwise no query can ever return them) and how to place them in the layout. |
| D7 | `ui-dashboard` and `frontend` are labelled `language: "java"`, though both are UI components. | This is likely a default value from the extractor, so `language` shouldn't be trusted for filtering. It's informational only. |
| D8 | **Path naming is inconsistent**: services use `train-ticket/ts-<name>`, but `frontend` uses `train-ticket/frontend` without the `ts-` prefix. | It doesn't affect parsing. Don't derive names from paths or the reverse. |
| D9 | **No edge metadata** (protocol, HTTP vs queue, sync/async). The plan says edges are "APIs between them". | Edge-based filtering isn't possible with this data. The edge model should still allow optional properties for future files. |
| D10 | Edge direction to `prod-sqs` means "publishes to". There are no consumers of the queue. | Async flows through the queue (producer → SQS → consumer) can't be traced. This matters if routes are supposed to cross message queues. |
| D11 | Postgres 9.6 is end-of-life. | This is a possible future "outdated component" property query. It's informational only. |

---

## 4. Recommendations for the parser / loader

1. **Validate with a schema** (e.g. zod) that is tolerant of the known quirks (`to: string | string[]`) and strict on types (`name` required and unique, `kind` required).
2. **Normalise into an internal model**:
   ```ts
   nodes: Map<string, NodeRecord>         // keyed by name, original object preserved under .data
   edges: { id: `${from}->${to}`, from, to }[]   // flat, deduplicated
   out: Map<string, string[]>; in: Map<string, string[]>
   ```
3. **Collect warnings, don't throw**: missing nodes (P1), coerced `to` (P2), duplicate names or edges, unknown `kind`. Expose them via the API and show them in the UI.
4. **Detect cycles** even though this file has none. Enumerate only simple paths with a `maxDepth` guard.
5. **Discover the schema** at load: walk all node properties (with dot-paths and array flattening) and record the observed value sets, e.g. `kind ∈ {service, rds, sqs}`, `vulnerabilities.severity ∈ {medium, high}`, `metadata.cloud ∈ {AWS}`. This powers the query builder and validates queries.
6. **Round-trip output**: results (subgraphs) should serialise back to the **same format as the input** (nodes keep all original fields). Emit `to` always as an array, and emit placeholder nodes only if they're part of a route.

## 5. Test fixtures to derive from this file

- The sample as-is (expected: 46 + 1 placeholder nodes, 98 edges, 0 cycles, 217 maximal routes, 2 warnings).
- A string-`to` normalisation case (`consign-service`).
- A missing-target case (`assurance-service`).
- The "public → vulnerable" query → **empty** on the sample (a regression guard for D5).
- `last.kind = rds` → routes ending in `prod-postgresdb` (via `auth-service` and `order-service`).
- `any.vulnerabilities.severity = high` → every route through `order-service`.
- Crafted extras: a cycle, a self-loop, duplicate edges, a duplicate node name, a public→vulnerable→DB path.
