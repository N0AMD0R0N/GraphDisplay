// The editor package declares its types in a way TypeScript cannot resolve through its "exports" map,
// so the part of the API used here is declared locally. (No top-level imports: this is an ambient file.)
declare module '@neo4j-cypher/react-codemirror' {
  export interface CypherEditorProps {
    value?: string;
    theme?: 'light' | 'dark';
    lint?: boolean;
    lineWrapping?: boolean;
    autocomplete?: boolean;
    placeholder?: string;
    readOnly?: boolean;
    schema?: {
      labels?: string[];
      relationshipTypes?: string[];
      propertyKeys?: string[];
      parameters?: string[];
    };
    style?: import('react').CSSProperties;
    className?: string;
    onValueChanged?: (value: string, change?: unknown) => void;
  }
  export const CypherEditor: import('react').ComponentClass<CypherEditorProps>;
}
