import { ServiceCallError, type GraphEdge, type GraphNode, type GraphSchema, type Warning } from '@gd/api-contract';
import type { DalClient } from '@gd/dal-contract';
import type { IngestClient } from '@gd/ingest-contract';
import {
  QueryError,
  combineRows,
  parseQueryRequest,
  sortRows,
  toRoute,
  type CompileContext,
  type QueryLanguage,
  type QueryResult,
  type RouteRow,
  type SetTree,
} from '@gd/query-core';

export interface ServerLimits {
  maxHops: number;
  defaultLimit: number;
}

export interface QueryDeps {
  dal: DalClient;
  ingest: IngestClient;
  languages: Map<string, QueryLanguage>;
  limits: ServerLimits;
}

/** Schema + colours for a graph. A missing schema artefact is rebuilt by the ingestion service (A14.4). */
export async function getSchema(
  { dal, ingest }: Pick<QueryDeps, 'dal' | 'ingest'>,
  graphId: string,
): Promise<GraphSchema | null> {
  let schema = await dal.cacheGet<GraphSchema>(graphId, 'schema');
  if (!schema) {
    if (!(await dal.getGraph(graphId))) return null;
    await ingest.rebuild(graphId);
    schema = await dal.cacheGet<GraphSchema>(graphId, 'schema');
    if (!schema) return null;
  }
  let colors = await dal.colors();
  if (schema.kinds.some((k) => !colors[k.kind])) colors = await dal.assignColors(schema.kinds.map((k) => k.kind));
  return { ...schema, kinds: schema.kinds.map((k) => ({ ...k, color: colors[k.kind] ?? colors.unknown ?? '' })) };
}

function asQueryError(e: unknown): never {
  if (e instanceof ServiceCallError && [400, 422, 504].includes(e.status)) {
    const err = (e.body as { error?: { code?: string; message?: string } } | undefined)?.error;
    throw new QueryError(err?.message ?? 'Query failed', err?.code ?? 'QUERY_FAILED', e.status);
  }
  throw e;
}

interface Evaluated {
  rows: RouteRow[];
  truncated: boolean;
}

export async function runQuery(deps: QueryDeps, graphId: string, body: unknown): Promise<QueryResult> {
  const req = parseQueryRequest(body);
  const schema = await getSchema(deps, graphId);
  if (!schema) throw new QueryError('Graph not found', 'GRAPH_NOT_FOUND', 404);

  const limit = req.limit ?? deps.limits.defaultLimit;
  const maxHops = req.maxHops ?? deps.limits.maxHops;
  const ctx: CompileContext = { graphId, maxHops, limit, routeMode: req.routeMode ?? 'all', schema };
  const warnings: Warning[] = [];

  const evaluate = async (tree: SetTree): Promise<Evaluated> => {
    if (tree.op === 'leaf') {
      const lang = deps.languages.get(tree.language ?? 'cypher');
      if (!lang) throw new QueryError(`Unknown query language "${tree.language}"`, 'UNKNOWN_LANGUAGE');
      const query = tree.builder ? lang.compile(tree.builder, ctx) : lang.prepare(tree.text!, ctx);
      const res = await deps.dal.run(graphId, { query, limit, maxHops }).catch(asQueryError);
      return { rows: res.routes, truncated: res.truncated };
    }
    const parts = await Promise.all(tree.args.map(evaluate));
    const truncated = parts.some((p) => p.truncated);
    if (truncated && tree.op !== 'union') {
      warnings.push({
        code: 'APPROXIMATE_SET_OPERATION',
        message: `An operand of "${tree.op}" was truncated at ${limit} routes, so the result is approximate`,
      });
    }
    return {
      rows: combineRows(
        tree.op,
        parts.map((p) => p.rows),
      ),
      truncated,
    };
  };

  const evaluated = await evaluate(req.query);
  const sorted = sortRows(evaluated.rows);
  const truncated = evaluated.truncated || sorted.length > limit;
  const rows = sorted.slice(0, limit);
  if (truncated) {
    warnings.push({ code: 'TRUNCATED', message: `The result is limited to ${limit} routes; more routes match` });
  }

  const nodeIds = [...new Set(rows.flatMap((r) => r.nodeIds))];
  const routes = rows.map(toRoute);
  const edgeIds = [...new Set(routes.flatMap((r) => r.edgeIds))];
  const nodes: Record<string, GraphNode> = {};
  const edges: Record<string, GraphEdge> = {};
  for (let i = 0; i < Math.max(nodeIds.length, edgeIds.length); i += 1000) {
    const part = await deps.dal.entities(graphId, {
      nodeIds: nodeIds.slice(i, i + 1000),
      edgeIds: edgeIds.slice(i, i + 1000),
    });
    for (const n of part.nodes) nodes[n.id] = n;
    for (const e of part.edges) edges[e.id] = e;
  }
  return { routes, nodes, edges, total: truncated ? null : routes.length, truncated, warnings };
}
