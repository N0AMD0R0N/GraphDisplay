import { useEffect, useRef, useState } from 'react';
import { useIsFetching, useIsMutating, useQueryClient } from '@tanstack/react-query';
import styled from 'styled-components';
import { ApiRequestError, api, useGraphs } from '../api';
import { useUI } from '../store';
import { RouteList } from './RouteList';

const Bar = styled.header`
  position: relative;
  display: flex;
  align-items: center;
  gap: 14px;
  height: 48px;
  padding: 0 12px;
  background: ${(p) => p.theme.colors.surface};
  border-bottom: 1px solid ${(p) => p.theme.colors.border};
  z-index: 20;
`;
const Title = styled.div`
  font-weight: 700;
  letter-spacing: 0.2px;
`;
const Spacer = styled.div`
  flex: 1;
`;
const Btn = styled.button<{ $active?: boolean }>`
  padding: 5px 11px;
  border: 1px solid ${(p) => p.theme.colors.border};
  background: ${(p) => (p.$active ? p.theme.colors.accentSoft : p.theme.colors.surface)};
  border-color: ${(p) => (p.$active ? p.theme.colors.accent : p.theme.colors.border)};
  border-radius: 6px;
  cursor: pointer;
  white-space: nowrap;
  &:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  &:hover:not(:disabled) {
    background: ${(p) => p.theme.colors.surface2};
  }
`;
const Segmented = styled.div`
  display: inline-flex;
  button {
    border-radius: 0;
  }
  button:first-child {
    border-radius: 6px 0 0 6px;
  }
  button:last-child {
    border-radius: 0 6px 6px 0;
    margin-left: -1px;
  }
`;
const Select = styled.select`
  padding: 5px 8px;
  border: 1px solid ${(p) => p.theme.colors.border};
  border-radius: 6px;
  background: ${(p) => p.theme.colors.surface};
  max-width: 260px;
`;
const Stepper = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-variant-numeric: tabular-nums;
  .count {
    min-width: 118px;
    text-align: center;
  }
  .flag {
    color: ${(p) => p.theme.colors.warning};
    font-size: 12px;
  }
`;
const Progress = styled.div`
  position: absolute;
  left: 0;
  right: 0;
  bottom: -1px;
  height: 3px;
  overflow: hidden;
  &::after {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    width: 35%;
    background: ${(p) => p.theme.colors.accent};
    animation: gd-progress 1s linear infinite;
  }
`;
const Chip = styled.div<{ $tone?: 'warn' | 'info' }>`
  position: relative;
  button {
    border: 1px solid ${(p) => (p.$tone === 'warn' ? '#e8c36a' : p.theme.colors.border)};
    background: ${(p) => (p.$tone === 'warn' ? '#fff4d6' : p.theme.colors.surface2)};
    color: ${(p) => (p.$tone === 'warn' ? p.theme.colors.warning : p.theme.colors.text)};
    border-radius: 14px;
    padding: 3px 10px;
    font-size: 12px;
    cursor: pointer;
  }
  .pop {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    width: 420px;
    max-height: 300px;
    overflow: auto;
    padding: 8px 12px;
    background: ${(p) => p.theme.colors.surface};
    border: 1px solid ${(p) => p.theme.colors.border};
    border-radius: ${(p) => p.theme.radius};
    box-shadow: ${(p) => p.theme.shadow};
    font-size: 12px;
    z-index: 40;
  }
  .pop li {
    margin: 4px 0;
  }
`;
const Notice = styled.span<{ $error?: boolean }>`
  font-size: 12px;
  padding: 3px 10px;
  border-radius: 12px;
  background: ${(p) => (p.$error ? p.theme.colors.dangerSoft : '#e6f4ea')};
  color: ${(p) => (p.$error ? p.theme.colors.danger : '#1e6b3a')};
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

