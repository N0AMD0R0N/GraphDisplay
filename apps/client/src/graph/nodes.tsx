import { memo } from 'react';
import styled, { css } from 'styled-components';
import { Handle, NodeToolbar, Position, type Node, type NodeProps } from '@xyflow/react';
import type { GraphNode } from '@gd/api-contract';
import { NodeDetails } from './NodeDetails';

export const NODE_W = 120;
export const NODE_H = 56;
const DOT = 26;
const HANDLE_X = (NODE_W - DOT) / 2;

export type KindData = {
  label: string;
  color: string;
  incomplete: boolean;
  dimmed: boolean;
  open: boolean;
  pulsing: boolean;
  /** Border colour of a node with vulnerabilities: light orange (low) to pinkish red (critical). */
  severityColor?: string;
  node: GraphNode;
};
export type GhostData = { target: string; color: string; dimmed: boolean };
export type StubData = { count: number; nodeId: string; dimmed: boolean };

export type KindFlowNode = Node<KindData, 'kind'>;
export type GhostFlowNode = Node<GhostData, 'ghost'>;
export type StubFlowNode = Node<StubData, 'stub'>;

const Box = styled.div<{ $dimmed: boolean }>`
  width: ${NODE_W}px;
  height: ${NODE_H}px;
  display: flex;
  flex-direction: column;
  align-items: center;
  cursor: pointer;
  opacity: ${(p) => (p.$dimmed ? p.theme.colors.dim : 1)};
  transition: opacity 0.15s;
`;

const Dot = styled.div<{ $color: string; $incomplete: boolean; $open: boolean; $pulse: boolean; $warm?: string }>`
  width: ${DOT}px;
  height: ${DOT}px;
  margin-top: 4px;
  border-radius: 50%;
  background: ${(p) => (p.$incomplete ? p.theme.colors.surface : p.$color)};
  border: 2px ${(p) => (p.$incomplete ? 'dashed' : 'solid')} ${(p) => (p.$incomplete ? '#8d949e' : 'rgba(0,0,0,.18)')};
  ${(p) =>
    p.$warm &&
    css`
      border: 3px solid ${p.$warm};
      /* a soft glow, so the vulnerability marker differs from the crisp ring of a clicked node */
      box-shadow: 0 0 5px 1px ${p.$warm}b0;
    `}
  ${(p) =>
    p.$open &&
    css`
      outline: 3px solid ${p.theme.colors.accent};
      outline-offset: 1px;
    `}
  ${(p) =>
    p.$pulse &&
    css`
      animation: gd-pulse 0.8s ease-out 2;
    `}
`;

const Label = styled.div`
  margin-top: 4px;
  max-width: ${NODE_W - 2}px;
  font-size: 12px;
  line-height: 1.2;
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: ${(p) => p.theme.colors.text};
`;

const handleStyle = (side: 'left' | 'right') => ({
  opacity: 0,
  width: 1,
  height: 1,
  top: 4 + DOT / 2,
  [side]: HANDLE_X,
});

export const KindNode = memo(function KindNode({ data }: NodeProps<KindFlowNode>) {
  return (
    <Box $dimmed={data.dimmed} title={data.severityColor ? `${data.label} (has vulnerabilities)` : data.label}>
      <Handle type="target" position={Position.Left} style={handleStyle('left')} isConnectable={false} />
      <Dot
        $color={data.color}
        $incomplete={data.incomplete}
        $open={data.open}
        $pulse={data.pulsing}
        $warm={data.severityColor}
      />
      <Label>{data.label}</Label>
      <Handle type="source" position={Position.Right} style={handleStyle('right')} isConnectable={false} />
      <NodeToolbar isVisible={data.open} position={Position.Top} offset={10}>
        <NodeDetails node={data.node} />
      </NodeToolbar>
    </Box>
  );
});

const GhostDot = styled(Dot)`
  background: transparent;
  border: 2px dashed ${(p) => p.$color};
  width: 22px;
  height: 22px;
  margin-top: 6px;
`;

/** Cycle marker: the route returns to a node of the route; distinct from a node (WorkPlan C4). */
export const GhostNode = memo(function GhostNode({ data }: NodeProps<GhostFlowNode>) {
  return (
    <Box $dimmed={data.dimmed} title={`Returns to ${data.target}`}>
      <Handle
        type="target"
        position={Position.Left}
        style={{ ...handleStyle('left'), left: HANDLE_X + 2 }}
        isConnectable={false}
      />
      <GhostDot $color={data.color} $incomplete={false} $open={false} $pulse={false} />
      <Label style={{ fontStyle: 'italic' }}>↺ {data.target}</Label>
    </Box>
  );
});

const StubPill = styled.button<{ $dimmed: boolean }>`
  width: 52px;
  height: 26px;
  margin: 15px 0 0 2px;
  border-radius: 13px;
  border: 1.5px dashed ${(p) => p.theme.colors.edge};
  background: ${(p) => p.theme.colors.surface};
  color: ${(p) => p.theme.colors.text};
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  opacity: ${(p) => (p.$dimmed ? p.theme.colors.dim : 1)};
  &:hover {
    background: ${(p) => p.theme.colors.accentSoft};
    border-color: ${(p) => p.theme.colors.accent};
  }
`;

/** "+N" indicator for neighbours that are not displayed (WorkPlan C7). Clicking loads them. */
export const StubNode = memo(function StubNode({ data }: NodeProps<StubFlowNode>) {
  return (
    <div style={{ width: 56, height: 56 }}>
      <Handle type="target" position={Position.Left} style={{ opacity: 0, top: 28 }} isConnectable={false} />
      <StubPill type="button" $dimmed={data.dimmed} title={`${data.count} hidden neighbour(s): click to load`}>
        +{data.count}
      </StubPill>
    </div>
  );
});
