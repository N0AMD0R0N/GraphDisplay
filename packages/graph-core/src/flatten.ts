import { normalizeText, type FlatValue, type Primitive } from '@gd/api-contract';

type Out = Record<string, FlatValue>;

const isPrimitive = (v: unknown): v is Primitive =>
  typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const normalizePrimitive = (v: Primitive): Primitive => (typeof v === 'string' ? normalizeText(v) : v);

/** Recursively trims every string, keeping the original casing (this is what `_raw` stores). */
export function trimStrings<T>(value: T): T {
  if (typeof value === 'string') return value.trim() as T;
  if (Array.isArray(value)) return value.map((v) => trimStrings(v)) as T;
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = trimStrings(v);
    return out as T;
  }
  return value;
}

/**
 * Flattens a node into queryable Neo4j-compatible properties (WorkPlan §3.1):
 *  - nested objects use dot-path keys (`metadata.cloud`)
 *  - arrays of scalars become list properties
 *  - arrays of objects become one parallel list per leaf field plus `<key>._count`
 *  - strings are trimmed and lower-cased
 */
export function flattenNode(raw: Record<string, unknown>): Out {
  const out: Out = {};
  flattenInto('', raw, out);
  return out;
}

function flattenInto(prefix: string, value: unknown, out: Out): void {
  if (value === null || value === undefined) return;
  if (isPrimitive(value)) {
    if (prefix) out[prefix] = normalizePrimitive(value);
    return;
  }
  if (Array.isArray(value)) {
    flattenArray(prefix, value, out);
    return;
  }
  if (isPlainObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      flattenInto(prefix ? `${prefix}.${key}` : key, child, out);
    }
  }
}

function flattenArray(prefix: string, items: unknown[], out: Out): void {
  if (!prefix) return;
  const scalars = items.filter(isPrimitive).map(normalizePrimitive);
  const objects = items.filter(isPlainObject);
  if (scalars.length > 0 && objects.length === 0) {
    out[prefix] = scalars;
    return;
  }
  if (objects.length === 0) return;
  const acc = new Map<string, Primitive[]>();
  for (const obj of objects) {
    const tmp: Out = {};
    flattenInto('', obj, tmp);
    for (const [key, val] of Object.entries(tmp)) {
      const list = acc.get(key) ?? [];
      list.push(...(Array.isArray(val) ? val : [val]));
      acc.set(key, list);
    }
  }
  out[`${prefix}._count`] = objects.length;
  for (const [key, list] of acc) out[`${prefix}.${key}`] = list;
}
