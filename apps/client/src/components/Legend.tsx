import styled, { useTheme } from 'styled-components';
import type { GraphSchema } from '@gd/api-contract';
import { severityColor } from '../lib/severity';

const Root = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  padding: 6px 10px;
  font-size: 12px;
  background: ${(p) => p.theme.colors.surface};
  border: 1px solid ${(p) => p.theme.colors.border};
  border-radius: ${(p) => p.theme.radius};
  span {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  i {
    width: 11px;
    height: 11px;
    border-radius: 50%;
    border: 1px solid ${(p) => p.theme.colors.swatchRing};
    display: inline-block;
  }
`;

/** Colour of each kind, the incomplete marker and the vulnerability scale. */
export function Legend({ kinds }: { kinds: GraphSchema['kinds'] }) {
  const theme = useTheme();
  return (
    <Root>
      {kinds.map((k) => (
        <span key={k.kind} title={`${k.count} node(s)`}>
          <i style={{ background: k.color }} /> {k.kind}
        </span>
      ))}
      <span>
        <i style={{ background: theme.colors.surface, borderStyle: 'dashed' }} /> incomplete
      </span>
      <span title="Nodes with vulnerabilities have a glowing border, from light orange (low severity) to pinkish red (critical)">
        <i
          style={{
            width: 34,
            borderRadius: 6,
            border: 'none',
            background: `linear-gradient(90deg, ${severityColor(0)}, ${severityColor(1)})`,
            boxShadow: `0 0 4px 1px ${severityColor(0.5)}b0`,
          }}
        />{' '}
        vulnerability
      </span>
    </Root>
  );
}
