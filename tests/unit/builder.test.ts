import { DEFAULT_CONFIG, discoverSchema, finalizeGraph, parseGraph } from '@gd/graph-core';
import { compileBuilder, exportRawText, prepareRaw } from '@gd/lang-cypher';
import type { CompileContext, ConditionTree } from '@gd/query-core';
import {
  LENGTH_FIELD,
  basePresets,
  buildFields,
  cwePreset,
  defaultValueFor,
  emptyRqb,
  fieldName,
  observedCwes,
  operatorsFor,
  propertyOf,
  rqbToTree,
  severityNames,
  severityPreset,
  severityRank,
  syncSelectValues,
  treeToRqb,
  valueEditorFor,
  valueOptions,
} from '../../packages/lang-cypher-ui/src/builder';
import { fixture } from '../setup/fixtures';

const parsed = parseGraph(fixture('security.json'));
if (!parsed.ok) throw new Error('fixture');
const { graph } = finalizeGraph(parsed.graph);
const schema = discoverSchema('g1', graph.nodes, graph.edges.length, DEFAULT_CONFIG);
const ctx: CompileContext = { graphId: 'g1', maxHops: 50, limit: 1000, routeMode: 'all', schema };

const rqb = (...rules: { field: string; operator: string; value?: unknown }[]) => ({
  ...emptyRqb(),
  rules: rules.map((r, i) => ({ id: `r${i}`, value: '', ...r })),
});

describe('builder fields generated from the schema (WorkPlan B3)', () => {
  const groups = buildFields(schema);

  it('offers every property for every position, grouped by position, plus the route length', () => {
    expect(groups.map((g) => g.label)).toEqual([
      'First node',
      'Last node',
      'Any node',
      'Every node',
      'No node',
      'Route',
    ]);
    const first = groups[0].options.map((o) => o.name);
    expect(first).toContain('first|publicExposed');
    expect(first).toContain('first|vulnerabilities.metadata.cwe');
    expect(first).toContain('first|_isSink');
    expect(groups[5].options.map((o) => o.name)).toEqual([LENGTH_FIELD]);
    expect(groups[0].options).toHaveLength(schema.properties.length);
  });

  it('chooses operators by type: booleans, numbers and strings', () => {
    const names = (path: string) => operatorsFor(propertyOf(schema, fieldName('any', path))).map((o) => o.name);
    expect(names('publicExposed')).toEqual(['eq', 'neq', 'exists', 'notExists']);
    expect(names('vulnerabilities._count')).toContain('gte');
    expect(names('kind')).toContain('contains');
    expect(names('vulnerabilities._count')).not.toContain('contains');
    expect(operatorsFor(undefined).map((o) => o.name)).toContain('eq');
    expect(operatorsFor(propertyOf(schema, 'any|kind')).find((o) => o.name === 'exists')!.arity).toBe('unary');
  });

  it('offers selectable values for booleans and low-cardinality strings only', () => {
    expect(valueOptions(propertyOf(schema, 'first|publicExposed'))!.map((o) => o.value)).toEqual(['true', 'false']);
    expect(valueOptions(propertyOf(schema, 'first|kind'))!.map((o) => o.value)).toEqual(['service', 'rds', 'sqs']);
    expect(valueOptions(propertyOf(schema, 'first|vulnerabilities._count'))).toBeNull();
    expect(valueOptions(undefined)).toBeNull();
  });
});

