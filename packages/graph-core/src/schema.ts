import type { GraphSchema, Primitive, PropertyInfo, StoredNode } from '@gd/api-contract';
import type { IngestConfig } from './finalize';

const EXCLUDED = new Set(['graphId', 'id', '_raw']);
const MAX_DISTINCT = 50;

interface Acc {
  type: PropertyInfo['type'];
  list: boolean;
  count: number;
  values: Map<Primitive, number>;
  overflow: boolean;
  min?: number;
  max?: number;
}

/** Discovers queryable property paths, types and observed values (with counts). */
export function discoverSchema(
  graphId: string,
  nodes: StoredNode[],
  edgeCount: number,
  config: IngestConfig,
): GraphSchema {
  const acc = new Map<string, Acc>();
  const kinds = new Map<string, number>();

  for (const node of nodes) {
    kinds.set(node.kind, (kinds.get(node.kind) ?? 0) + 1);
    for (const [path, value] of Object.entries(node.props)) {
      if (EXCLUDED.has(path)) continue;
      const list = Array.isArray(value);
      const items: Primitive[] = Array.isArray(value) ? value : [value];
      if (items.length === 0) continue;
      let entry = acc.get(path);
      if (!entry) {
        entry = {
          type: typeof items[0] as PropertyInfo['type'],
          list,
          count: 0,
          values: new Map(),
          overflow: false,
        };
        acc.set(path, entry);
      }
      entry.count++;
      for (const item of items) {
        if (typeof item === 'number') {
          entry.min = entry.min === undefined ? item : Math.min(entry.min, item);
          entry.max = entry.max === undefined ? item : Math.max(entry.max, item);
        }
        if (entry.overflow) continue;
        if (typeof item === 'string' && item.length > 120) {
          entry.overflow = true;
          continue;
        }
        entry.values.set(item, (entry.values.get(item) ?? 0) + 1);
        if (entry.values.size > MAX_DISTINCT) {
          entry.overflow = true;
          entry.values.clear();
        }
      }
    }
  }

  const properties: PropertyInfo[] = [...acc.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([path, a]) => {
      const info: PropertyInfo = {
        path,
        type: a.type,
        list: a.list,
        count: a.count,
        distinct: a.overflow ? MAX_DISTINCT + 1 : a.values.size,
      };
      if (!a.overflow && a.type !== 'number') {
        info.values = [...a.values.entries()]
          .map(([value, count]) => ({ value, count }))
          .sort((x, y) => y.count - x.count || String(x.value).localeCompare(String(y.value)));
      }
      if (a.min !== undefined) info.min = a.min;
      if (a.max !== undefined) info.max = a.max;
      return info;
    });

  return {
    graphId,
    nodeCount: nodes.length,
    edgeCount,
    kinds: [...kinds.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([kind, count]) => ({ kind, count, color: '' })),
    properties,
    sinkKinds: config.sinkKinds,
    severityScale: config.severityScale,
  };
}
