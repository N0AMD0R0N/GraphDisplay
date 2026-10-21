import { useMemo } from 'react';
import styled from 'styled-components';
import { QueryBuilder, type RuleGroupType } from 'react-querybuilder';
import 'react-querybuilder/dist/query-builder.css';
import type { GraphSchema } from '@gd/api-contract';
import {
  LENGTH_FIELD,
  LENGTH_OPERATORS,
  buildFields,
  defaultValueFor,
  operatorsFor,
  propertyOf,
  syncSelectValues,
  valueEditorFor,
  valueOptions,
} from './builder';

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
    background: ${(p) => p.theme.colors.white};
  }
  select,
  input {
    font: inherit;
    padding: 3px 5px;
    border: 1px solid ${(p) => p.theme.colors.border};
    border-radius: 4px;
    background: ${(p) => p.theme.colors.white};
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
    background: ${(p) => p.theme.colors.white};
    padding: 2px 8px;
  }
  button:hover {
    background: ${(p) => p.theme.colors.hover};
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
        onQueryChange={(next) => onChange(syncSelectValues(next, query, schema))}
        showCloneButtons={false}
        showNotToggle={false}
        resetOnFieldChange
        resetOnOperatorChange={false}
        controlClassnames={{ queryBuilder: 'queryBuilder' }}
        getOperators={(field) => (field === LENGTH_FIELD ? LENGTH_OPERATORS : operatorsFor(propertyOf(schema, field)))}
        getValueEditorType={(field, operator) => valueEditorFor(schema, field, operator)}
        getValues={(field) => valueOptions(propertyOf(schema, field)) ?? []}
        getDefaultOperator="eq"
        getDefaultValue={(rule) => defaultValueFor(schema, rule.field, String(rule.operator))}
      />
    </Wrap>
  );
}
