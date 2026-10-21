import { DEFAULTS, ServiceCallError, type GraphSchema, type Warning } from '@gd/api-contract';
import {
  QueryError,
  combineRows,
  dropSubRoutes,
  parseQueryRequest,
  sortRows,
  toRoute,
  type CompileContext,
  type QueryResult,
  type RouteRow,
  type SetTree,
} from '@gd/query-core';
import { ERROR_CODES } from './constants';
import type { QueryDeps } from './types';

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
    throw new QueryError(err?.message ?? 'Query failed', err?.code ?? ERROR_CODES.queryFailed, e.status);
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
  if (!schema) throw new QueryError('Graph not found', ERROR_CODES.graphNotFound, 404);

  const limit = req.limit ?? deps.limits.defaultLimit;
  const maxHops = req.maxHops ?? deps.limits.maxHops;
  // Sub-routes are removed after the search, so the search has to look further than `limit` routes: it stops at the
  // highest limit the API allows and `limit` then applies to what is left.
  const includeSubRoutes = req.includeSubRoutes ?? false;
  const fetchLimit = includeSubRoutes ? limit : Math.max(limit, DEFAULTS.limitCeiling);
  const ctx: CompileContext = { graphId, maxHops, limit: fetchLimit, routeMode: req.routeMode ?? 'all', schema };
  const warnings: Warning[] = [];

  const evaluate = async (tree: SetTree): Promise<Evaluated> => {
    if (tree.op === 'leaf') {
      const lang = deps.languages.get(tree.language ?? 'cypher');
      if (!lang) throw new QueryError(`Unknown query language "${tree.language}"`, ERROR_CODES.unknownLanguage);
      const query = tree.builder ? lang.compile(tree.builder, ctx) : lang.prepare(tree.text!, ctx);
      const res = await deps.dal.run(graphId, { query, limit: fetchLimit, maxHops }).catch(asQueryError);
      return { rows: res.routes, truncated: res.truncated };
    }
    const parts = await Promise.all(tree.args.map(evaluate));
    const truncated = parts.some((p) => p.truncated);
    if (truncated && tree.op !== 'union') {
      warnings.push({
        code: 'APPROXIMATE_SET_OPERATION',
        message: `An operand of "${tree.op}" was truncated at ${fetchLimit} routes, so the result is approximate`,
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
  const candidates = includeSubRoutes ? sortRows(evaluated.rows) : dropSubRoutes(evaluated.rows);
  const truncated = evaluated.truncated || candidates.length > limit;
  const rows = candidates.slice(0, limit);
  if (truncated) {
    warnings.push({
      code: 'TRUNCATED',
      message:
        evaluated.truncated && !includeSubRoutes
          ? `The search stopped after ${fetchLimit} matching routes, before sub-routes were removed; more routes may exist`
          : `The result is limited to ${limit} routes; more routes match`,
    });
  }

  const routes = rows.map(toRoute);
  // the nodes and edges of the routes, once each, so the result can be drawn as it is
  const nodeIds = [...new Set(routes.flatMap((r) => r.nodeIds))];
  const edgeIds = [...new Set(routes.flatMap((r) => r.edgeIds))];
  const { nodes, edges } =
    nodeIds.length > 0
      ? await deps.dal.entities(graphId, { nodeIds, edgeIds }).catch(asQueryError)
      : { nodes: [], edges: [] };
  return { routes, nodes, edges, total: truncated ? null : routes.length, truncated, warnings };
}
