import styled from 'styled-components';
import type { GraphSchema } from '@gd/api-contract';
import { QueryBuilderField, emptyRqb, languagesUI, observedCwes, severityNames, type Preset } from '@gd/lang-cypher-ui';
import type { Block } from '../types';
import { Button } from './Button';
import { Message } from './Message';
import { OptionsRow } from './OptionsRow';

const LANG = languagesUI.cypher;

const Card = styled.section`
  margin-bottom: 12px;
  border: 1px solid ${(p) => p.theme.colors.border};
  border-radius: ${(p) => p.theme.radius};
  background: ${(p) => p.theme.colors.surface};
  .bar {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 8px;
    background: ${(p) => p.theme.colors.surface2};
    border-bottom: 1px solid ${(p) => p.theme.colors.border};
    border-radius: ${(p) => p.theme.radius} ${(p) => p.theme.radius} 0 0;
  }
  .bar b {
    flex: 1;
  }
  .body {
    padding: 8px;
  }
`;
const Tab = styled.button<{ $on: boolean }>`
  padding: 3px 10px;
  border: 1px solid ${(p) => (p.$on ? p.theme.colors.accent : p.theme.colors.border)};
  background: ${(p) => (p.$on ? p.theme.colors.accentSoft : p.theme.colors.surface)};
  border-radius: 5px;
  cursor: pointer;
  font-size: 12px;
`;

export interface QueryBlockCardProps {
  block: Block;
  /** Position of the block in the panel: A, B, C... */
  name: string;
  removable: boolean;
  schema: GraphSchema | undefined;
  presets: Preset[];
  onChange(patch: Partial<Block>): void;
  onApplyPreset(value: string): void;
  onOpenAsCypher(): void;
  onRemove(): void;
}

/** One query of the panel: the builder or the raw editor, with the presets. */
export function QueryBlockCard({
  block: b,
  name,
  removable,
  schema,
  presets,
  onChange,
  onApplyPreset,
  onOpenAsCypher,
  onRemove,
}: QueryBlockCardProps) {
  return (
    <Card>
      <div className="bar">
        <b>Query {name}</b>
        <Tab type="button" $on={b.mode === 'builder'} onClick={() => onChange({ mode: 'builder' })}>
          Builder
        </Tab>
        <Tab type="button" $on={b.mode === 'raw'} onClick={() => onChange({ mode: 'raw' })}>
          {LANG.label}
        </Tab>
        {removable && (
          <Button type="button" onClick={onRemove} aria-label={`Remove query ${name}`}>
            ✕
          </Button>
        )}
      </div>
      <div className="body">
        {b.mode === 'builder' ? (
          <>
            <OptionsRow>
              <select
                value=""
                onChange={(e) => onApplyPreset(e.target.value)}
                aria-label="Add a preset"
                disabled={!schema}
              >
                <option value="">Add a preset…</option>
                <optgroup label="Presets">
                  {presets.map((p) => (
                    <option key={p.id} value={`p:${p.id}`} title={p.description}>
                      {p.label}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Vulnerability severity at least">
                  {severityNames(schema).map((s) => (
                    <option key={s} value={`s:${s}`}>
                      {s}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Vulnerability CWE">
                  {observedCwes(schema).map((c) => (
                    <option key={c} value={`c:${c}`}>
                      {c.toUpperCase()}
                    </option>
                  ))}
                </optgroup>
              </select>
              <Button type="button" onClick={() => onChange({ rqb: emptyRqb() })}>
                Clear
              </Button>
              <Button
                type="button"
                onClick={() => onOpenAsCypher()}
                title="Opens the generated query in the Cypher editor (one way)"
              >
                Open as {LANG.label}
              </Button>
            </OptionsRow>
            <QueryBuilderField schema={schema} query={b.rqb} onChange={(rqb) => onChange({ rqb })} />
            {b.rqb.rules.length === 0 && <Message>No conditions: every route is matched (up to the limit).</Message>}
          </>
        ) : (
          <>
            <LANG.Editor value={b.text} onChange={(text) => onChange({ text })} schema={schema} />
            <Message>{LANG.hint}</Message>
          </>
        )}
      </div>
    </Card>
  );
}