describe('rqbToTree', () => {
  it('converts rules, coercing values by property type', () => {
    const { tree, errors } = rqbToTree(
      rqb(
        { field: 'first|publicExposed', operator: 'eq', value: 'true' },
        { field: 'any|vulnerabilities._count', operator: 'gt', value: '0' },
        { field: 'last|kind', operator: 'in', value: 'rds, sqs' },
        { field: 'any|vulnerabilities.metadata.cwe', operator: 'contains', value: ' CWE-89 ' },
        { field: 'first|publicExposed', operator: 'notExists' },
      ),
      schema,
    );
    expect(errors).toEqual([]);
    expect(tree.rules).toEqual([
      { type: 'rule', position: 'first', path: 'publicExposed', op: 'eq', value: true },
      { type: 'rule', position: 'any', path: 'vulnerabilities._count', op: 'gt', value: 0 },
      { type: 'rule', position: 'last', path: 'kind', op: 'in', value: ['rds', 'sqs'] },
      { type: 'rule', position: 'any', path: 'vulnerabilities.metadata.cwe', op: 'contains', value: 'CWE-89' },
      { type: 'rule', position: 'first', path: 'publicExposed', op: 'notExists' },
    ]);
  });

  it('converts the route length operators to min / max / exact', () => {
    const { tree } = rqbToTree(
      rqb(
        { field: LENGTH_FIELD, operator: 'gte', value: '3' },
        { field: LENGTH_FIELD, operator: 'lte', value: '6' },
        { field: LENGTH_FIELD, operator: 'eq', value: '4' },
      ),
      schema,
    );
    expect(tree.rules).toEqual([
      { type: 'length', min: 3 },
      { type: 'length', max: 6 },
      { type: 'length', min: 4, max: 4 },
    ]);
  });

  it('keeps nested groups and their combinators', () => {
    const inner = { ...rqb({ field: 'first|kind', operator: 'eq', value: 'rds' }), combinator: 'or' };
    const outer = { ...rqb(), rules: [inner, { id: 'x', field: 'last|_isSink', operator: 'eq', value: 'true' }] };
    const { tree } = rqbToTree(outer as never, schema);
    expect(tree.rules[0]).toMatchObject({ type: 'group', combinator: 'or' });
    expect(tree.rules[1]).toMatchObject({ type: 'rule', value: true });
  });

  it('reports missing and invalid values instead of sending a broken query', () => {
    const { errors, tree } = rqbToTree(
      rqb(
        { field: 'first|kind', operator: 'eq', value: '' },
        { field: 'any|vulnerabilities._count', operator: 'gt', value: 'many' },
        { field: LENGTH_FIELD, operator: 'gte', value: '0' },
      ),
      schema,
    );
    expect(errors).toEqual([
      '"kind" needs a value',
      '"vulnerabilities._count" needs a number',
      'Route length needs a whole number of at least 1',
    ]);
    expect(tree.rules).toEqual([]);
  });

  it('an empty builder is a valid query for all routes', () => {
    expect(rqbToTree(emptyRqb(), schema)).toEqual({
      tree: { type: 'group', combinator: 'and', rules: [] },
      errors: [],
    });
  });
});

describe('treeToRqb', () => {
  it('round-trips through the builder model', () => {
    const tree: ConditionTree = {
      type: 'group',
      combinator: 'and',
      rules: [
        { type: 'rule', position: 'first', path: 'publicExposed', op: 'eq', value: true },
        { type: 'rule', position: 'last', path: 'kind', op: 'in', value: ['rds', 'sqs'] },
        { type: 'length', min: 2, max: 2 },
        { type: 'length', max: 5 },
        {
          type: 'group',
          combinator: 'or',
          rules: [{ type: 'rule', position: 'any', path: 'vulnerabilities._count', op: 'gt', value: 0 }],
        },
      ],
    };
    const back = rqbToTree(treeToRqb(tree), schema);
    expect(back.errors).toEqual([]);
    expect(back.tree).toEqual(tree);
  });

  it('gives every rule and group a unique id', () => {
    const ids = new Set<string>();
    const walk = (g: { id?: string; rules: unknown[] }) => {
      ids.add(g.id!);
      for (const r of g.rules as { id?: string; rules?: unknown[] }[]) {
        if (r.rules) walk(r as never);
        else ids.add(r.id!);
      }
    };
    const all = treeToRqb({
      type: 'group',
      combinator: 'and',
      rules: basePresets(schema).flatMap((p) => p.tree.rules),
    });
    walk(all as never);
    expect(ids.size).toBe(basePresets(schema).flatMap((p) => p.tree.rules).length + 1);
  });
});

describe('presets (WorkPlan B3.1)', () => {
  const presets = Object.fromEntries(basePresets(schema).map((p) => [p.id, p]));

  it('are builder trees, not Cypher text, and cover the primary filters', () => {
    expect(Object.keys(presets)).toEqual(['public-entry', 'ends-in-sink', 'has-vulnerability', 'public-vuln-sink']);
    expect(presets['public-entry'].tree.rules).toEqual([
      { type: 'rule', position: 'first', path: 'publicExposed', op: 'eq', value: true },
    ]);
    expect(presets['ends-in-sink'].tree.rules).toEqual([
      { type: 'rule', position: 'last', path: '_isSink', op: 'eq', value: true },
    ]);
    expect(presets['ends-in-sink'].description).toContain('rds, sqs');
  });

  it('the combined preset asks for a high-severity vulnerability (rank from the schema scale)', () => {
    expect(presets['public-vuln-sink'].tree.rules).toContainEqual({
      type: 'rule',
      position: 'any',
      path: 'vulnerabilities._maxSeverityRank',
      op: 'gte',
      value: 3,
    });
  });

  it('every preset compiles to Cypher that the raw validator accepts as well', () => {
    for (const p of [
      ...Object.values(presets),
      { id: 'sev', tree: severityPreset(schema, 'Medium') },
      { id: 'cwe', tree: cwePreset('CWE-89') },
    ]) {
      const query = compileBuilder(p.tree, ctx);
      expect(query.text).toContain('graphId: $g');
      expect(() => prepareRaw(exportRawText(p.tree, ctx), ctx)).not.toThrow();
    }
  });

  it('severity and CWE helpers read the schema', () => {
    expect(severityNames(schema)).toEqual(['info', 'low', 'medium', 'high', 'critical']);
    expect(severityRank(schema, ' Medium ')).toBe(2);
    expect(severityRank(undefined, 'high')).toBe(3);
    expect(observedCwes(schema).sort()).toEqual(['cwe-22', 'cwe-79', 'cwe-89']);
  });
});

