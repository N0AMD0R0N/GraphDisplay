import { useCallback, useEffect, useMemo } from 'react';
import { useMutation } from '@tanstack/react-query';
import styled, { useTheme } from 'styled-components';
import {
  Background,
  Controls,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { GraphView } from '@gd/api-contract';
import { ApiRequestError, api, useSchema, useView } from '../api';
import { useUI } from '../store';
import { NODE_W, type GhostFlowNode, type KindFlowNode, type StubFlowNode } from './nodes';
import { nodeTypes } from './nodeTypes';
import { Overlays } from './Overlays';

const Wrap = styled.div`
  position: relative;
  flex: 1;
  min-width: 0;
  height: 100%;
  background: ${(p) => p.theme.colors.bg};
`;

const ROUTE_GAP = 190;
const UNKNOWN = '#9aa0a6';

function Flow() {
  const theme = useTheme();
  const rf = useReactFlow();
  const { graphId, viewMode, result, selected, openNode, expandedView, pulse } = useUI();
  const { setOpenNode, setExpandedView, pulseNode } = useUI.getState();
  const schema = useSchema(graphId).data;

  const route = result?.routes[selected];
  const graphMode = viewMode === 'graph';
  const pins = graphMode && route ? route.nodeIds : [];
  const baseView = useView(graphId, pins, graphMode);
  const view: GraphView | undefined = graphMode ? (expandedView ?? baseView.data) : undefined;

  const colors = useMemo(
    () => ({ ...Object.fromEntries((schema?.kinds ?? []).map((k) => [k.kind, k.color])) }) as Record<string, string>,
    [schema],
  );
  const colorOf = useCallback(
    (kind?: unknown) => colors[String(kind ?? 'unknown')] ?? colors.unknown ?? UNKNOWN,
    [colors],
  );

  const expand = useMutation({
    mutationFn: (vars: { nodeId: string; mode: 'neighbors' | 'component' }) =>
      api.expand(graphId!, {
        ...vars,
        visible: (view?.nodes ?? []).map((n) => ({ id: n.node.id, x: n.x, y: n.y })),
      }),
    onSuccess: (next) => setExpandedView(next),
  });

  const { nodes, edges } = useMemo(() => {
    const nodes: Node[] = [];
    const edges: Edge[] = [];
    const arrow = (color: string) => ({ type: MarkerType.ArrowClosed, color, width: 16, height: 16 });
    const baseEdge = (id: string, source: string, target: string, extra: Partial<Edge> = {}): Edge => ({
      id,
      source,
      target,
      type: 'smoothstep',
      markerEnd: arrow(theme.colors.edge),
      style: { stroke: theme.colors.edge, strokeWidth: 1.4 },
      ...extra,
    });
    const isPulsing = (id: string) => pulse?.nodeId === id;

    if (!graphMode) {
      if (!route || !result) return { nodes, edges };
      route.nodeIds.forEach((id, i) => {
        const node = result.nodes[id];
        if (!node) return;
        const n: KindFlowNode = {
          id,
          type: 'kind',
          position: { x: i * ROUTE_GAP, y: 0 },
          zIndex: id === openNode ? 1000 : 0,
          data: {
            label: String(node.name),
            color: colorOf(node.kind),
            incomplete: Boolean(node.incomplete),
            dimmed: false,
            open: id === openNode,
            pulsing: isPulsing(id),
            node,
          },
        };
        nodes.push(n);
      });
      route.edgeIds.forEach((id) => {
        const e = result.edges[id];
        if (e) {
          edges.push(
            baseEdge(id, e.from, e.to, {
              animated: true,
              markerEnd: arrow(theme.colors.accent),
              style: { stroke: theme.colors.accent, strokeWidth: 3 },
            }),
          );
        }
      });
      if (route.closesTo) {
        const last = route.nodeIds[route.nodeIds.length - 1];
        const ghost: GhostFlowNode = {
          id: 'ghost',
          type: 'ghost',
          position: { x: route.nodeIds.length * ROUTE_GAP, y: 0 },
          data: {
            target: String(result.nodes[route.closesTo]?.name ?? route.closesTo),
            color: colorOf(result.nodes[route.closesTo]?.kind),
            dimmed: false,
          },
        };
        nodes.push(ghost);
        edges.push(
          baseEdge('ghost-edge', last, 'ghost', {
            style: { stroke: theme.colors.accent, strokeWidth: 2, strokeDasharray: '6 4' },
            markerEnd: arrow(theme.colors.accent),
          }),
        );
      }
      return { nodes, edges };
    }

    if (!view) return { nodes, edges };
    const routeNodes = new Set(route?.nodeIds ?? []);
    const routeEdges = new Set(route?.edgeIds ?? []);
    const highlight = Boolean(route);
    for (const vn of view.nodes) {
      const id = vn.node.id;
      const n: KindFlowNode = {
        id,
        type: 'kind',
        position: { x: vn.x, y: vn.y },
        zIndex: id === openNode ? 1000 : routeNodes.has(id) ? 10 : 0,
        data: {
          label: String(vn.node.name),
          color: colorOf(vn.node.kind),
          incomplete: Boolean(vn.node.incomplete),
          dimmed: highlight && !routeNodes.has(id),
          open: id === openNode,
          pulsing: isPulsing(id),
          node: vn.node,
        },
      };
      nodes.push(n);
    }
    for (const e of view.edges) {
      const hot = routeEdges.has(e.id);
      edges.push(
        baseEdge(e.id, e.from, e.to, {
          className: highlight && !hot ? 'dimmed' : undefined,
          animated: hot,
          zIndex: hot ? 10 : 0,
          markerEnd: arrow(hot ? theme.colors.accent : theme.colors.edge),
          style: { stroke: hot ? theme.colors.accent : theme.colors.edge, strokeWidth: hot ? 3 : 1.4 },
        }),
      );
    }
    for (const s of view.stubs) {
      const stub: StubFlowNode = {
        id: s.id,
        type: 'stub',
        position: { x: s.x, y: s.y },
        data: { count: s.count, nodeId: s.nodeId, dimmed: highlight && !routeNodes.has(s.nodeId) },
      };
      nodes.push(stub);
      edges.push(
        baseEdge(`${s.id}-edge`, s.nodeId, s.id, {
          className: highlight && !routeNodes.has(s.nodeId) ? 'dimmed' : undefined,
          style: { stroke: theme.colors.edge, strokeWidth: 1.2, strokeDasharray: '4 4' },
          markerEnd: undefined,
        }),
      );
    }
    return { nodes, edges };
  }, [graphMode, route, result, view, openNode, pulse, colorOf, theme]);

  // the viewport is re-fitted when the displayed graph changes, not when nodes are opened or expanded
  const fitKey = `${graphId}|${viewMode}|${route?.id ?? '-'}|${baseView.dataUpdatedAt}`;
  useEffect(() => {
    const t = setTimeout(() => void rf.fitView({ padding: 0.22, duration: 250, maxZoom: 1.2 }), 60);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);

  useEffect(() => {
    if (!pulse) return;
    const target = nodes.find((n) => n.id === pulse.nodeId);
    if (target) void rf.setCenter(target.position.x + NODE_W / 2, target.position.y + 28, { zoom: 1.1, duration: 450 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pulse?.nonce]);

  const onNodeClick = useCallback(
    (_: unknown, node: Node) => {
      if (node.type === 'stub') {
        expand.mutate({ nodeId: (node.data as { nodeId: string }).nodeId, mode: 'neighbors' });
      } else if (node.type === 'ghost') {
        if (route?.closesTo) pulseNode(route.closesTo);
      } else {
        setOpenNode(useUI.getState().openNode === node.id ? null : node.id);
      }
    },
    [expand, route, pulseNode, setOpenNode],
  );

  const error = (graphMode && baseView.error) || expand.error;
  return (
    <>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={onNodeClick}
        onPaneClick={() => setOpenNode(null)}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        minZoom={0.05}
        maxZoom={2.5}
      >
        <Background gap={24} color="#dfe4ee" />
        <Controls showInteractive={false} position="bottom-right" style={{ marginBottom: 30 }} />
      </ReactFlow>
      <Overlays
        view={view}
        loading={graphMode && baseView.isLoading}
        error={error instanceof ApiRequestError ? error.message : error ? 'Something went wrong' : null}
        expanding={expand.isPending}
        onLoadComponent={(nodeId) => expand.mutate({ nodeId, mode: 'component' })}
      />
    </>
  );
}

export function Canvas() {
  return (
    <Wrap>
      <ReactFlowProvider>
        <Flow />
      </ReactFlowProvider>
    </Wrap>
  );
}
