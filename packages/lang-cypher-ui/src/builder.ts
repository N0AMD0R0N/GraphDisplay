import type { GraphSchema, Primitive, PropertyInfo } from '@gd/api-contract';
import type { Condition, ConditionTree, NodeRule, Operator, Position, RuleGroup, RuleValue } from '@gd/query-core';
import { POSITIONS } from '@gd/query-core';
import type { FullField, OptionGroup, RuleGroupType, RuleType } from 'react-querybuilder';

/**
 * Pure builder logic (no React): the query builder works on react-querybuilder's rule tree, the API on
 * ConditionTree. Fields are generated from the graph schema as `position|property.path` (WorkPlan B3).
 */

export const FIELD_SEP = '|';
export const LENGTH_FIELD = `length${FIELD_SEP}`;

export const POSITION_LABELS: Record<Position, string> = {
  first: 'First node',
  last: 'Last node',
  any: 'Any node',
  all: 'Every node',
  none: 'No node',
};

export const OPERATOR_LABELS: Record<Operator, string> = {
  eq: '=',
  neq: '≠',
  in: 'is one of (a, b)',
  contains: 'contains',
  startsWith: 'starts with',
  exists: 'exists',
  notExists: 'does not exist',
  gt: '>',
  gte: '≥',
  lt: '<',
  lte: '≤',
};

const UNARY: Operator[] = ['exists', 'notExists'];

export const fieldName = (position: Position, path: string): string => `${position}${FIELD_SEP}${path}`;

export type OperatorOption = {
  name: string;
  value: string;
  label: string;
  arity?: 'unary' | 'binary';
  [key: string]: unknown;
};

const op = (name: Operator, label = OPERATOR_LABELS[name]): OperatorOption => ({
  name,
  value: name,
  label,
  ...(UNARY.includes(name) ? { arity: 'unary' as const } : {}),
});

export function operatorsFor(info: PropertyInfo | undefined): OperatorOption[] {
  if (!info) return [op('eq'), op('neq'), op('exists'), op('notExists')];
  if (info.type === 'boolean') return [op('eq'), op('neq'), op('exists'), op('notExists')];
  if (info.type === 'number') {
    return [op('eq'), op('neq'), op('gt'), op('gte'), op('lt'), op('lte'), op('exists'), op('notExists')];
  }
  return [op('eq'), op('neq'), op('in'), op('contains'), op('startsWith'), op('exists'), op('notExists')];
}

export const LENGTH_OPERATORS: OperatorOption[] = [
  { name: 'gte', value: 'gte', label: 'at least' },
  { name: 'lte', value: 'lte', label: 'at most' },
  { name: 'eq', value: 'eq', label: 'exactly' },
];

export function buildFields(schema: GraphSchema | undefined): OptionGroup<FullField>[] {
  const properties = schema?.properties ?? [];
  const groups: OptionGroup<FullField>[] = POSITIONS.map((position) => ({
    label: POSITION_LABELS[position],
    options: properties.map((p) => ({
      name: fieldName(position, p.path),
      value: fieldName(position, p.path),
      label: `${POSITION_LABELS[position]} · ${p.path}`,
      inputType: p.type === 'number' ? 'number' : 'text',
    })),
  }));
  groups.push({
    label: 'Route',
    options: [{ name: LENGTH_FIELD, value: LENGTH_FIELD, label: 'Route length (nodes)', inputType: 'number' }],
  });
  return groups;
}

export function propertyOf(schema: GraphSchema | undefined, field: string): PropertyInfo | undefined {
  const path = field.slice(field.indexOf(FIELD_SEP) + 1);
  return schema?.properties.find((p) => p.path === path);
}

/** Selectable values for a property with few distinct values (and booleans). */
export function valueOptions(info: PropertyInfo | undefined): { name: string; value: string; label: string }[] | null {
  if (!info) return null;
  if (info.type === 'boolean') {
    return [
      { name: 'true', value: 'true', label: 'true' },
      { name: 'false', value: 'false', label: 'false' },
    ];
  }
  if (info.values && info.type === 'string' && info.values.length > 0) {
    return info.values.map((v) => ({
      name: String(v.value),
      value: String(v.value),
      label: `${v.value}  (${v.count})`,
    }));
  }
  return null;
}

// ------------------------------------------------------------- RQB <-> ConditionTree

let idCounter = 0;
const nextId = () => `q${++idCounter}`;

export interface RqbRule extends RuleType {
  id: string;
}

export function emptyRqb(): RuleGroupType {
  return { id: nextId(), combinator: 'and', rules: [] };
}

function coerce(raw: unknown, info: PropertyInfo | undefined): Primitive {
  if (typeof raw !== 'string') return raw as Primitive;
  const text = raw.trim();
  if (info?.type === 'boolean') return text === 'true';
  if (info?.type === 'number') return Number(text);
  return text;
}

export interface ConversionResult {
  tree: ConditionTree;
  /** Human readable problems; the query must not run while there are any. */
  errors: string[];
}