describe('dropdown values (a rule must hold what its dropdown shows)', () => {
  const rule = (id: string, field: string, operator: string, value: unknown) => ({ id, field, operator, value });
  const group = (...rules: unknown[]) => ({ ...emptyRqb(), rules }) as never;

  it('chooses the editor of a value: a dropdown for few observed values, otherwise a text box', () => {
    expect(valueEditorFor(schema, 'first|kind', 'eq')).toBe('select');
    expect(valueEditorFor(schema, 'first|kind', 'neq')).toBe('select');
    expect(valueEditorFor(schema, 'first|publicExposed', 'eq')).toBe('select');
    expect(valueEditorFor(schema, 'first|kind', 'contains')).toBe('text');
    expect(valueEditorFor(schema, 'first|kind', 'in')).toBe('text');
    expect(valueEditorFor(schema, 'first|vulnerabilities._count', 'gt')).toBe('text');
    expect(valueEditorFor(schema, LENGTH_FIELD, 'gte')).toBe('text');
  });

  it('a new rule starts with the first option its dropdown displays', () => {
    expect(defaultValueFor(schema, 'first|kind')).toBe('service'); // the most frequent kind comes first
    expect(defaultValueFor(schema, 'first|publicExposed')).toBe('true');
    expect(defaultValueFor(schema, 'first|kind', 'contains')).toBe(''); // a text box starts empty
    expect(defaultValueFor(schema, 'first|vulnerabilities._count')).toBe('');
    expect(defaultValueFor(schema, LENGTH_FIELD, 'gte')).toBe('');
    expect(defaultValueFor(undefined, 'first|kind')).toBe('');
  });

  it('the reported problem: a kind rule that shows "service" is complete and does not block the query', () => {
    // what the builder held before the fix: the dropdown displayed "service" but the value was empty
    const stale = group(rule('r1', 'first|kind', 'eq', ''));
    expect(rqbToTree(stale, schema).errors).toEqual(['"kind" needs a value']);
    const fixed = syncSelectValues(stale, undefined, schema);
    expect(rqbToTree(fixed, schema).errors).toEqual([]);
    expect(rqbToTree(fixed, schema).tree.rules).toEqual([
      { type: 'rule', position: 'first', path: 'kind', op: 'eq', value: 'service' },
    ]);
    // and a rule created with the default value is complete from the start
    const created = group(rule('r2', 'last|kind', 'eq', defaultValueFor(schema, 'last|kind')));
    expect(rqbToTree(created, schema).errors).toEqual([]);
  });

  it('keeps the value when the user picked one, or when it comes from a shared URL', () => {
    const picked = group(rule('r1', 'first|kind', 'eq', 'rds'));
    expect(syncSelectValues(picked, picked, schema)).toBe(picked); // nothing to change: the same object
    const fromUrl = group(rule('r1', 'first|kind', 'eq', 'cache')); // not an observed kind
    expect(syncSelectValues(fromUrl, undefined, schema)).toBe(fromUrl);
  });

  it('gives the first option when the operator changes from a text operator to a dropdown one', () => {
    const before = group(rule('r1', 'first|kind', 'contains', 'serv'));
    const after = group(rule('r1', 'first|kind', 'eq', 'serv'));
    const synced = syncSelectValues(after, before, schema) as { rules: { value: string }[] };
    expect(synced.rules[0].value).toBe('service');
    // dropdown to dropdown keeps the choice
    const sameKind = group(rule('r1', 'first|kind', 'neq', 'rds'));
    expect(syncSelectValues(sameKind, group(rule('r1', 'first|kind', 'eq', 'rds')), schema)).toBe(sameKind);
  });

  it('leaves text values, unary operators and the route length alone', () => {
    const text = group(
      rule('r1', 'first|kind', 'contains', ''),
      rule('r2', 'first|kind', 'exists', ''),
      rule('r3', LENGTH_FIELD, 'gte', ''),
    );
    expect(syncSelectValues(text, undefined, schema)).toBe(text);
  });

  it('reaches rules inside nested groups', () => {
    const nested = group({ ...emptyRqb(), combinator: 'or', rules: [rule('r1', 'last|publicExposed', 'eq', '')] });
    const synced = syncSelectValues(nested, undefined, schema) as { rules: { rules: { value: string }[] }[] };
    expect(synced.rules[0].rules[0].value).toBe('true');
  });
});
