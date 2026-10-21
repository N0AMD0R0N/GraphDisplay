import { Component, type ReactNode } from 'react';
import { CypherEditor } from '@neo4j-cypher/react-codemirror';
import type { GraphSchema } from '@gd/api-contract';

export interface EditorProps {
  value: string;
  onChange(value: string): void;
  schema?: GraphSchema;
  height?: number | string;
}

const frame = { border: '1px solid #cdd3dd', borderRadius: 6, overflow: 'auto', background: '#fff' } as const;

/** If the editor component fails, the query can still be edited as plain text. */
class EditorBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error) {
    console.error('Cypher editor failed, using a plain text box instead:', error);
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/** Raw Cypher editor (WorkPlan B4): highlighting, autocompletion and linting from Neo4j's language support. */
export function CypherEditorField({ value, onChange, schema, height = 220 }: EditorProps) {
  return (
    <EditorBoundary
      fallback={
        <textarea
          aria-label="Cypher query"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
          style={{
            ...frame,
            width: '100%',
            height,
            padding: 8,
            fontFamily: 'ui-monospace, Consolas, monospace',
            fontSize: 13,
          }}
        />
      }
    >
      <CypherEditor
        value={value}
        onValueChanged={(next: string) => onChange(next)}
        theme="light"
        lint
        lineWrapping
        autocomplete
        schema={{
          labels: ['Node'],
          relationshipTypes: ['CALLS'],
          propertyKeys: ['graphId', 'id', ...(schema?.properties.map((p) => p.path) ?? [])],
          parameters: ['g', 'maxHops'],
        }}
        style={{ ...frame, height }}
      />
    </EditorBoundary>
  );
}
