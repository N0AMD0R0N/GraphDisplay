import { normalizeText, type FlatValue, type NormalizedGraph, type StoredNode, type Warning } from '@gd/api-contract';
import { flattenNode } from './flatten';
import type { RawGraph } from './parse';

export interface IngestConfig {
  /** Node kinds that count as sinks (datastores); A3.3. */
  sinkKinds: string[];
  /** Ordinal severity ranks; A3.4. */
  severityScale: Record<string, number>;
}

export const DEFAULT_CONFIG: IngestConfig = {
  sinkKinds: ['rds', 'sqs'],
  severityScale: { info: 0, low: 1, medium: 2, high: 3, critical: 4 },
};

export function parseSinkKinds(value: string | undefined): string[] {
  if (!value) return DEFAULT_CONFIG.sinkKinds;
  return value.split(',').map(normalizeText).filter(Boolean);
}

/** Parses `info=0,low=1,...`. */
export function parseSeverityScale(value: string | undefined): Record<string, number> {
  if (!value) return DEFAULT_CONFIG.severityScale;
  const out: Record<string, number> = {};
  for (const part of value.split(',')) {
    const [k, n] = part.split('=');
    if (k && n !== undefined && Number.isFinite(Number(n))) out[normalizeText(k)] = Number(n);
  }
  return Object.keys(out).length ? out : DEFAULT_CONFIG.severityScale;
}

/**
 * Adds flattened queryable properties and derived properties (WorkPlan §3.1, §3.1.1) to a parsed graph.
 */
export function finalizeGraph(
  graph: RawGraph,
  config: IngestConfig = DEFAULT_CONFIG,
): { graph: NormalizedGraph; warnings: Warning[] } {
  const inDeg = new Map<string, number>();
  const outDeg = new Map<string, number>();
  for (const e of graph.edges) {
    outDeg.set(e.from, (outDeg.get(e.from) ?? 0) + 1);
    inDeg.set(e.to, (inDeg.get(e.to) ?? 0) + 1);
  }

  const warnings: Warning[] = [];
  const unknownSeverities = new Set<string>();
  const sinkKinds = new Set(config.sinkKinds.map(normalizeText));

  const nodes: StoredNode[] = graph.nodes.map((n) => {
    const props: Record<string, FlatValue> = flattenNode(n.raw);
    const rawKind = typeof n.raw.kind === 'string' ? normalizeText(n.raw.kind) : '';
    const kind = n.incomplete || !rawKind ? 'unknown' : rawKind;

    props.name = n.id;
    props.kind = kind;
    props.incomplete = n.incomplete;
    props._degree = (inDeg.get(n.id) ?? 0) + (outDeg.get(n.id) ?? 0);
    props._isTerminal = (outDeg.get(n.id) ?? 0) === 0;
    props._isSink = !n.incomplete && sinkKinds.has(kind);

    const severities = props['vulnerabilities.severity'];
    if (Array.isArray(severities)) {
      let max: number | undefined;
      for (const s of severities) {
        const rank = config.severityScale[String(s)];
        if (rank === undefined) unknownSeverities.add(String(s));
        else max = max === undefined ? rank : Math.max(max, rank);
      }
      if (max !== undefined) props['vulnerabilities._maxSeverityRank'] = max;
    }

    return { id: n.id, name: n.name, kind, incomplete: n.incomplete, raw: n.raw, props };
  });

  for (const s of [...unknownSeverities].sort()) {
    warnings.push({
      code: 'UNKNOWN_SEVERITY',
      ref: s,
      message: `Severity "${s}" is not in the severity scale and gets no rank`,
    });
  }
  return { graph: { nodes, edges: graph.edges }, warnings };
}
