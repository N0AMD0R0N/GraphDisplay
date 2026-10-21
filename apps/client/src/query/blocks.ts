import type { RuleGroupType } from 'react-querybuilder';
import type { GraphSchema } from '@gd/api-contract';
import type { QueryLeaf, SetOperator, SetTree } from '@gd/query-core';
// the pure builder module (the package index also pulls in React components and CSS)
import { emptyRqb, rqbToTree, treeToRqb } from '@gd/lang-cypher-ui/src/builder';

/** One query of the panel. The queries are combined top to bottom: ((A op B) op C). */
export interface Block {
  id: number;
  mode: 'builder' | 'raw';
  rqb: RuleGroupType;
  text: string;
  /** How this query is combined with the ones above it (unused for the first). */
  op: SetOperator;
}

let nextId = 1;

/** A query added to the panel is combined with the ones above by intersection unless the user picks another operation. */
export const DEFAULT_COMBINE: SetOperator = 'intersect';

export const newBlock = (defaultText: string, op: SetOperator = DEFAULT_COMBINE): Block => ({
  id: nextId++,
  mode: 'builder',
  rqb: emptyRqb(),
  text: defaultText,
  op,
});

export interface CompiledBlocks {
  query: SetTree;
  /** Problems that keep the query from running (an empty value, an empty Cypher text...). */
  errors: string[];
}

/**
 * The set tree of the blocks. With `forUrl`, unfinished parts are left out instead of reported, so the address bar
 * can follow the editor while a rule is still being typed.
 */
export function blocksToTree(
  blocks: readonly Block[],
  schema: GraphSchema | undefined,
  forUrl = false,
): CompiledBlocks | null {
  const errors: string[] = [];
  const leaves: { leaf: QueryLeaf; op: SetOperator }[] = [];
  blocks.forEach((b, i) => {
    const name = String.fromCharCode(65 + i);
    if (b.mode === 'raw') {
      if (!b.text.trim()) {
        if (!forUrl) errors.push(`Query ${name}: the Cypher text is empty`);
        return;
      }
      leaves.push({ leaf: { op: 'leaf', text: b.text }, op: b.op });
      return;
    }
    const { tree, errors: e } = rqbToTree(b.rqb, schema);
    if (!forUrl) errors.push(...e.map((m) => (blocks.length > 1 ? `Query ${name}: ${m}` : m)));
    leaves.push({ leaf: { op: 'leaf', builder: tree }, op: b.op });
  });
  if (leaves.length === 0)
    return forUrl ? null : { query: { op: 'leaf', builder: { type: 'group', combinator: 'and', rules: [] } }, errors };
  const query = leaves.slice(1).reduce<SetTree>((acc, { leaf, op }) => ({ op, args: [acc, leaf] }), leaves[0].leaf);
  return { query, errors };
}

/**
 * The blocks for a set tree (a query from the URL). Only left-deep chains of leaves can be shown in the panel;
 * anything more nested (possible through the API) gives `null`.
 */
export function treeToBlocks(tree: SetTree, defaultText: string): Block[] | null {
  const leafBlock = (leaf: QueryLeaf, op: SetOperator): Block => {
    const block = newBlock(defaultText, op);
    if (leaf.builder) block.rqb = treeToRqb(leaf.builder);
    else {
      block.mode = 'raw';
      block.text = leaf.text ?? defaultText;
    }
    return block;
  };
  const walk = (t: SetTree): Block[] | null => {
    if (t.op === 'leaf') return [leafBlock(t, DEFAULT_COMBINE)];
    const [first, ...rest] = t.args;
    const blocks = walk(first);
    if (!blocks) return null;
    for (const arg of rest) {
      if (arg.op !== 'leaf') return null;
      blocks.push(leafBlock(arg, t.op));
    }
    return blocks;
  };
  return walk(tree);
}
