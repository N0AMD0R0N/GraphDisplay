import { normalizeText, type GraphSchema, type PropertyInfo } from '@gd/api-contract';
import {
  QueryError,
  type CompileContext,
  type Condition,
  type ConditionTree,
  type NativeQuery,
  type NodeRule,
  type RuleValue,
} from '@gd/query-core';

export const LANGUAGE_ID = 'cypher';

const esc = (path: string): string => '`' + path.replace(/`/g, '``') + '`';

class Params {
  values: Record<string, unknown> = {};
  private n = 0;
  add(value: unknown): string {
    const key = `p${this.n++}`;
    this.values[key] = value;
    return `$${key}`;
  }
}

function normalizeValue(value: RuleValue): RuleValue {
  if (Array.isArray(value)) return value.map((v) => (typeof v === 'string' ? normalizeText(v) : v));
  return typeof value === 'string' ? normalizeText(value) : value;
}

function infoFor(schema: GraphSchema | undefined, path: string): PropertyInfo | undefined {
  return schema?.properties.find((p) => p.path === path);
}

/** Predicate on a single node variable `v` (A4.7: values are normalised like the stored copies). */
function nodePredicate(v: string, rule: NodeRule, ctx: CompileContext, params: Params): string {
  const prop = `${v}.${esc(rule.path)}`;
  const list = infoFor(ctx.schema, rule.path)?.list ?? false;
  if (rule.op === 'exists') return `${prop} IS NOT NULL`;
  if (rule.op === 'notExists') return `${prop} IS NULL`;
  if (rule.value === undefined) {
    throw new QueryError(`Rule on "${rule.path}" needs a value for operator "${rule.op}"`);
  }
  const scalarOps = ['eq', 'neq', 'contains', 'startsWith', 'gt', 'gte', 'lt', 'lte'];
  if (scalarOps.includes(rule.op) && Array.isArray(rule.value)) {
    throw new QueryError(`Operator "${rule.op}" on "${rule.path}" needs a single value`);
  }
  const value = rule.op === 'in' && !Array.isArray(rule.value) ? [rule.value] : rule.value;
  const p = params.add(normalizeValue(value));
  const items = `coalesce(${prop}, [])`;
  const cmp = (sym: string) => (list ? `any(x IN ${items} WHERE x ${sym} ${p})` : `${prop} ${sym} ${p}`);
  switch (rule.op) {
    case 'eq':
      return list ? `${p} IN ${prop}` : `${prop} = ${p}`;
    case 'neq':
      return list ? `NOT (${p} IN ${items})` : `(${prop} IS NULL OR ${prop} <> ${p})`;
    case 'in':
      return list ? `any(x IN ${items} WHERE x IN ${p})` : `${prop} IN ${p}`;
    case 'contains':
      return cmp('CONTAINS');
    case 'startsWith':
      return cmp('STARTS WITH');
    case 'gt':
      return cmp('>');
    case 'gte':
      return cmp('>=');
    case 'lt':
      return cmp('<');
    case 'lte':
      return cmp('<=');
    default:
      throw new QueryError(`Unknown operator "${String(rule.op)}"`);
  }
}

function routePredicate(c: Condition, ctx: CompileContext, params: Params): string {
  if (c.type === 'rule') {
    switch (c.position) {
      case 'first':
        return nodePredicate('a', c, ctx, params);
      case 'last':
        return nodePredicate('b', c, ctx, params);
      case 'any':
        return `any(n IN nodes(p) WHERE ${nodePredicate('n', c, ctx, params)})`;
      case 'all':
        return `all(n IN nodes(p) WHERE ${nodePredicate('n', c, ctx, params)})`;
      case 'none':
        return `none(n IN nodes(p) WHERE ${nodePredicate('n', c, ctx, params)})`;
      default:
        throw new QueryError(`Unknown position "${String(c.position)}"`);
    }
  }
  if (c.type === 'length') {
    const parts: string[] = [];
    for (const [sym, n] of [
      ['>=', c.min],
      ['<=', c.max],
    ] as const) {
      if (n === undefined) continue;
      if (!Number.isInteger(n) || n < 1) throw new QueryError('Route length bounds must be positive integers');
      parts.push(`length(p) + 1 ${sym} ${n}`);
    }
    return parts.length ? `(${parts.join(' AND ')})` : 'true';
  }
  const parts = c.rules.map((r) => routePredicate(r, ctx, params)).filter((s) => s !== 'true');
  if (parts.length === 0) return 'true';
  return `(${parts.join(c.combinator === 'and' ? ' AND ' : ' OR ')})`;
}

/** Estimated number of nodes matching a rule, from the stored schema (A4.6). */
export function estimateMatches(rule: NodeRule, schema: GraphSchema | undefined): number {
  const total = schema?.nodeCount ?? 1000;
  const info = infoFor(schema, rule.path);
  if (!schema) return total;
  if (!info) return rule.op === 'notExists' ? total : 0;
  if (rule.op === 'exists') return info.count;
  if (rule.op === 'notExists') return Math.max(0, total - info.count);
  if (!info.values) return info.count;
  const wanted = (Array.isArray(rule.value) ? rule.value : [rule.value]).map((v) =>
    typeof v === 'string' ? normalizeText(v) : v,
  );
  const sum = (pred: (v: string | number | boolean) => boolean) =>
    info.values!.reduce((s, x) => (pred(x.value) ? s + x.count : s), 0);
  switch (rule.op) {
    case 'eq':
    case 'in':
      return sum((v) => wanted.includes(v));
    case 'neq':
      return Math.max(0, total - sum((v) => wanted.includes(v)));
    case 'contains':
      return sum((v) => String(v).includes(String(wanted[0])));
    case 'startsWith':
      return sum((v) => String(v).startsWith(String(wanted[0])));
    default:
      return info.count;
  }
}

type Anchor = { position: 'first' | 'last' | 'any'; rule: NodeRule; index: number };

function chooseAnchor(tree: ConditionTree, ctx: CompileContext): Anchor | null {
  if (!(tree.combinator === 'and' || tree.rules.length === 1)) return null;
  const total = ctx.schema?.nodeCount ?? 1000;
  let best: (Anchor & { est: number }) | null = null;
  tree.rules.forEach((c, index) => {
    if (c.type !== 'rule') return;
    if (c.position !== 'first' && c.position !== 'last' && c.position !== 'any') return;
    const est = estimateMatches(c, ctx.schema);
    if (c.position === 'any' && est > total / 2) return;
    const better = !best || est < best.est || (est === best.est && c.position !== 'any' && best.position === 'any');
    if (better) best = { position: c.position, rule: c, index, est };
  });
  return best;
}

function assertContext(ctx: CompileContext): void {
  for (const [name, n] of [
    ['maxHops', ctx.maxHops],
    ['limit', ctx.limit],
  ] as const) {
    if (!Number.isInteger(n) || n < 1) throw new QueryError(`${name} must be a positive integer`);
  }
}

/** Compiles a builder condition tree to Cypher. The graph scope, hop limit and LIMIT are always enforced. */
export function compileBuilder(tree: ConditionTree, ctx: CompileContext): NativeQuery {
  assertContext(ctx);
  const params = new Params();
  const h = ctx.maxHops;
  const anchor = chooseAnchor(tree, ctx);

  const rest: string[] = [];
  if (anchor) {
    tree.rules.forEach((c, i) => {
      if (i !== anchor.index) rest.push(routePredicate(c, ctx, params));
    });
  } else {
    rest.push(routePredicate(tree, ctx, params));
  }

  let head: string;
  const where: string[] = [];
  if (!anchor) {
    head = `MATCH p = (a:Node {graphId: $g})-[:CALLS*0..${h}]->(b:Node)`;
  } else if (anchor.position === 'first') {
    head =
      `MATCH (a:Node {graphId: $g}) WHERE ${nodePredicate('a', anchor.rule, ctx, params)}\n` +
      `MATCH p = (a)-[:CALLS*0..${h}]->(b:Node)`;
  } else if (anchor.position === 'last') {
    head =
      `MATCH (b:Node {graphId: $g}) WHERE ${nodePredicate('b', anchor.rule, ctx, params)}\n` +
      `MATCH p = (a:Node)-[:CALLS*0..${h}]->(b)`;
  } else {
    head =
      `MATCH (v:Node {graphId: $g}) WHERE ${nodePredicate('v', anchor.rule, ctx, params)}\n` +
      `MATCH p = (a:Node)-[:CALLS*0..${h}]->(v)-[:CALLS*0..${h}]->(b:Node)`;
    where.push(`length(p) <= ${h}`);
  }

  where.push('all(x IN nodes(p) WHERE single(y IN nodes(p) WHERE y = x))');
  if (ctx.routeMode === 'maximal') {
    where.push('NOT EXISTS { MATCH (:Node)-[:CALLS]->(a) }', 'NOT EXISTS { MATCH (b)-[:CALLS]->(:Node) }');
  }
  where.push(...rest.filter((s) => s !== 'true'));

  const distinct = anchor?.position === 'any' ? 'WITH DISTINCT p\n' : '';
  const text =
    `${head}\nWHERE ${where.join('\n  AND ')}\n${distinct}` +
    `RETURN p AS r\nORDER BY length(p) DESC, [x IN nodes(p) | x.id]\nLIMIT ${ctx.limit + 1}`;

  return { language: LANGUAGE_ID, kind: 'builder', text, params: { g: ctx.graphId, ...params.values } };
}

function literal(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(literal).join(', ')}]`;
  if (typeof value === 'string') return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  return String(value);
}

/**
 * Builder -> raw text export (one-way, B4): the compiled query with literal values instead of
 * parameters. Only `$g` stays, so the text is valid for the raw editor.
 */
export function exportRawText(tree: ConditionTree, ctx: CompileContext): string {
  const q = compileBuilder(tree, ctx);
  return q.text.replace(/\$p(\d+)\b/g, (_m, n: string) => literal(q.params[`p${n}`]));
}
