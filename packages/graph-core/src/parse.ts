import * as v from 'valibot';
import { edgeIdOf, normalizeText, type IssueEntry, type StoredEdge, type Warning } from '@gd/api-contract';
import { trimStrings } from './flatten';

export interface RawNode {
  id: string;
  name: string;
  raw: Record<string, unknown>;
  incomplete: boolean;
}

/** Parsed and de-duplicated graph, before flattening and derived properties. */
export interface RawGraph {
  nodes: RawNode[];
  edges: StoredEdge[];
}

export interface ParseError {
  code: 'INVALID_JSON' | 'INVALID_FORMAT' | 'DUPLICATE_NODE_NAME';
  path?: string;
  message: string;
}

export type ParseResult =
  { ok: true; graph: RawGraph; warnings: Warning[]; issues: IssueEntry[] } | { ok: false; errors: ParseError[] };

const nonEmpty = v.pipe(
  v.string('must be a string'),
  v.check((s) => s.trim().length > 0, 'must not be empty'),
);

const nodeSchema = v.looseObject({
  name: nonEmpty,
  kind: v.optional(v.string('must be a string')),
});

const edgeSchema = v.looseObject({
  from: nonEmpty,
  to: v.union([nonEmpty, v.array(nonEmpty)], 'must be a string or an array of strings'),
});

const graphSchema = v.looseObject({
  nodes: v.array(nodeSchema, 'must be an array'),
  edges: v.optional(v.array(edgeSchema, 'must be an array')),
});

export function parseGraph(input: unknown): ParseResult {
  let data = input;
  if (typeof input === 'string') {
    try {
      data = JSON.parse(input);
    } catch (e) {
      return {
        ok: false,
        errors: [{ code: 'INVALID_JSON', message: `Body is not valid JSON: ${(e as Error).message}` }],
      };
    }
  }

  const checked = v.safeParse(graphSchema, data);
  if (!checked.success) {
    return {
      ok: false,
      errors: checked.issues.slice(0, 20).map((issue) => ({
        code: 'INVALID_FORMAT' as const,
        path: issue.path?.map((p) => String(p.key)).join('.'),
        message: issue.message,
      })),
    };
  }
  const graph = checked.output;

  // ---- nodes
  const nodes = new Map<string, RawNode>();
  const duplicates = new Set<string>();
  for (const n of graph.nodes) {
    const raw = trimStrings(n) as Record<string, unknown>;
    const id = normalizeText(n.name);
    if (nodes.has(id)) {
      duplicates.add(id);
      continue;
    }
    nodes.set(id, { id, name: String(raw.name), raw, incomplete: false });
  }
  if (duplicates.size > 0) {
    return {
      ok: false,
      errors: [...duplicates].sort().map((id) => ({
        code: 'DUPLICATE_NODE_NAME' as const,
        path: `nodes[name=${id}]`,
        message: `Duplicate node name "${id}" (names are unique, case-insensitive)`,
      })),
    };
  }

  // ---- edges (grouped form -> one normalised edge per from/to pair)
  const warnings: Warning[] = [];
  const edges = new Map<string, StoredEdge>();
  const firstSeenName = new Map<string, string>();
  const refCount = new Map<string, number>();
  const note = (original: string) => {
    const id = normalizeText(original);
    if (!firstSeenName.has(id)) firstSeenName.set(id, original.trim());
    refCount.set(id, (refCount.get(id) ?? 0) + 1);
    return id;
  };

  for (const group of graph.edges ?? []) {
    const { from: fromRaw, to: toRaw, ...rest } = group;
    const extra = trimStrings(rest) as Record<string, unknown>;
    const from = note(fromRaw);
    for (const target of Array.isArray(toRaw) ? toRaw : [toRaw]) {
      const to = note(target);
      const id = edgeIdOf(from, to);
      if (edges.has(id)) {
        warnings.push({ code: 'DUPLICATE_EDGE', ref: id, message: `Duplicate edge "${id}" ignored` });
        continue;
      }
      const edge: StoredEdge = { id, from, to };
      if (Object.keys(extra).length > 0) edge.extra = extra;
      edges.set(id, edge);
    }
  }

  // ---- missing nodes -> incomplete placeholders derived from the referencing edges
  const issues: IssueEntry[] = [];
  for (const id of [...refCount.keys()].sort()) {
    if (nodes.has(id)) continue;
    const name = firstSeenName.get(id) ?? id;
    nodes.set(id, { id, name, raw: { name }, incomplete: true });
    issues.push({
      status: 422,
      code: 'MISSING_NODE',
      ref: id,
      message: `Node "${id}" is referenced by ${refCount.get(id)} edge(s) but not defined; created as an incomplete placeholder`,
    });
    warnings.push({
      code: 'MISSING_NODE',
      ref: id,
      message: `Node "${id}" is referenced but not defined (placeholder created)`,
    });
  }

  const edgeList = [...edges.values()];
  warnings.push(...detectCycles([...nodes.keys()], edgeList));

  return {
    ok: true,
    graph: {
      nodes: [...nodes.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
      edges: edgeList.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    },
    warnings,
    issues,
  };
}

/** Tarjan SCC (iterative). Reports strongly connected components of size > 1 and self-loops. */
export function detectCycles(nodeIds: string[], edges: { from: string; to: string }[]): Warning[] {
  const adj = new Map<string, string[]>();
  for (const id of nodeIds) adj.set(id, []);
  for (const e of edges) adj.get(e.from)?.push(e.to);

  let counter = 0;
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const components: string[][] = [];

  for (const root of nodeIds) {
    if (index.has(root)) continue;
    const work: { node: string; next: number }[] = [{ node: root, next: 0 }];
    index.set(root, counter);
    low.set(root, counter++);
    stack.push(root);
    onStack.add(root);
    while (work.length > 0) {
      const frame = work[work.length - 1];
      const neighbours = adj.get(frame.node) ?? [];
      if (frame.next < neighbours.length) {
        const w = neighbours[frame.next++];
        if (!index.has(w)) {
          index.set(w, counter);
          low.set(w, counter++);
          stack.push(w);
          onStack.add(w);
          work.push({ node: w, next: 0 });
        } else if (onStack.has(w)) {
          low.set(frame.node, Math.min(low.get(frame.node)!, index.get(w)!));
        }
      } else {
        if (low.get(frame.node) === index.get(frame.node)) {
          const comp: string[] = [];
          let w: string;
          do {
            w = stack.pop()!;
            onStack.delete(w);
            comp.push(w);
          } while (w !== frame.node);
          components.push(comp);
        }
        work.pop();
        const parent = work[work.length - 1];
        if (parent) low.set(parent.node, Math.min(low.get(parent.node)!, low.get(frame.node)!));
      }
    }
  }

  const selfLoops = new Set(edges.filter((e) => e.from === e.to).map((e) => e.from));
  const warnings: Warning[] = [];
  for (const comp of components) {
    if (comp.length > 1 || selfLoops.has(comp[0])) {
      const members = comp.sort();
      const shown = members.slice(0, 20).join(', ') + (members.length > 20 ? ', …' : '');
      warnings.push({
        code: 'CYCLE',
        ref: members[0],
        message: `Cycle detected among ${members.length} node(s): ${shown}`,
      });
    }
  }
  return warnings.sort((a, b) => (a.ref! < b.ref! ? -1 : 1));
}
