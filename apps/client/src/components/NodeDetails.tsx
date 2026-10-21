import styled, { useTheme } from 'styled-components';
import type { GraphNode } from '@gd/api-contract';

const Card = styled.div`
  width: 320px;
  max-height: 300px;
  overflow: auto;
  padding: 10px 12px;
  background: ${(p) => p.theme.colors.surface};
  border: 1px solid ${(p) => p.theme.colors.border};
  border-radius: ${(p) => p.theme.radius};
  box-shadow: ${(p) => p.theme.shadow};
  font-size: 12px;
  line-height: 1.45;
  text-align: left;
  cursor: default;
`;
const Head = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 6px;
  strong {
    font-size: 14px;
    word-break: break-all;
  }
  button {
    border: 1px solid ${(p) => p.theme.colors.border};
    background: ${(p) => p.theme.colors.surface2};
    border-radius: 4px;
    font-size: 11px;
    padding: 1px 6px;
    cursor: pointer;
  }
`;
const Row = styled.div`
  display: grid;
  grid-template-columns: 96px 1fr;
  gap: 6px;
  padding: 2px 0;
  border-top: 1px solid ${(p) => p.theme.colors.surface2};
  dt {
    color: ${(p) => p.theme.colors.muted};
    word-break: break-word;
  }
  dd {
    margin: 0;
    word-break: break-word;
  }
`;
const Badge = styled.span<{ $tone: 'warn' | 'bad' | 'muted' }>`
  display: inline-block;
  padding: 0 6px;
  border-radius: 9px;
  font-size: 11px;
  margin-right: 4px;
  background: ${(p) => (p.$tone === 'bad' ? p.theme.colors.dangerSoft : p.$tone === 'warn' ? p.theme.colors.warningSoft : p.theme.colors.surface2)};
  color: ${(p) => (p.$tone === 'bad' ? p.theme.colors.danger : p.$tone === 'warn' ? p.theme.colors.warning : p.theme.colors.muted)};
`;
const Details = styled.details`
  margin: 2px 0;
  summary {
    cursor: pointer;
    font-weight: 600;
  }
  .finding {
    margin: 4px 0 4px 10px;
    padding-left: 8px;
    border-left: 3px solid ${(p) => p.theme.colors.border};
  }
`;

interface Vulnerability {
  file?: string;
  severity?: string;
  message?: string;
  metadata?: Record<string, unknown>;
}

const tone = (severity?: string) => {
  const s = (severity ?? '').toLowerCase();
  return s === 'critical' || s === 'high' ? 'bad' : s === 'medium' ? 'warn' : 'muted';
};

function Value({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <>-</>;
  if (typeof value === 'object')
    return <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{JSON.stringify(value, null, 1)}</pre>;
  return <>{String(value)}</>;
}

/** Click-to-open card with all original node properties (WorkPlan C8). */
export function NodeDetails({ node }: { node: GraphNode }) {
  const theme = useTheme();
  const { id, name, incomplete, vulnerabilities, ...rest } = node;
  const findings = Array.isArray(vulnerabilities) ? (vulnerabilities as Vulnerability[]) : [];
  return (
    <Card className="nopan nodrag nowheel" onClick={(e) => e.stopPropagation()}>
      <Head>
        <strong>{String(name)}</strong>
        <button type="button" onClick={() => void navigator.clipboard?.writeText(JSON.stringify(node, null, 2))}>
          copy JSON
        </button>
      </Head>
      {incomplete && <Badge $tone="warn">incomplete: referenced by an edge but not defined in the input</Badge>}
      <dl style={{ margin: 0 }}>
        <Row>
          <dt>id</dt>
          <dd>{id}</dd>
        </Row>
        {Object.entries(rest).map(([key, value]) => (
          <Row key={key}>
            <dt>{key}</dt>
            <dd>
              <Value value={value} />
            </dd>
          </Row>
        ))}
      </dl>
      {findings.length > 0 && (
        <Details open>
          <summary>
            Vulnerabilities ({findings.length}){' '}
            {findings.map((f, i) => (
              <Badge key={i} $tone={tone(f.severity)}>
                {f.severity ?? '?'}
              </Badge>
            ))}
          </summary>
          {findings.map((f, i) => (
            <div className="finding" key={i}>
              <Badge $tone={tone(f.severity)}>{f.severity ?? 'unknown'}</Badge>
              {f.metadata?.cwe ? <span>{String(f.metadata.cwe)}</span> : null}
              <div>{f.message}</div>
              <div style={{ color: theme.colors.muted, wordBreak: 'break-all' }}>{f.file}</div>
            </div>
          ))}
        </Details>
      )}
    </Card>
  );
}
