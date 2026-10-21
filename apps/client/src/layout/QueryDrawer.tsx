import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import styled from 'styled-components';
import type { RuleGroupType } from 'react-querybuilder';
import type { QueryRequest, RouteMode, SetOperator, SetTree } from '@gd/query-core';
import {
  QueryBuilderField,
  appendRules,
  basePresets,
  cwePreset,
  emptyRqb,
  languagesUI,
  observedCwes,
  rqbToTree,
  severityNames,
  severityPreset,
  treeToRqb,
} from '@gd/lang-cypher-ui';
import { ApiRequestError, api, useSchema } from '../api';
import { useUI } from '../store';

const LANG = languagesUI.cypher;

const Aside = styled.aside<{ $open: boolean }>`
  width: ${(p) => (p.$open ? '450px' : '0')};
  flex: none;
  overflow: hidden;
  transition: width 0.18s ease;
  background: ${(p) => p.theme.colors.surface};
  border-right: ${(p) => (p.$open ? `1px solid ${p.theme.colors.border}` : '0')};
  z-index: 10;
`;
const Inner = styled.div`
  width: 450px;
  height: 100%;
  display: flex;
  flex-direction: column;
`;
const Head = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid ${(p) => p.theme.colors.border};
  h2 {
    margin: 0;
    font-size: 15px;
  }
`;
const Scroll = styled.div`
  flex: 1;
  overflow: auto;
  padding: 12px 14px;
`;
const Foot = styled.div`
  padding: 10px 14px;
  border-top: 1px solid ${(p) => p.theme.colors.border};
  background: ${(p) => p.theme.colors.surface2};
