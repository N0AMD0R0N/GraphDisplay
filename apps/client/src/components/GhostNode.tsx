import { memo } from 'react';
import styled from 'styled-components';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { GhostFlowNode } from '../types';
import { NodeBox } from './NodeBox';
import { NodeDot } from './NodeDot';
import { NodeLabel } from './NodeLabel';
import { HANDLE_X, handleStyle } from './nodeHandleStyle';

const GhostDot = styled(NodeDot)`
  background: transparent;
  border: 2px dashed ${(p) => p.$color};
  width: 22px;
  height: 22px;
  margin-top: 6px;
`;

/** Cycle marker: the route returns to a node of the route; distinct from a node (WorkPlan C4). */
export const GhostNode = memo(function GhostNode({ data }: NodeProps<GhostFlowNode>) {
  return (
    <NodeBox $dimmed={data.dimmed} title={`Returns to ${data.target}`}>
      <Handle
        type="target"
        position={Position.Left}
        style={{ ...handleStyle('left'), left: HANDLE_X + 2 }}
        isConnectable={false}
      />
      <GhostDot $color={data.color} $incomplete={false} $open={false} $pulse={false} />
      <NodeLabel style={{ fontStyle: 'italic' }}>↺ {data.target}</NodeLabel>
    </NodeBox>
  );
});
