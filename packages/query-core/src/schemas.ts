import * as v from 'valibot';
import { DEFAULTS } from '@gd/api-contract';
import {
  OPERATORS,
  POSITIONS,
  QueryError,
  type Condition,
  type ConditionTree,
  type QueryRequest,
  type SetTree,
} from './model';

const scalar = v.union([v.string(), v.number(), v.boolean()]);
const ruleValue = v.union([scalar, v.array(scalar)]);

const nodeRule = v.strictObject({
  type: v.literal('rule'),
  position: v.picklist(POSITIONS),
  path: v.pipe(v.string(), v.minLength(1)),
  op: v.picklist(OPERATORS),
  value: v.optional(ruleValue),
});

const lengthRule = v.strictObject({
  type: v.literal('length'),
  min: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1))),
  max: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1))),
});

const conditionSchema: v.GenericSchema<Condition> = v.lazy(() => v.union([nodeRule, lengthRule, groupSchema]));
const groupSchema: v.GenericSchema<ConditionTree> = v.strictObject({
  type: v.literal('group'),
  combinator: v.picklist(['and', 'or']),
  rules: v.array(conditionSchema),
});

export const conditionTreeSchema = groupSchema;

const leafSchema = v.strictObject({
  op: v.literal('leaf'),
  language: v.optional(v.string()),
  builder: v.optional(groupSchema),
  text: v.optional(v.pipe(v.string(), v.minLength(1))),
});

export const setTreeSchema: v.GenericSchema<SetTree> = v.lazy(() =>
  v.union([
    leafSchema,
    v.strictObject({
      op: v.picklist(['union', 'intersect', 'except']),
      args: v.pipe(v.array(setTreeSchema), v.minLength(1)),
    }),
  ]),
);

export const queryRequestSchema = v.strictObject({
  query: setTreeSchema,
  limit: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(DEFAULTS.limitCeiling))),
  maxHops: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(DEFAULTS.maxHopsCeiling))),
  routeMode: v.optional(v.picklist(['all', 'maximal'])),
});

/** Counts builder rules (leaf conditions) in a set tree (A5.1). */
export function countConditions(tree: SetTree): number {
  if (tree.op === 'leaf') return tree.builder ? countInGroup(tree.builder) : 1;
  return tree.args.reduce((sum, a) => sum + countConditions(a), 0);
}

function countInGroup(c: Condition): number {
  return c.type === 'group' ? c.rules.reduce((s, r) => s + countInGroup(r), 0) : 1;
}

export function parseQueryRequest(input: unknown): QueryRequest {
  const result = v.safeParse(queryRequestSchema, input);
  if (!result.success) {
    const first = result.issues[0];
    const path = first.path?.map((p) => String(p.key)).join('.') ?? '';
    throw new QueryError(`Invalid query request${path ? ` at "${path}"` : ''}: ${first.message}`);
  }
  const req = result.output as QueryRequest;
  validateTree(req.query);
  if (countConditions(req.query) > DEFAULTS.maxQueryLeaves) {
    throw new QueryError(`Query has more than ${DEFAULTS.maxQueryLeaves} conditions`, 'QUERY_TOO_LARGE');
  }
  return req;
}

function validateTree(tree: SetTree): void {
  if (tree.op === 'leaf') {
    const hasBuilder = tree.builder !== undefined;
    const hasText = tree.text !== undefined;
    if (hasBuilder === hasText) {
      throw new QueryError('A query leaf needs exactly one of "builder" or "text"');
    }
    return;
  }
  if (tree.op === 'except' && tree.args.length < 2) {
    throw new QueryError('"except" needs at least two operands');
  }
  tree.args.forEach(validateTree);
}
