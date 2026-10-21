import { useState } from 'react';
import styled from 'styled-components';
import { useSchema } from '../api';
import { useUI } from '../store';
import type { OverlaysProps } from '../types';
import { FocusChip } from './FocusChip';
import { Legend } from './Legend';

const Layer = styled.div`
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 5;
`;
const Center = styled.div`
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
`;
const Card = styled.div<{ $tone?: 'error' }>`
  pointer-events: auto;
  max-width: 420px;
  padding: 18px 22px;
  text-align: center;
  background: ${(p) => (p.$tone === 'error' ? p.theme.colors.dangerSoft : p.theme.colors.surface)};
  color: ${(p) => (p.$tone === 'error' ? p.theme.colors.danger : p.theme.colors.text)};
  border: 1px solid ${(p) => (p.$tone === 'error' ? p.theme.colors.danger : p.theme.colors.border)};
  border-radius: ${(p) => p.theme.radius};
  box-shadow: ${(p) => p.theme.shadow};
  h3 {
    margin: 0 0 6px;
  }
  p {
    margin: 4px 0;
    color: ${(p) => p.theme.colors.muted};
  }
`;
const Corner = styled.div<{ $pos: 'bl' | 'tl' }>`
  position: absolute;
  ${(p) => (p.$pos === 'bl' ? 'left: 12px; bottom: 12px;' : 'left: 12px; top: 12px;')}
  pointer-events: auto;
  max-width: 300px;
`;
const Chip = styled.button`
  border: 1px solid ${(p) => p.theme.colors.border};
  background: ${(p) => p.theme.colors.surface};
  border-radius: 16px;
  padding: 5px 12px;
  font-size: 12px;
  cursor: pointer;
  box-shadow: ${(p) => p.theme.shadow};
  &:hover {
    background: ${(p) => p.theme.colors.accentSoft};
  }
`;
const Popover = styled.div`
  margin-bottom: 8px;
  max-height: 280px;
  overflow: auto;
  background: ${(p) => p.theme.colors.surface};
  border: 1px solid ${(p) => p.theme.colors.border};
  border-radius: ${(p) => p.theme.radius};
  box-shadow: ${(p) => p.theme.shadow};
  font-size: 12px;
  button {
    display: block;
    width: 100%;
    text-align: left;
    background: none;
    border: 0;
    border-bottom: 1px solid ${(p) => p.theme.colors.surface2};
    padding: 7px 10px;
    cursor: pointer;
  }
  button:hover {
    background: ${(p) => p.theme.colors.accentSoft};
  }
  small {
    color: ${(p) => p.theme.colors.muted};
  }
`;
/** Empty / loading / error states and the "hidden components" and legend corners (WorkPlan C7, C9). */
export function Overlays({ view, loading, error, expanding, focus, onLoadComponent }: OverlaysProps) {
  const { graphId, viewMode, result, clearSelection } = useUI();
  const schema = useSchema(graphId).data;
  const [open, setOpen] = useState(false);
  const empty = viewMode === 'route' && result !== null && result.routes.length === 0;

  return (
    <Layer>
      {empty && (
        <Center>
          <Card>
            <h3>No routes match your query</h3>
            <p>Nothing in this graph satisfies all the conditions.</p>
            <p>
              Loosen a condition, or check that the property values exist in the graph (see the query builder's value
              lists).
            </p>
          </Card>
        </Center>
      )}
      {loading && (viewMode === 'route' || !view) && (
        <Center>
          <Card>
            <p>{viewMode === 'route' ? 'Loading the route…' : 'Loading the graph…'}</p>
          </Card>
        </Center>
      )}
      {error && (
        <Center>
          <Card $tone="error">
            <h3>Could not load the graph</h3>
            <p style={{ color: 'inherit' }}>{error}</p>
          </Card>
        </Center>
      )}
      {!graphId && !loading && (
        <Center>
          <Card>
            <h3>No graph yet</h3>
            <p>Upload a graph JSON from the top bar to get started.</p>
          </Card>
        </Center>
      )}

      {focus && <FocusChip focus={focus} onClear={clearSelection} />}

      {(schema?.kinds.length ?? 0) > 0 && (
        <Corner $pos="tl" style={{ left: 'auto', right: 12, top: 12 }}>
          <Legend kinds={schema!.kinds} />
        </Corner>
      )}

      {viewMode === 'graph' && view && (
        <Corner $pos="bl">
          {view.shownNodes < view.totalNodes && (
            <p style={{ margin: '0 0 6px', fontSize: 12 }}>
              Showing the {view.shownNodes} most connected of {view.totalNodes} nodes.
              {expanding ? ' Loading…' : ' Click a +N to load more.'}
            </p>
          )}
          {view.hiddenComponentCount > 0 && (
            <>
              {open && (
                <Popover>
                  {view.hiddenComponents.map((c) => (
                    <button
                      key={c.rootId}
                      type="button"
                      onClick={() => {
                        setOpen(false);
                        onLoadComponent(c.rootId);
                      }}
                    >
                      <b>{c.rootId}</b> · {c.size} node{c.size === 1 ? '' : 's'}
                      <br />
                      <small>{c.sample.join(', ')}</small>
                    </button>
                  ))}
                  {view.hiddenComponentCount > view.hiddenComponents.length && (
                    <button type="button" disabled>
                      <small>…and {view.hiddenComponentCount - view.hiddenComponents.length} more</small>
                    </button>
                  )}
                </Popover>
              )}
              <Chip type="button" onClick={() => setOpen(!open)}>
                {view.hiddenComponentCount} hidden component{view.hiddenComponentCount === 1 ? '' : 's'} ▴
              </Chip>
            </>
          )}
        </Corner>
      )}
    </Layer>
  );
}
