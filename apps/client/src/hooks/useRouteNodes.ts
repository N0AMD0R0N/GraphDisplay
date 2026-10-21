import { useMemo } from 'react';
import type { GraphNode } from '@gd/api-contract';
import { useUI } from '../store';

/**
 * The nodes of the routes in the current result, by id. A query result carries them (`result.nodes`), so no
 * further request is needed. `undefined` when there is no result.
 */
export function useRouteNodes(): Record<string, GraphNode> | undefined {
  const result = useUI((s) => s.result);
  return useMemo(() => (result ? Object.fromEntries(result.nodes.map((n) => [n.id, n])) : undefined), [result]);
}
