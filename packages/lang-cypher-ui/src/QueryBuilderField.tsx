import { useMemo } from 'react';
import styled from 'styled-components';
import { QueryBuilder, type RuleGroupType } from 'react-querybuilder';
import 'react-querybuilder/dist/query-builder.css';
import type { GraphSchema } from '@gd/api-contract';
import { LENGTH_FIELD, LENGTH_OPERATORS, buildFields, operatorsFor, propertyOf, valueOptions } from './builder';

const Wrap = styled.div`
  font-size: 13px;
  .queryBuilder {
    --rqb-spacing: 0.35rem;
  }
  .ruleGroup {
    background: ${(p) => p.theme.colors.surface2};
    border: 1px solid ${(p) => p.theme.colors.border};
    border-radius: 6px;
    padding: 6px;
  }
  .ruleGroup .ruleGroup {
    background: #fff;
  }
  select,
  input {
    font: inherit;
    padding: 3px 5px;
    border: 1px solid ${(p) => p.theme.colors.border};
    border-radius: 4px;
    background: #fff;
    max-width: 100%;
  }
  .rule,
  .ruleGroup-header {
    flex-wrap: wrap;
  }
  .rule-fields {
    max-width: 210px;
  }
  button {
    font: inherit;
    cursor: pointer;
    border: 1px solid ${(p) => p.theme.colors.border};
    border-radius: 4px;
    background: #fff;
    padding: 2px 8px;
  }
  button:hover {
    background: #eef2fb;
  }
`;

export interface QueryBuilderFieldProps {
  schema?: GraphSchema;
  query: RuleGroupType;
  onChange(query: RuleGroupType): void;
}

/** react-querybuilder with fields generated from the graph schema (WorkPlan B3). */
export function QueryBuilderField({ schema, query, onChange }: QueryBuilderFieldProps) {
  const fields = useMemo(() => buildFields(schema), [schema]);
  return (
    <Wrap>
      <QueryBuilder
        fields={fields}
        query={query}
        onQueryChange={onChange}
        showCloneButtons={false}
        showNotToggle={false}
        resetOnFieldChange
        resetOnOperatorChange={false}
        controlClassnames={{ queryBuilder: 'queryBuilder' }}
        getOperators={(field) => (field === LENGTH_FIELD ? LENGTH_OPERATORS : operatorsFor(propertyOf(schema, field)))}
        getValueEditorType={(field, operator) => {
          if (field === LENGTH_FIELD || ['exists', 'notExists', 'in', 'contains', 'startsWith'].includes(operator))
            return 'text';
          return valueOptions(propertyOf(schema, field)) ? 'select' : 'text';
        }}
        getValues={(field) => valueOptions(propertyOf(schema, field)) ?? []}
        getDefaultOperator="eq"
        getDefaultValue={() => ''}
      />
    </Wrap>
  );
}
