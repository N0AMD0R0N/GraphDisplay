import { useRef } from 'react';
import styled from 'styled-components';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useSchema } from '../api';
import { NO_VULNERABILITY_COLOR, routeSeverity, severityColor } from '../graph/severity';
import { useRouteNodes } from '../routeNodes';
import { useUI } from '../store';

const Panel = styled.div`
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  width: 440px;
  max-width: 92vw;
  height: 340px;
  display: flex;
  flex-direction: column;
  z-index: 30;
  background: ${(p) => p.theme.colors.surface};
  border: 1px solid ${(p) => p.theme.colors.border};
  border-radius: ${(p) => p.theme.radius};
  box-shadow: ${(p) => p.theme.shadow};
  header {
    padding: 8px 12px;
    font-size: 12px;
    color: ${(p) => p.theme.colors.muted};
    border-bottom: 1px solid ${(p) => p.theme.colors.surface2};
  }
  .scroller {
    flex: 1;
    overflow: auto;
  }
`;
const Row = styled.button<{ $active: boolean }>`
  position: absolute;
  left: 0;
  width: 100%;
  height: 46px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 3px;
  padding: 0 12px;
  text-align: left;
  cursor: pointer;
  border: 0;
  border-bottom: 1px solid ${(p) => p.theme.colors.surface2};
  background: ${(p) => (p.$active ? p.theme.colors.accentSoft : 'transparent')};
  &:hover {
    background: ${(p) => p.theme.colors.surface2};
  }
  .title {
    font-size: 13px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .strip {
    display: flex;
    gap: 2px;
  }
  .strip i {
    width: 14px;
    height: 5px;
    border-radius: 2px;
  }
`;

/** Expandable, virtualised list of the matching routes (WorkPlan C5). */
export function RouteList() {
  const { graphId, result, selected, selectRoute, setRouteListOpen } = useUI();
  const schema = useSchema(graphId).data;
  // properties of the nodes (names, kinds, vulnerabilities) are fetched separately from the routes
  const nodes = useRouteNodes();
  const scroller = useRef<HTMLDivElement>(null);
  const routes = result?.routes ?? [];
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual returns non-memoizable functions; no React Compiler here
  const virtual = useVirtualizer({
    count: routes.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => 46,
    overscan: 10,
    initialOffset: Math.max(0, selected - 3) * 46,
  });
  if (!result) return null;
  const color = (id: string) =>
    schema?.kinds.find((k) => k.kind === String(nodes?.[id]?.kind ?? 'unknown'))?.color ?? '#9aa0a6';

  return (
    <Panel>
      <header>
        {routes.length} route{routes.length === 1 ? '' : 's'}, longest first{result.truncated ? ' (truncated)' : ''}
        <div style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '2px 6px' }}>
          <span>Text colour = highest vulnerability severity on the route:</span>
          <i
            style={{
              width: 44,
              height: 8,
              borderRadius: 4,
              background: `linear-gradient(90deg, ${severityColor(0)}, ${severityColor(1)})`,
            }}
          />
          <span style={{ whiteSpace: 'nowrap' }}>low → critical</span>
          <i style={{ width: 8, height: 8, borderRadius: 4, background: NO_VULNERABILITY_COLOR }} />
          <span>none</span>
        </div>
      </header>
      <div className="scroller" ref={scroller}>
        <div style={{ height: virtual.getTotalSize(), position: 'relative' }}>
          {virtual.getVirtualItems().map((item) => {
            const r = routes[item.index];
            const name = (id: string) => String(nodes?.[id]?.name ?? id);
            const severity = routeSeverity(r.nodeIds, nodes ?? {}, schema?.severityScale ?? {});
            const severityName =
              severity.rank === null
                ? 'no vulnerabilities'
                : `highest severity: ${Object.entries(schema?.severityScale ?? {}).find(([, v]) => v === severity.rank)?.[0] ?? severity.rank}`;
            return (
              <Row
                key={r.id}
                type="button"
                $active={item.index === selected}
                style={{ top: item.start }}
                title={nodes ? severityName : 'loading…'}
                onClick={() => {
                  selectRoute(item.index);
                  setRouteListOpen(false);
                }}
              >
                {/* the text takes the colour of the route's highest vulnerability severity (black: none) */}
                <span
                  className="title"
                  data-severity-color={severity.color}
                  style={{
                    color: nodes ? severity.color : undefined,
                    fontWeight: nodes && severity.rank !== null ? 600 : undefined,
                  }}
                >
                  <b>#{item.index + 1}</b> · {r.length} node{r.length === 1 ? '' : 's'} · {name(r.nodeIds[0])}
                  {r.length > 1 ? ` → ${name(r.nodeIds[r.length - 1])}` : ''}
                  {r.closesTo ? ` ↺ ${name(r.closesTo)}` : ''}
                </span>
                <span className="strip">
                  {r.nodeIds.slice(0, 16).map((id, i) => (
                    <i key={`${id}${i}`} style={{ background: color(id) }} />
                  ))}
                </span>
              </Row>
            );
          })}
        </div>
      </div>
    </Panel>
  );
}