`;
const Btn = styled.button<{ $primary?: boolean }>`
  padding: 6px 12px;
  border-radius: 6px;
  cursor: pointer;
  border: 1px solid ${(p) => (p.$primary ? p.theme.colors.accent : p.theme.colors.border)};
  background: ${(p) => (p.$primary ? p.theme.colors.accent : p.theme.colors.surface)};
  color: ${(p) => (p.$primary ? '#fff' : p.theme.colors.text)};
  font-weight: ${(p) => (p.$primary ? 600 : 400)};
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;
const BlockCard = styled.section`
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
const OpRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 12px;
  font-size: 12px;
  color: ${(p) => p.theme.colors.muted};
  select {
    padding: 4px 6px;
    border-radius: 5px;
    border: 1px solid ${(p) => p.theme.colors.border};
  }
  &::before,
  &::after {
    content: '';
    flex: 1;
    border-top: 1px dashed ${(p) => p.theme.colors.border};
  }
`;
const Msg = styled.div<{ $error?: boolean }>`
  margin-top: 8px;
  padding: 6px 9px;
  border-radius: 6px;
  font-size: 12px;
  background: ${(p) => (p.$error ? p.theme.colors.dangerSoft : p.theme.colors.surface)};
  color: ${(p) => (p.$error ? p.theme.colors.danger : p.theme.colors.muted)};
  border: 1px solid ${(p) => (p.$error ? p.theme.colors.danger : p.theme.colors.border)};
`;
const Opts = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px 12px;
  align-items: center;
  margin-bottom: 8px;
  font-size: 12px;
  label {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  input,
  select {
    padding: 3px 5px;
    border: 1px solid ${(p) => p.theme.colors.border};
    border-radius: 4px;
    background: #fff;
  }
  input[type='number'] {
    width: 74px;
  }
`;

interface Block {
  id: number;
  mode: 'builder' | 'raw';
  rqb: RuleGroupType;
  text: string;
  op: SetOperator;
}

let nextBlock = 1;
const newBlock = (op: SetOperator = 'union'): Block => ({
  id: nextBlock++,
  mode: 'builder',
  rqb: emptyRqb(),
  text: LANG.defaultText,
  op,
});

const opLabel = (op: SetOperator, name: string): string =>
  ({
    union: `Union: routes above OR in query ${name}`,
    intersect: `Intersection: routes above AND in query ${name}`,
    except: `Difference: routes above MINUS those of query ${name}`,
  })[op];
const OPERATORS: SetOperator[] = ['union', 'intersect', 'except'];
const letter = (i: number) => String.fromCharCode(65 + i);

export function QueryDrawer() {
  const { graphId, drawerOpen, toggleDrawer, setResult, result } = useUI();
  const schema = useSchema(graphId).data;
  const [blocks, setBlocks] = useState<Block[]>(() => [newBlock()]);
  const [routeMode, setRouteMode] = useState<RouteMode>('all');
  const [maxHops, setMaxHops] = useState('');
  const [limit, setLimit] = useState('');

  const update = (id: number, patch: Partial<Block>) =>
    setBlocks((bs) => bs.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  const presets = useMemo(() => basePresets(schema), [schema]);

  const compiled = useMemo(() => {
    const errors: string[] = [];
    const leaves: SetTree[] = blocks.map((b, i) => {
      if (b.mode === 'raw') {
        if (!b.text.trim()) errors.push(`Query ${letter(i)}: the Cypher text is empty`);
        return { op: 'leaf', text: b.text };
      }
      const { tree, errors: e } = rqbToTree(b.rqb, schema);
      errors.push(...e.map((m) => (blocks.length > 1 ? `Query ${letter(i)}: ${m}` : m)));
      return { op: 'leaf', builder: tree };
    });
    const query = leaves
      .slice(1)
      .reduce<SetTree>((acc, leaf, i) => ({ op: blocks[i + 1].op, args: [acc, leaf] }), leaves[0]);
    return { query, errors };
  }, [blocks, schema]);

  const run = useMutation({
    mutationFn: () => {
      const body: QueryRequest = { query: compiled.query, routeMode };
      if (maxHops) body.maxHops = Number(maxHops);
      if (limit) body.limit = Number(limit);
      return api.query(graphId!, body);
    },
    onSuccess: (data) => setResult(data),
  });

  const applyPreset = (blockId: number, value: string) => {
    if (!value) return;
    const [kind, arg] = [value.slice(0, 1), value.slice(2)];
    const tree =
      kind === 'p'
        ? presets.find((p) => p.id === arg)!.tree
        : kind === 's'
          ? severityPreset(schema, arg)
          : cwePreset(arg);
    setBlocks((bs) => bs.map((b) => (b.id === blockId ? { ...b, rqb: appendRules(b.rqb, treeToRqb(tree)) } : b)));
  };

  const openAsCypher = (b: Block) => {
    const { tree } = rqbToTree(b.rqb, schema);
    const text = LANG.formatBuilderTree(tree, {
      graphId: graphId ?? 'GRAPH',
      maxHops: Number(maxHops) || 50,
      limit: Number(limit) || 1000,
      routeMode,
      schema,
    });
    update(b.id, { mode: 'raw', text });
  };

  const runError = run.error instanceof ApiRequestError ? run.error.message : run.error ? 'The query failed' : null;
  const canRun = !!graphId && compiled.errors.length === 0 && !run.isPending;

  return (
    <Aside $open={drawerOpen} aria-hidden={!drawerOpen}>
      <Inner>
        <Head>
          <h2>Query</h2>
          <Btn
            type="button"
            onClick={toggleDrawer}
            title="Collapse the panel for a bigger graph"
            aria-label="Collapse query panel"
          >
            « Collapse
          </Btn>
        </Head>
        <Scroll>
          {blocks.map((b, i) => (
            <div key={b.id}>
              {i > 0 && (
                <OpRow>
                  <select
                    value={b.op}
                    onChange={(e) => update(b.id, { op: e.target.value as SetOperator })}
                    aria-label={`Operation before query ${letter(i)}`}
                  >
                    {OPERATORS.map((op) => (
                      <option key={op} value={op}>
                        {opLabel(op, letter(i))}
                      </option>
                    ))}
                  </select>
                </OpRow>
              )}
              <BlockCard>
                <div className="bar">
                  <b>Query {letter(i)}</b>
                  <Tab type="button" $on={b.mode === 'builder'} onClick={() => update(b.id, { mode: 'builder' })}>
                    Builder
                  </Tab>
                  <Tab type="button" $on={b.mode === 'raw'} onClick={() => update(b.id, { mode: 'raw' })}>
                    {LANG.label}
                  </Tab>
                  {blocks.length > 1 && (
                    <Btn
                      type="button"
                      onClick={() => setBlocks((bs) => bs.filter((x) => x.id !== b.id))}
                      aria-label={`Remove query ${letter(i)}`}
                    >
                      ✕
                    </Btn>
                  )}
                </div>
                <div className="body">
                  {b.mode === 'builder' ? (
                    <>
                      <Opts>
                        <select
                          value=""
                          onChange={(e) => applyPreset(b.id, e.target.value)}
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
                        <Btn type="button" onClick={() => update(b.id, { rqb: emptyRqb() })}>
                          Clear
                        </Btn>
                        <Btn
                          type="button"
                          onClick={() => openAsCypher(b)}
                          title="Opens the generated query in the Cypher editor (one way)"
                        >
                          Open as {LANG.label}
                        </Btn>
                      </Opts>
                      <QueryBuilderField schema={schema} query={b.rqb} onChange={(rqb) => update(b.id, { rqb })} />
                      {b.rqb.rules.length === 0 && <Msg>No conditions: every route is matched (up to the limit).</Msg>}
                    </>
                  ) : (
                    <>
                      <LANG.Editor value={b.text} onChange={(text) => update(b.id, { text })} schema={schema} />
                      <Msg>{LANG.hint}</Msg>
                    </>
                  )}
                </div>
              </BlockCard>
            </div>
          ))}
          <Btn type="button" onClick={() => setBlocks((bs) => [...bs, newBlock()])} disabled={blocks.length >= 6}>
            + Add a query to combine
          </Btn>
        </Scroll>

        <Foot>
          <Opts>
            <label>
              Routes
              <select value={routeMode} onChange={(e) => setRouteMode(e.target.value as RouteMode)}>
                <option value="all">all sub-paths</option>
                <option value="maximal">maximal (source to sink)</option>
              </select>
            </label>
            <label>
              max hops
              <input
                type="number"
                min={1}
                max={100}
                placeholder="50"
                value={maxHops}
                onChange={(e) => setMaxHops(e.target.value)}
              />
            </label>
            <label>
              limit
              <input
                type="number"
                min={1}
                max={10000}
                placeholder="1000"
                value={limit}
                onChange={(e) => setLimit(e.target.value)}
              />
            </label>
          </Opts>
          <Btn type="button" $primary disabled={!canRun} onClick={() => run.mutate()}>
            {run.isPending ? 'Running…' : 'Run query'}
          </Btn>
          {compiled.errors.length > 0 && <Msg $error>{compiled.errors.join(' · ')}</Msg>}
          {runError && <Msg $error>{runError}</Msg>}
          {result && !runError && (
            <Msg>
              {result.truncated
                ? `More than ${result.routes.length} routes match (showing the longest ${result.routes.length}).`
                : `${result.total} route${result.total === 1 ? '' : 's'} found.`}
              {result.warnings.filter((w) => w.code !== 'TRUNCATED').map((w) => ` ${w.message}.`)}
            </Msg>
          )}
        </Foot>
      </Inner>
    </Aside>
  );
}