export function rqbToTree(group: RuleGroupType, schema: GraphSchema | undefined): ConversionResult {
  const errors: string[] = [];

  const convertRule = (rule: RuleType): Condition | null => {
    const sep = rule.field.indexOf(FIELD_SEP);
    if (sep < 0) return null;
    const position = rule.field.slice(0, sep);
    const path = rule.field.slice(sep + 1);
    const operator = rule.operator as string;
    const text = typeof rule.value === 'string' ? rule.value.trim() : rule.value;

    if (position === 'length') {
      const n = Number(text);
      if (!Number.isInteger(n) || n < 1) {
        errors.push('Route length needs a whole number of at least 1');
        return null;
      }
      if (operator === 'gte') return { type: 'length', min: n };
      if (operator === 'lte') return { type: 'length', max: n };
      return { type: 'length', min: n, max: n };
    }

    const info = propertyOf(schema, rule.field);
    const out: NodeRule = { type: 'rule', position: position as Position, path, op: operator as Operator };
    if (UNARY.includes(out.op)) return out;
    if (text === '' || text === undefined || text === null) {
      errors.push(`"${path}" needs a value`);
      return null;
    }
    if (out.op === 'in') {
      out.value = String(text)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => coerce(s, info));
      return out;
    }
    const value = coerce(text, info);
    if (typeof value === 'number' && Number.isNaN(value)) {
      errors.push(`"${path}" needs a number`);
      return null;
    }
    out.value = value;
    return out;
  };

  const convertGroup = (g: RuleGroupType): RuleGroup => ({
    type: 'group',
    combinator: g.combinator === 'or' ? 'or' : 'and',
    rules: g.rules
      .map((r) =>
        typeof r === 'string' ? null : 'rules' in r ? convertGroup(r as RuleGroupType) : convertRule(r as RuleType),
      )
      .filter((r): r is Condition => r !== null),
  });

  return { tree: convertGroup(group), errors };
}

const rqbValue = (value: RuleValue | undefined): string => {
  if (value === undefined) return '';
  return Array.isArray(value) ? value.join(', ') : String(value);
};

export function treeToRqb(tree: ConditionTree): RuleGroupType {
  const convert = (c: Condition): RuleType | RuleGroupType => {
    if (c.type === 'group') {
      return { id: nextId(), combinator: c.combinator, rules: c.rules.map(convert) };
    }
    if (c.type === 'length') {
      const exact = c.min !== undefined && c.min === c.max;
      return {
        id: nextId(),
        field: LENGTH_FIELD,
        operator: exact ? 'eq' : c.min !== undefined ? 'gte' : 'lte',
        value: String(c.min ?? c.max ?? ''),
      };
    }
    return { id: nextId(), field: fieldName(c.position, c.path), operator: c.op, value: rqbValue(c.value) };
  };
  return { id: nextId(), combinator: tree.combinator, rules: tree.rules.map(convert) };
}

/** Appends the rules of `extra` to `group` (used by the presets). */
export function appendRules(group: RuleGroupType, extra: RuleGroupType): RuleGroupType {
  return { ...group, rules: [...group.rules, ...extra.rules] };
}

// ------------------------------------------------------------------------- presets

export interface Preset {
  id: string;
  label: string;
  description: string;
  tree: ConditionTree;
}

const rule = (position: Position, path: string, o: Operator, value?: RuleValue): NodeRule => ({
  type: 'rule',
  position,
  path,
  op: o,
  ...(value === undefined ? {} : { value }),
});
const and = (...rules: Condition[]): ConditionTree => ({ type: 'group', combinator: 'and', rules });

export const severityRank = (schema: GraphSchema | undefined, name: string): number =>
  schema?.severityScale[name.trim().toLowerCase()] ?? 3;

/** Ready-made rules for the primary filters (WorkPlan B3.1, §3.9). They are builder trees, not Cypher text. */
export function basePresets(schema: GraphSchema | undefined): Preset[] {
  const high = severityRank(schema, 'high');
  return [
    {
      id: 'public-entry',
      label: 'Public entry',
      description: 'Routes that start in a publicly exposed service',
      tree: and(rule('first', 'publicExposed', 'eq', true)),
    },
    {
      id: 'ends-in-sink',
      label: 'Ends in sink',
      description: `Routes that end in a datastore (${(schema?.sinkKinds ?? ['rds', 'sqs']).join(', ')})`,
      tree: and(rule('last', '_isSink', 'eq', true)),
    },
    {
      id: 'has-vulnerability',
      label: 'Has vulnerability',
      description: 'Routes through a node with at least one vulnerability',
      tree: and(rule('any', 'vulnerabilities._count', 'gt', 0)),
    },
    {
      id: 'public-vuln-sink',
      label: 'Public → vulnerable → sink',
      description: 'From a public service, through a high-severity vulnerability, to a datastore',
      tree: and(
        rule('first', 'publicExposed', 'eq', true),
        rule('any', 'vulnerabilities._maxSeverityRank', 'gte', high),
        rule('last', '_isSink', 'eq', true),
      ),
    },
  ];
}

export const severityPreset = (schema: GraphSchema | undefined, severity: string): ConditionTree =>
  and(rule('any', 'vulnerabilities._maxSeverityRank', 'gte', severityRank(schema, severity)));

export const cwePreset = (cwe: string): ConditionTree =>
  and(rule('any', 'vulnerabilities.metadata.cwe', 'contains', cwe));

export function severityNames(schema: GraphSchema | undefined): string[] {
  return Object.entries(schema?.severityScale ?? {})
    .sort(([, a], [, b]) => a - b)
    .map(([name]) => name);
}

export function observedCwes(schema: GraphSchema | undefined): string[] {
  const info = schema?.properties.find((p) => p.path === 'vulnerabilities.metadata.cwe');
  return (info?.values ?? []).map((v) => String(v.value).split(':')[0]).filter((v, i, all) => all.indexOf(v) === i);
}
