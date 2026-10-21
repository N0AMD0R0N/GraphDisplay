import { memo } from 'react';
import { Handle, NodeToolbar, Position, type NodeProps } from '@xyflow/react';
import type { KindFlowNode } from '../types';
import { NodeBox } from './NodeBox';
import { NodeDetails } from './NodeDetails';
import { NodeDot } from './NodeDot';
import { NodeLabel } from './NodeLabel';
import { handleStyle } from './nodeHandleStyle';

export const KindNode = memo(function KindNode({ data }: NodeProps<KindFlowNode>) {
  return (
    <NodeBox $dimmed={data.dimmed} title={data.severityColor ? `${data.label} (has vulnerabilities)` : data.label}>
      <Handle type="target" position={Position.Left} style={handleStyle('left')} isConnectable={false} />
      <NodeDot
        $color={data.color}
        $incomplete={data.incomplete}
        $open={data.open}
        $pulse={data.pulsing}
        $warm={data.severityColor}
      />
      <NodeLabel>{data.label}</NodeLabel>
      <Handle type="source" position={Position.Right} style={handleStyle('right')} isConnectable={false} />
      <NodeToolbar isVisible={data.open} position={Position.Top} offset={10}>
        <NodeDetails node={data.node} />
      </NodeToolbar>
    </NodeBox>
  );
});
