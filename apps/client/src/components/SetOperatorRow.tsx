import styled from 'styled-components';
import type { SetOperator } from '@gd/query-core';

const Row = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 12px;
  font-size: 12px;
  color: ${(p) => p.theme.colors.muted};
  select {
    padding: 4px 6px;
    border-radius: 5px;
    border: 1px solid ${(p) => p.theme.colors.border};
  }
  &::before,
  &::after {
    content: '';
    flex: 1;
    border-top: 1px dashed ${(p) => p.theme.colors.border};
  }
`;

const opLabel = (op: SetOperator, name: string): string =>
  ({
    union: `Union: routes above OR in query ${name}`,
    intersect: `Intersection: routes above AND in query ${name}`,
    except: `Difference: routes above MINUS those of query ${name}`,
  })[op];
const OPERATORS: SetOperator[] = ['union', 'intersect', 'except'];

/** The select between two queries: how the routes of the query below combine with those above. */
export function SetOperatorRow({
  op,
  name,
  onChange,
}: {
  op: SetOperator;
  name: string;
  onChange(op: SetOperator): void;
}) {
  return (
    <Row>
      <select
        value={op}
        onChange={(e) => onChange(e.target.value as SetOperator)}
        aria-label={`Operation before query ${name}`}
      >
        {OPERATORS.map((o) => (
          <option key={o} value={o}>
            {opLabel(o, name)}
          </option>
        ))}
      </select>
    </Row>
  );
}
