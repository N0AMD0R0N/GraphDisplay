import { memo } from 'react';
import styled from 'styled-components';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { StubFlowNode } from '../types';

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
