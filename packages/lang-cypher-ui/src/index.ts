import type { ComponentType } from 'react';
import type { GraphSchema } from '@gd/api-contract';
import { exportRawText } from '@gd/lang-cypher';
import type { CompileContext, ConditionTree } from '@gd/query-core';
import { CypherEditorField, type EditorProps } from './Editor';

export * from './builder';
export { CypherEditorField, type EditorProps } from './Editor';
export { QueryBuilderField, type QueryBuilderFieldProps } from './QueryBuilderField';

/**
 * The client side of the replaceable query-language boundary (WorkPlan §2.2): everything the UI needs from a
 * language. A different language ships its own implementation of this interface.
 */
export interface QueryLanguageUI {
  id: string;
  label: string;
  Editor: ComponentType<EditorProps>;
  /** Raw text a new block starts with. */
  defaultText: string;
  /** Hint shown under the editor. */
  hint: string;
  /** One-way export of a builder tree to the language's text (builder -> raw). */
  formatBuilderTree(tree: ConditionTree, ctx: CompileContext): string;
}

export const cypherLanguageUI: QueryLanguageUI = {
  id: 'cypher',
  label: 'Cypher',
  Editor: CypherEditorField,
  defaultText:
    'MATCH p = (a:Node {graphId: $g})-[:CALLS*0..5]->(b:Node {graphId: $g})\nWHERE a.publicExposed = true\nRETURN p',
  hint: 'Read-only. Scope node patterns with {graphId: $g} and return one path or node variable (RETURN p).',
  formatBuilderTree: exportRawText,
};

export const languagesUI: Record<string, QueryLanguageUI> = { cypher: cypherLanguageUI };

export type { GraphSchema };
