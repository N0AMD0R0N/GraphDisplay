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
import { useRouteNodes } from '../routeNodes';
import { useUI } from '../store';
import { NODE_W, type GhostFlowNode, type KindFlowNode, type StubFlowNode } from './nodes';
import { nodeTypes } from './nodeTypes';
import { Overlays, type FocusSummary } from './Overlays';
import { upstreamOf, upstreamOfEdge, type Highlight } from './highlight';
import { vulnerabilityColor } from './severity';

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
  const { graphId, viewMode, result, selected, openNode, focus, expandedView, pulse } = useUI();
  const { setOpenNode, setFocus, clearSelection, setExpandedView, pulseNode } = useUI.getState();
  const schema = useSchema(graphId).data;
  const routeNodes = useRouteNodes();

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

  const severityScale = schema?.severityScale;
  const warmColor = useCallback(
    (node: Record<string, unknown>) => (severityScale ? vulnerabilityColor(node, severityScale) : undefined),
    [severityScale],
  );

  // Highlighted part of the whole graph: the routes up to the clicked node / edge, else the selected route
  const highlight: Highlight | null = useMemo(() => {
    if (!graphMode || !view) return null;
    if (focus?.type === 'node') return upstreamOf(focus.id, view.edges);
    if (focus?.type === 'edge') return upstreamOfEdge(focus, view.edges);
    if (route) return { nodes: new Set(route.nodeIds), edges: new Set(route.edgeIds) };
    return null;
  }, [graphMode, view, focus, route]);

  const focusSummary: FocusSummary | null = useMemo(() => {
    if (!focus || !highlight || !view) return null;
    const name = (id: string) => String(view.nodes.find((n) => n.node.id === id)?.node.name ?? id);
    return {
      label:
        focus.type === 'node'
          ? `Routes up to ${name(focus.id)}`
          : `Routes up to ${name(focus.to)} through ${name(focus.from)} → ${name(focus.to)}`,
      nodes: highlight.nodes.size,
      edges: highlight.edges.size,
    };
  }, [focus, highlight, view]);

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
      if (!route || !result || !routeNodes) return { nodes, edges };
      route.nodeIds.forEach((id, i) => {
        const node = routeNodes[id];
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
            severityColor: warmColor(node),
            node,
          },
        };
        nodes.push(n);
      });
      // a route's edges are its consecutive nodes: no need to fetch them to draw the route
      route.edgeIds.forEach((id, i) => {
        edges.push(
          baseEdge(id, route.nodeIds[i], route.nodeIds[i + 1], {
            animated: true,
            markerEnd: arrow(theme.colors.accent),
            style: { stroke: theme.colors.accent, strokeWidth: 3 },
          }),
        );
      });
      if (route.closesTo) {
        const last = route.nodeIds[route.nodeIds.length - 1];
        const ghost: GhostFlowNode = {
          id: 'ghost',
          type: 'ghost',
          position: { x: route.nodeIds.length * ROUTE_GAP, y: 0 },
          data: {
            target: String(routeNodes[route.closesTo]?.name ?? route.closesTo),
            color: colorOf(routeNodes[route.closesTo]?.kind),
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
    const lit = highlight;
    for (const vn of view.nodes) {
      const id = vn.node.id;
      const n: KindFlowNode = {
        id,
        type: 'kind',
        position: { x: vn.x, y: vn.y },
        zIndex: id === openNode ? 1000 : lit?.nodes.has(id) ? 10 : 0,
        data: {
          label: String(vn.node.name),
          color: colorOf(vn.node.kind),
          incomplete: Boolean(vn.node.incomplete),
          dimmed: lit !== null && !lit.nodes.has(id),
          open: id === openNode,
          pulsing: isPulsing(id),
          severityColor: warmColor(vn.node),
          node: vn.node,
        },
      };
      nodes.push(n);
    }
    for (const e of view.edges) {
      const hot = lit?.edges.has(e.id) ?? false;
      edges.push(
        baseEdge(e.id, e.from, e.to, {
          interactionWidth: 22,
          className: lit !== null && !hot ? 'dimmed' : undefined,
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
        data: { count: s.count, nodeId: s.nodeId, dimmed: lit !== null && !lit.nodes.has(s.nodeId) },
      };
      nodes.push(stub);
      edges.push(
        baseEdge(`${s.id}-edge`, s.nodeId, s.id, {
          className: lit !== null && !lit.nodes.has(s.nodeId) ? 'dimmed' : undefined,
          style: { stroke: theme.colors.edge, strokeWidth: 1.2, strokeDasharray: '4 4' },
          markerEnd: undefined,
        }),
      );
    }
    return { nodes, edges };
  }, [graphMode, route, result, routeNodes, view, highlight, openNode, pulse, colorOf, warmColor, theme]);

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
      } else if (useUI.getState().openNode === node.id) {
        clearSelection();
      } else {
        setOpenNode(node.id);
        // in the whole graph, a clicked node also highlights the routes leading up to it
        setFocus(graphMode ? { type: 'node', id: node.id } : null);
      }
    },
    [expand, route, graphMode, pulseNode, setOpenNode, setFocus, clearSelection],
  );

  const onEdgeClick = useCallback(
    (_: unknown, edge: Edge) => {
      const original = view?.edges.find((e) => e.id === edge.id);
      if (!graphMode || !original) return; // route lines, cycle markers and +N links are not selectable
      setOpenNode(null);
      setFocus({ type: 'edge', id: original.id, from: original.from, to: original.to });
    },
    [graphMode, view, setOpenNode, setFocus],
  );

  const error = (graphMode && baseView.error) || expand.error;
  return (
    <>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={onNodeClick}
        onEdgeClick={onEdgeClick}
        onPaneClick={clearSelection}
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
        loading={graphMode ? baseView.isLoading : result !== null && routeNodes === undefined}
        error={error instanceof ApiRequestError ? error.message : error ? 'Something went wrong' : null}
        expanding={expand.isPending}
        focus={focusSummary}
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