export function TopBar() {
  const client = useQueryClient();
  const graphs = useGraphs();
  const busy = useIsFetching() + useIsMutating() > 0;
  const ui = useUI();
  const [warnOpen, setWarnOpen] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 8000);
    return () => clearTimeout(t);
  }, [notice]);

  const current = graphs.data?.find((g) => g.graphId === ui.graphId);
  const warnings = current?.warnings ?? [];
  const routes = ui.result?.routes.length ?? 0;

  const upload = async (file: File) => {
    try {
      const { status, graph } = await api.upload(await file.text(), file.name.replace(/\.json$/i, ''));
      await client.invalidateQueries({ queryKey: ['graphs'] });
      ui.setGraphId(graph.graphId);
      setNotice({
        text:
          status === 207
            ? `Uploaded with ${graph.results?.length ?? 0} derived element(s): ${graph.results?.[0]?.message ?? ''}`
            : `Uploaded "${graph.name}": ${graph.counts.nodes} nodes, ${graph.counts.edges} edges`,
      });
    } catch (e) {
      setNotice({
        text: e instanceof ApiRequestError ? `Upload rejected (${e.status}): ${e.message}` : 'Upload failed',
        error: true,
      });
    }
  };

  return (
    <Bar>
      <Title>Graph Display</Title>
      <Select
        aria-label="Graph"
        value={ui.graphId ?? ''}
        onChange={(e) => ui.setGraphId(e.target.value || null)}
        disabled={!graphs.data?.length}
      >
        {!graphs.data?.length && <option value="">no graphs</option>}
        {graphs.data?.map((g) => (
          <option key={g.graphId} value={g.graphId}>
            {g.name} ({g.counts.nodes} nodes, {g.counts.edges} edges)
            {g.status === 'incomplete' ? ' ⚠' : ''}
          </option>
        ))}
      </Select>
      <input
        ref={fileInput}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
          e.target.value = '';
        }}
      />
      <Btn type="button" onClick={() => fileInput.current?.click()}>
        Upload JSON
      </Btn>
      {warnings.length > 0 && (
        <Chip $tone="warn">
          <button type="button" onClick={() => setWarnOpen(!warnOpen)}>
            ⚠ {warnings.length} warning{warnings.length === 1 ? '' : 's'}
          </button>
          {warnOpen && (
            <div className="pop">
              <ul style={{ margin: 0, paddingLeft: 16 }}>
                {warnings.map((w, i) => (
                  <li key={i}>
                    <b>{w.code}</b> {w.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Chip>
      )}
      {notice && <Notice $error={notice.error}>{notice.text}</Notice>}
      <Spacer />

      <Segmented role="group" aria-label="View mode">
        <Btn
          type="button"
          $active={ui.viewMode === 'route'}
          disabled={!ui.result}
          onClick={() => ui.setViewMode('route')}
        >
          Route only
        </Btn>
        <Btn type="button" $active={ui.viewMode === 'graph'} onClick={() => ui.setViewMode('graph')}>
          Whole graph
        </Btn>
      </Segmented>

      <Stepper aria-label="Route selector">
        <Btn
          type="button"
          disabled={routes < 2}
          onClick={() => ui.selectRoute(ui.selected - 1)}
          aria-label="Previous route"
        >
          ◀
        </Btn>
        <span className="count">
          {ui.result
            ? routes
              ? `${ui.selected + 1} / ${routes} ${routes === 1 ? 'route' : 'routes'}`
              : '0 routes'
            : 'no query'}
        </span>
        <Btn
          type="button"
          disabled={routes < 2}
          onClick={() => ui.selectRoute(ui.selected + 1)}
          aria-label="Next route"
        >
          ▶
        </Btn>
        {ui.result?.truncated && <span className="flag">(truncated)</span>}
        <div style={{ position: 'relative' }}>
          <Btn
            type="button"
            disabled={routes === 0}
            $active={ui.routeListOpen}
            onClick={() => ui.setRouteListOpen(!ui.routeListOpen)}
          >
            List ▾
          </Btn>
          {ui.routeListOpen && <RouteList />}
        </div>
      </Stepper>
      {busy && <Progress role="progressbar" aria-label="Loading" />}
    </Bar>
  );
}
