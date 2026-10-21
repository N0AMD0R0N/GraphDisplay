import styled from 'styled-components';
import type { FocusSummary } from '../types';

const Root = styled.div`
  position: absolute;
  bottom: 14px;
  left: 50%;
  transform: translateX(-50%);
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 8px 6px 14px;
  max-width: calc(100% - 420px);
  font-size: 13px;
  background: ${(p) => p.theme.colors.accentSoft};
  border: 1px solid ${(p) => p.theme.colors.accent};
  border-radius: 18px;
  box-shadow: ${(p) => p.theme.shadow};
  span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  small {
    color: ${(p) => p.theme.colors.muted};
    white-space: nowrap;
  }
  button {
    border: 0;
    background: ${(p) => p.theme.colors.surface};
    border-radius: 12px;
    padding: 2px 10px;
    cursor: pointer;
  }
`;

/** What a click on a node or an edge highlights, with a button to clear it. */
export function FocusChip({ focus, onClear }: { focus: FocusSummary; onClear(): void }) {
  return (
    <Root>
      <span>
        <b>{focus.label}</b>
      </span>
      <small>
        {focus.nodes} node{focus.nodes === 1 ? '' : 's'}, {focus.edges} edge{focus.edges === 1 ? '' : 's'}
      </small>
      <button type="button" onClick={onClear}>
        Clear
      </button>
    </Root>
  );
}
