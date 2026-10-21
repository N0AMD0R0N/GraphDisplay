import neo4j, { type Driver } from 'neo4j-driver';
import type { GraphEdge, GraphNode, GraphSummary, Warning } from '@gd/api-contract';
import {
  QueryError,
  sortRows,
  type GraphEngine,
  type NativeQuery,
  type QueryLimits,
  type RouteRow,
  type RunResult,
  type StoreGraphInput,
  type Topology,
} from '@gd/query-core';

export interface Neo4jEngineOptions {
  uri: string;
  user: string;
  password: string;
  defaultTimeoutMs?: number;
}

const NODE_BATCH = 500;
const EDGE_BATCH = 2000;
const DELETE_BATCH = 2000;

/** Neo4j properties accept integers only as Integer values; keep whole numbers integral. */
function toNeo(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toNeo);
  if (typeof value === 'number' && Number.isInteger(value)) return neo4j.int(value);
  return value;
}

function mapError(e: unknown): never {
  const err = e as { code?: string; message?: string };
  const code = err.code ?? '';
  if (code.includes('TransactionTimedOut')) {
    throw new QueryError('The query exceeded the time limit; narrow it or lower maxHops', 'QUERY_TIMEOUT', 504);
  }
  if (code.startsWith('Neo.ClientError.Statement') || code.startsWith('Neo.ClientError.Request')) {
    throw new QueryError(err.message ?? 'Invalid query', 'CYPHER_ERROR', 422);
  }
  throw e;
}

export class Neo4jEngine implements GraphEngine {
  private readonly driver: Driver;
  private readonly defaultTimeoutMs: number;

  constructor(opts: Neo4jEngineOptions) {
    this.driver = neo4j.driver(opts.uri, neo4j.auth.basic(opts.user, opts.password), {
      disableLosslessIntegers: true,
    });
    this.defaultTimeoutMs = opts.defaultTimeoutMs ?? 5000;
  }

  async ping(): Promise<void> {
    await this.driver.verifyConnectivity();
  }

  async close(): Promise<void> {
    await this.driver.close();
  }

  async init(): Promise<void> {
    const statements = [
      'CREATE CONSTRAINT node_key IF NOT EXISTS FOR (n:Node) REQUIRE (n.graphId, n.id) IS UNIQUE',
      'CREATE CONSTRAINT graph_key IF NOT EXISTS FOR (g:Graph) REQUIRE g.graphId IS UNIQUE',
      'CREATE INDEX node_graph IF NOT EXISTS FOR (n:Node) ON (n.graphId)',
      'CREATE INDEX node_kind IF NOT EXISTS FOR (n:Node) ON (n.kind)',
      'CREATE INDEX node_public IF NOT EXISTS FOR (n:Node) ON (n.publicExposed)',
      'CREATE INDEX node_sink IF NOT EXISTS FOR (n:Node) ON (n._isSink)',
      'CREATE INDEX node_vuln_count IF NOT EXISTS FOR (n:Node) ON (n.`vulnerabilities._count`)',
      'CREATE INDEX node_vuln_rank IF NOT EXISTS FOR (n:Node) ON (n.`vulnerabilities._maxSeverityRank`)',
    ];
    const session = this.driver.session();
    try {
      for (const s of statements) await session.run(s);
    } finally {
      await session.close();
    }
  }

