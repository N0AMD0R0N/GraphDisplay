import { createHash } from 'node:crypto';
import type { ApiError, GraphSchema, NormalizedGraph, UploadResponse, Warning } from '@gd/api-contract';
import type { DalClient } from '@gd/dal-contract';
import type { IngestOutcome, RebuildResponse } from '@gd/ingest-contract';
import { discoverSchema, finalizeGraph, parseGraph, type IngestConfig, type RawGraph } from '@gd/graph-core';

export interface PipelineDeps {
  dal: DalClient;
  config: IngestConfig;
}

export interface PipelineOptions {
  name?: string;
  pinned?: boolean;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

/** graphId = content hash of the normalised graph + the derived-property config (A11). */
export function graphIdOf(graph: NormalizedGraph, config: IngestConfig): string {
  const content = stableStringify({
    nodes: graph.nodes.map((n) => ({ id: n.id, raw: n.raw, incomplete: n.incomplete })),
    edges: graph.edges.map((e) => ({ id: e.id, extra: e.extra ?? null })),
    // only the settings that change the stored properties; ports, URLs etc. must not create a new graph
    derived: { sinkKinds: config.sinkKinds, severityScale: config.severityScale },
  });
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

/** Registers the graph's kinds (colours are global and append-only) and caches the discovered schema. */
async function storeSchema(deps: PipelineDeps, graphId: string, graph: NormalizedGraph): Promise<GraphSchema> {
  const schema = discoverSchema(graphId, graph.nodes, graph.edges.length, deps.config);
  const colors = await deps.dal.assignColors(schema.kinds.map((k) => k.kind));
  for (const k of schema.kinds) k.color = colors[k.kind] ?? colors.unknown ?? '';
  await deps.dal.cachePut(graphId, 'schema', schema);
  return schema;
}

function invalid(message: string, issues: { path?: string; message: string }[]): IngestOutcome {
  const body: ApiError = { error: { status: 401, code: 'INVALID_GRAPH', message, issues } };
  return { status: 401, body };
}

/** The §3.3 ingestion pipeline. Returns the HTTP outcome (201 / 207 / 401) of an upload. */
export async function runPipeline(
  input: string | object | undefined,
  opts: PipelineOptions,
  deps: PipelineDeps,
): Promise<IngestOutcome> {
  if (input === undefined || input === '') return invalid('Request body is empty', []);
  const parsed = parseGraph(input);
  if (!parsed.ok) {
    return invalid(
      parsed.errors[0]?.code === 'INVALID_JSON' ? parsed.errors[0].message : 'The graph has an invalid format',
      parsed.errors.map((e) => ({ path: e.path, message: `${e.code}: ${e.message}` })),
    );
  }

  const { graph, warnings: finalizeWarnings } = finalizeGraph(parsed.graph, deps.config);
  const warnings: Warning[] = [...parsed.warnings, ...finalizeWarnings];
  const graphId = graphIdOf(graph, deps.config);
  const name = opts.name?.trim() || graphId.slice(0, 8);

  const stored = await deps.dal.putGraph(graphId, { name, graph, warnings, pinned: opts.pinned ?? false });
  await storeSchema(deps, graphId, graph);

  const body: UploadResponse = { ...stored.summary, warnings, existing: !stored.created };
  if (parsed.issues.length > 0) {
    body.results = parsed.issues;
    return { status: 207, body };
  }
  return { status: 201, body };
}

/** Recomputes the schema artefact of an existing graph from the data held by the DAL (A14.4). */
export async function rebuildSchema(graphId: string, deps: PipelineDeps): Promise<RebuildResponse | null> {
  const summary = await deps.dal.getGraph(graphId);
  if (!summary) return null;
  const topology = await deps.dal.topology(graphId);
  const { nodes } = await deps.dal.entities(graphId, { nodeIds: topology.nodes.map((n) => n.id), edgeIds: [] });

  const raw: RawGraph = {
    nodes: nodes
      .map((n) => {
        const { id, incomplete, ...rest } = n;
        if (incomplete) delete rest.kind;
        return { id, name: n.name, raw: rest as Record<string, unknown>, incomplete: Boolean(incomplete) };
      })
      .sort((a, b) => (a.id < b.id ? -1 : 1)),
    edges: topology.edges.map(([from, to]) => ({ id: `${from}->${to}`, from, to })),
  };
  const { graph } = finalizeGraph(raw, deps.config);
  await storeSchema(deps, graphId, graph);
  return { graphId, rebuilt: ['schema'] };
}
