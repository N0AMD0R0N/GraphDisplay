import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { GraphNode } from '@gd/api-contract';
import { hashString } from '@gd/query-core';
import { api } from './api';
import { useUI } from './store';

/**
 * The nodes of the routes in the current result. A query returns routes as lists of ids only, so their properties
 * (names, kinds, vulnerabilities) are fetched separately, once per result, in chunks.
 *
 * `undefined` while they load (or when there is no result); `{}` for a result without routes.
 */
export function useRouteNodes(): Record<string, GraphNode> | undefined {
  const graphId = useUI((s) => s.graphId);
  const result = useUI((s) => s.result);

  const ids = useMemo(() => (result ? [...new Set(result.routes.flatMap((r) => r.nodeIds))].sort() : []), [result]);
  const key = useMemo(() => hashString(ids.join('\n')), [ids]);

  const query = useQuery({
    queryKey: ['route-nodes', graphId, ids.length, key],
    queryFn: async () => Object.fromEntries((await api.nodes(graphId!, ids)).map((n) => [n.id, n])),
    enabled: !!graphId && ids.length > 0,
    staleTime: Infinity,
  });
  if (!result) return undefined;
  return ids.length === 0 ? {} : query.data;
}