  async store(input: StoreGraphInput): Promise<boolean> {
    const { graphId, graph } = input;
    const session = this.driver.session();
    try {
      return await session.executeWrite(async (tx) => {
        const existing = await tx.run('MATCH (g:Graph {graphId: $graphId}) RETURN g.pinned AS pinned', { graphId });
        if (existing.records.length > 0) {
          if (input.pinned) {
            // pinning an existing graph (e.g. the seed) makes it exempt from expiry
            await tx.run('MATCH (g:Graph {graphId: $graphId}) SET g.pinned = true SET g.expiresAt = null', { graphId });
          } else if (input.expiresAt !== null && !existing.records[0].get('pinned')) {
            await tx.run('MATCH (g:Graph {graphId: $graphId}) SET g.expiresAt = $expiresAt', {
              graphId,
              expiresAt: neo4j.int(input.expiresAt),
            });
          }
          return false;
        }
        const placeholders = graph.nodes.filter((n) => n.incomplete).length;
        await tx.run(
          `CREATE (g:Graph {graphId: $graphId, name: $name, status: $status, nodes: $nodes, edges: $edges,
             placeholders: $placeholders, createdAt: $createdAt, pinned: $pinned, warnings: $warnings})
           SET g.expiresAt = $expiresAt`,
          {
            graphId,
            name: input.name,
            status: placeholders > 0 ? 'incomplete' : 'complete',
            nodes: neo4j.int(graph.nodes.length),
            edges: neo4j.int(graph.edges.length),
            placeholders: neo4j.int(placeholders),
            createdAt: neo4j.int(Date.now()),
            pinned: input.pinned,
            warnings: JSON.stringify(input.warnings),
            expiresAt: input.expiresAt === null ? null : neo4j.int(input.expiresAt),
          },
        );
        for (let i = 0; i < graph.nodes.length; i += NODE_BATCH) {
          const rows = graph.nodes.slice(i, i + NODE_BATCH).map((n) => {
            const row: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(n.props)) row[k] = toNeo(v);
            row.graphId = graphId;
            row.id = n.id;
            row._raw = JSON.stringify(n.raw);
            return row;
          });
          await tx.run('UNWIND $rows AS row CREATE (n:Node) SET n = row', { rows });
        }
        for (let i = 0; i < graph.edges.length; i += EDGE_BATCH) {
          const rows = graph.edges.slice(i, i + EDGE_BATCH).map((e) => ({
            id: e.id,
            from: e.from,
            to: e.to,
            raw: e.extra ? JSON.stringify(e.extra) : null,
          }));
          await tx.run(
            `UNWIND $rows AS e
             MATCH (a:Node {graphId: $graphId, id: e.from}), (b:Node {graphId: $graphId, id: e.to})
             CREATE (a)-[r:CALLS {id: e.id, from: e.from, to: e.to}]->(b)
             SET r._raw = e.raw`,
            { rows, graphId },
          );
        }
        return true;
      });
    } catch (e) {
      // a concurrent store of the same content hit the unique constraint: the graph exists now
      if ((e as { code?: string }).code === 'Neo.ClientError.Schema.ConstraintValidationFailed') return false;
      throw e;
    } finally {
      await session.close();
    }
  }

  async deleteGraph(graphId: string): Promise<void> {
    const session = this.driver.session();
    try {
      for (;;) {
        const res = await session.run(
          'MATCH (n:Node {graphId: $graphId}) WITH n LIMIT $batch DETACH DELETE n RETURN count(*) AS c',
          { graphId, batch: neo4j.int(DELETE_BATCH) },
        );
        if (res.records[0].get('c') === 0) break;
      }
      await session.run('MATCH (g:Graph {graphId: $graphId}) DELETE g', { graphId });
    } finally {
      await session.close();
    }
  }

  async listGraphs(): Promise<GraphSummary[]> {
    return this.readSummaries('MATCH (g:Graph) RETURN g ORDER BY g.createdAt DESC, g.graphId', {});
  }

  async getGraph(graphId: string): Promise<GraphSummary | null> {
    const found = await this.readSummaries('MATCH (g:Graph {graphId: $graphId}) RETURN g', { graphId });
    return found[0] ?? null;
  }

  private async readSummaries(cypher: string, params: Record<string, unknown>): Promise<GraphSummary[]> {
    const session = this.driver.session({ defaultAccessMode: neo4j.session.READ });
    try {
      const res = await session.run(cypher, params);
      return res.records.map((r) => {
        const g = r.get('g').properties;
        return {
          graphId: g.graphId,
          name: g.name,
          status: g.status,
          counts: { nodes: g.nodes, edges: g.edges, placeholders: g.placeholders },
          createdAt: g.createdAt,
          expiresAt: g.expiresAt ?? null,
          pinned: Boolean(g.pinned),
          warnings: JSON.parse(g.warnings ?? '[]') as Warning[],
        };
      });
    } finally {
      await session.close();
    }
  }

  async findExpired(now: number): Promise<string[]> {
    const session = this.driver.session({ defaultAccessMode: neo4j.session.READ });
    try {
      const res = await session.run(
        `MATCH (g:Graph) WHERE g.expiresAt IS NOT NULL AND g.expiresAt <= $now AND coalesce(g.pinned, false) = false
         RETURN g.graphId AS id ORDER BY id`,
        { now: neo4j.int(now) },
      );
      return res.records.map((r) => r.get('id') as string);
    } finally {
      await session.close();
    }
  }

  async run(graphId: string, query: NativeQuery, limits: QueryLimits): Promise<RunResult> {
    const session = this.driver.session({ defaultAccessMode: neo4j.session.READ });
    const timeout = limits.timeoutMs ?? this.defaultTimeoutMs;
    try {
      const res = await session.executeRead((tx) => tx.run(query.text, query.params), { timeout });
      let rows: RouteRow[] = [];
      for (const rec of res.records) {
        const value = rec.get('r');
        const nodes = neo4j.isPath(value)
          ? [value.start, ...value.segments.map((s) => s.end)]
          : neo4j.isNode(value)
            ? [value]
            : null;
        if (!nodes) continue;
        // guards for raw queries (cheap for builder queries): graph scope, hop limit, simple paths
        if (nodes.some((n) => n.properties.graphId !== graphId)) continue;
        if (nodes.length > limits.maxHops + 1) continue;
        const ids = nodes.map((n) => n.properties.id as string);
        if (new Set(ids).size !== ids.length) continue;
        rows.push({ nodeIds: ids });
      }
      const truncated = rows.length > limits.limit;
      rows = sortRows(rows).slice(0, limits.limit);
      await this.annotateCycles(session, graphId, rows, timeout);
      return { routes: rows, truncated };
    } catch (e) {
      return mapError(e);
    } finally {
      await session.close();
    }
  }

  /** Marks routes whose last node has an edge back into the route (A4.4). */
  private async annotateCycles(
    session: ReturnType<Driver['session']>,
    graphId: string,
    rows: RouteRow[],
    timeout: number,
  ): Promise<void> {
    if (rows.length === 0) return;
    const res = await session.executeRead(
      (tx) =>
        tx.run(
          `UNWIND range(0, size($routes) - 1) AS i
           WITH i, $routes[i] AS rt
           MATCH (l:Node {graphId: $graphId, id: rt[size(rt) - 1]})-[:CALLS]->(c:Node {graphId: $graphId})
           WHERE c.id IN rt
           RETURN i, collect(c.id) AS closes`,
          { routes: rows.map((r) => r.nodeIds), graphId },
        ),
      { timeout },
    );
    for (const rec of res.records) {
      const row = rows[rec.get('i') as number];
      const closes = new Set(rec.get('closes') as string[]);
      const target = row.nodeIds.find((id) => closes.has(id));
      if (target) row.closesTo = target;
    }
  }

  async topology(graphId: string): Promise<Topology> {
    const session = this.driver.session({ defaultAccessMode: neo4j.session.READ });
    try {
      const nodes = await session.run(
        'MATCH (n:Node {graphId: $graphId}) RETURN n.id AS id, n.name AS name, n.kind AS kind, n._degree AS degree, n.incomplete AS incomplete ORDER BY id',
        { graphId },
      );
      const edges = await session.run(
        'MATCH (a:Node {graphId: $graphId})-[:CALLS]->(b:Node) RETURN a.id AS f, b.id AS t ORDER BY f, t',
        { graphId },
      );
      return {
        nodes: nodes.records.map((r) => ({
          id: r.get('id'),
          name: r.get('name'),
          kind: r.get('kind'),
          degree: r.get('degree') ?? 0,
          incomplete: Boolean(r.get('incomplete')),
        })),
        edges: edges.records.map((r) => [r.get('f'), r.get('t')] as [string, string]),
      };
    } finally {
      await session.close();
    }
  }

  async entities(
    graphId: string,
    nodeIds: string[],
    edgeIds: string[],
  ): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
    const session = this.driver.session({ defaultAccessMode: neo4j.session.READ });
    try {
      const nodes: GraphNode[] = [];
      if (nodeIds.length > 0) {
        const res = await session.run(
          'MATCH (n:Node {graphId: $graphId}) WHERE n.id IN $ids RETURN n.id AS id, n._raw AS raw, n.incomplete AS incomplete',
          { graphId, ids: nodeIds },
        );
        for (const r of res.records) {
          const raw = JSON.parse(r.get('raw')) as Record<string, unknown>;
          const node: GraphNode = { ...raw, id: r.get('id'), name: String(raw.name) };
          if (r.get('incomplete')) {
            node.incomplete = true;
            node.kind = 'unknown';
          }
          nodes.push(node);
        }
      }
      const edges: GraphEdge[] = [];
      if (edgeIds.length > 0) {
        const res = await session.run(
          'MATCH (a:Node {graphId: $graphId})-[r:CALLS]->(b:Node) WHERE r.id IN $ids RETURN r.id AS id, a.id AS f, b.id AS t, r._raw AS raw',
          { graphId, ids: edgeIds },
        );
        for (const r of res.records) {
          const extra = r.get('raw') ? (JSON.parse(r.get('raw')) as Record<string, unknown>) : {};
          edges.push({ ...extra, id: r.get('id'), from: r.get('f'), to: r.get('t') });
        }
      }
      return { nodes, edges };
    } finally {
      await session.close();
    }
  }
}
