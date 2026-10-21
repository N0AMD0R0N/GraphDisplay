import { QueryError, type CompileContext, type NativeQuery } from '@gd/query-core';
import { LANGUAGE_ID } from './compile';

/** Replaces string literals, quoted identifiers and comments with filler so keywords can be scanned safely. */
export function maskLiterals(text: string): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    const next = text[i + 1];
    if (c === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') {
        out += ' ';
        i++;
      }
    } else if (c === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2);
      const stop = end === -1 ? text.length : end + 2;
      out += ' '.repeat(stop - i);
      i = stop;
    } else if (c === "'" || c === '"' || c === '`') {
      out += c;
      i++;
      while (i < text.length && text[i] !== c) {
        if (text[i] === '\\' && c !== '`') {
          out += '__';
          i += 2;
          continue;
        }
        out += '_';
        i++;
      }
      if (i < text.length) {
        out += c;
        i++;
      }
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

const FORBIDDEN =
  /\b(CREATE|MERGE|SET|DELETE|DETACH|REMOVE|DROP|FOREACH|LOAD|CALL|UNION|ALTER|GRANT|DENY|REVOKE|TERMINATE|USING)\b/i;

function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of text) {
    if ('([{'.includes(ch)) depth++;
    if (')]}'.includes(ch)) depth--;
    if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else current += ch;
  }
  parts.push(current);
  return parts.map((s) => s.trim()).filter(Boolean);
}

/**
 * Validates a raw user query and wraps it (A4.2):
 *  - read-only: write/admin clauses and procedure calls are rejected (the engine also uses a read transaction)
 *  - must scope to the graph with `$g`
 *  - exactly one RETURN with exactly one column: a plain variable bound to a path or a single node
 *  - hop limit, node uniqueness and LIMIT are enforced by the wrapper / the engine
 */
export function prepareRaw(raw: string, ctx: CompileContext): NativeQuery {
  const text = raw
    .trim()
    .replace(/;+\s*$/, '')
    .trim();
  if (!text) throw new QueryError('The raw query is empty');
  const masked = maskLiterals(text);

  if (masked.includes(';')) throw new QueryError('Only a single statement is allowed');
  // property accessors such as `n.set` are not clauses
  const scanned = masked.replace(/\.\s*[A-Za-z_]\w*/g, '.x');
  const forbidden = FORBIDDEN.exec(scanned);
  if (forbidden) {
    throw new QueryError(
      `Raw queries are read-only: "${forbidden[1].toUpperCase()}" is not allowed (use the set operations instead of UNION)`,
      'RAW_QUERY_NOT_ALLOWED',
    );
  }
  if (!/\$g\b/.test(masked)) {
    throw new QueryError(
      'Raw queries must scope to the current graph: use {graphId: $g} on node patterns',
      'RAW_QUERY_UNSCOPED',
    );
  }

  const returns = [...masked.matchAll(/\bRETURN\b/gi)];
  if (returns.length !== 1) {
    throw new QueryError(
      'Raw queries must contain exactly one RETURN returning a single path or node',
      'RAW_QUERY_SHAPE',
    );
  }
  const afterReturn = masked.slice(returns[0].index + 'RETURN'.length);
  const clauseEnd = afterReturn.search(/\b(ORDER\s+BY|SKIP|LIMIT)\b/i);
  let clause = (clauseEnd === -1 ? afterReturn : afterReturn.slice(0, clauseEnd)).trim();
  clause = clause.replace(/^DISTINCT\s+/i, '');
  const items = splitTopLevel(clause);
  const shape = /^([A-Za-z_]\w*)(?:\s+AS\s+([A-Za-z_]\w*))?$/i.exec(items[0] ?? '');
  if (items.length !== 1 || !shape) {
    throw new QueryError(
      'Raw queries must return a single path or node variable, e.g. "RETURN p" (one column, no expressions)',
      'RAW_QUERY_SHAPE',
    );
  }
  const column = shape[2] ?? shape[1];

  const wrapped = `CALL {\n${text}\n}\nRETURN ${column} AS r\nLIMIT ${ctx.limit + 1}`;
  return {
    language: LANGUAGE_ID,
    kind: 'raw',
    text: wrapped,
    params: { g: ctx.graphId, maxHops: ctx.maxHops },
  };
}
