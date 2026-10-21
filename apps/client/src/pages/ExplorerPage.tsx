import { useEffect } from 'react';
import styled from 'styled-components';
import { useGraphs } from '../api';
import { Canvas } from '../components/Canvas';
import { QueryDrawer } from '../components/QueryDrawer';
import { TopBar } from '../components/TopBar';
import { writeUrl } from '../lib/urlSync';
import { useUI } from '../store';

const Shell = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
`;
const Body = styled.div`
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
`;
const OpenButton = styled.button`
  position: absolute;
  top: 12px;
  left: 12px;
  z-index: 12;
  padding: 7px 14px;
  border-radius: 6px;
  border: 1px solid ${(p) => p.theme.colors.border};
  background: ${(p) => p.theme.colors.surface};
  box-shadow: ${(p) => p.theme.shadow};
  cursor: pointer;
  font-weight: 600;
`;

const isTyping = (el: EventTarget | null) =>
  el instanceof HTMLElement &&
  (el.matches('input, textarea, select') || el.isContentEditable || !!el.closest('.cm-editor'));

export function ExplorerPage() {
  const graphs = useGraphs();
  const { graphId, setGraphId, drawerOpen, toggleDrawer, clearSelection, setRouteListOpen, selectRoute } = useUI();
  const result = useUI((s) => s.result);
  const selected = useUI((s) => s.selected);
  const viewMode = useUI((s) => s.viewMode);

  // what is on screen is mirrored in the address bar (the query itself is written by the query panel)
  useEffect(() => {
    writeUrl({ graph: graphId ?? undefined });
  }, [graphId]);
  useEffect(() => {
    writeUrl({
      run: result ? true : undefined,
      route: result && selected > 0 ? selected : undefined,
      view: result ? viewMode : undefined,
    });
  }, [result, selected, viewMode]);

  // pick a graph once the list is known (the pinned seed graph first)
  useEffect(() => {
    if (graphs.data && graphs.data.length > 0 && !graphs.data.some((g) => g.graphId === graphId)) {
      setGraphId((graphs.data.find((g) => g.pinned) ?? graphs.data[0]).graphId);
    }
  }, [graphs.data, graphId, setGraphId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        clearSelection();
        setRouteListOpen(false);
      }
      if (isTyping(e.target)) return;
      const { selected } = useUI.getState();
      if (e.key === 'ArrowRight') selectRoute(selected + 1);
      if (e.key === 'ArrowLeft') selectRoute(selected - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [clearSelection, setRouteListOpen, selectRoute]);

  return (
    <Shell>
      <TopBar />
      <Body>
        <QueryDrawer />
        {!drawerOpen && (
          <OpenButton type="button" onClick={toggleDrawer} aria-label="Open query panel">
            » Query
          </OpenButton>
        )}
        <Canvas />
      </Body>
    </Shell>
  );
}
