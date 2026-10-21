import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import styled from 'styled-components';
import type { QueryRequest, RouteMode } from '@gd/query-core';
import {
  appendRules,
  basePresets,
  cwePreset,
  languagesUI,
  rqbToTree,
  severityPreset,
  treeToRqb,
} from '@gd/lang-cypher-ui';
import { ApiRequestError, api, useSchema } from '../api';
import { useUI } from '../store';
import { blocksToTree, newBlock, treeToBlocks } from '../lib/blocks';
import { readUrl, writeUrl } from '../lib/urlSync';
import type { Block } from '../types';
import { Button } from './Button';
import { Message } from './Message';
import { OptionsRow } from './OptionsRow';
import { QueryBlockCard } from './QueryBlockCard';
import { SetOperatorRow } from './SetOperatorRow';

const LANG = languagesUI.cypher;
const letter = (i: number) => String.fromCharCode(65 + i);

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
export function QueryDrawer() {
  const { graphId, drawerOpen, toggleDrawer, setResult, showFullGraph, result } = useUI();
  const schema = useSchema(graphId).data;
  // the editor starts from the query in the address bar (a bookmarked or shared URL), if there is one
  const [initial] = useState(readUrl);
  const [blocks, setBlocks] = useState<Block[]>(
    () => (initial.q ? treeToBlocks(initial.q, LANG.defaultText) : null) ?? [newBlock(LANG.defaultText)],
  );
  const [routeMode, setRouteMode] = useState<RouteMode>(initial.mode ?? 'all');
  const [maxHops, setMaxHops] = useState(initial.hops ? String(initial.hops) : '');
  const [limit, setLimit] = useState(initial.limit ? String(initial.limit) : '');
  const [includeSub, setIncludeSub] = useState(initial.sub === true);

  const update = (id: number, patch: Partial<Block>) =>
    setBlocks((bs) => bs.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  const presets = useMemo(() => basePresets(schema), [schema]);

  const compiled = useMemo(() => blocksToTree(blocks, schema)!, [blocks, schema]);

  // The address bar follows the editor: the query is always visible in the URL (and can be bookmarked or shared)
  useEffect(() => {
    if (!schema) return; // values are typed by the schema: wait for it, so a restored query is not rewritten
    writeUrl({
      q: blocksToTree(blocks, schema, true)?.query,
      mode: routeMode === 'maximal' ? 'maximal' : undefined,
      hops: Number(maxHops) || undefined,
      limit: Number(limit) || undefined,
      sub: includeSub || undefined,
    });
  }, [blocks, schema, routeMode, maxHops, limit, includeSub]);

  const run = useMutation({
    mutationFn: () => {
      const body: QueryRequest = { query: compiled.query, routeMode };
      if (maxHops) body.maxHops = Number(maxHops);
      if (limit) body.limit = Number(limit);
      if (includeSub) body.includeSubRoutes = true;
      return api.query(graphId!, body);
    },
    onSuccess: (data) => setResult(data),
  });

  // a URL that was opened with a result on screen runs its query again
  const autoRun = useRef(initial.run === true && initial.q !== undefined);
  useEffect(() => {
    if (!autoRun.current || !graphId || !schema) return;
    autoRun.current = false;
    run.mutate(undefined, {
      onSuccess: (data) => {
        const ui = useUI.getState();
        if (initial.route !== undefined && initial.route < data.routes.length) ui.selectRoute(initial.route);
        if (initial.view === 'graph') ui.setViewMode('graph');
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphId, schema]);

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
          <span style={{ display: 'flex', gap: 6 }}>
            <Button
              type="button"
              onClick={showFullGraph}
              disabled={!result}
              title="Back to the whole graph (the query stays in the editor)"
              aria-label="Show the full graph"
            >
              Full graph
            </Button>
            <Button
              type="button"
              onClick={toggleDrawer}
              title="Collapse the panel for a bigger graph"
              aria-label="Collapse query panel"
            >
              « Collapse
            </Button>
          </span>
        </Head>
        <Scroll>
          {blocks.map((b, i) => (
            <div key={b.id}>
              {i > 0 && <SetOperatorRow op={b.op} name={letter(i)} onChange={(op) => update(b.id, { op })} />}
              <QueryBlockCard
                block={b}
                name={letter(i)}
                removable={blocks.length > 1}
                schema={schema}
                presets={presets}
                onChange={(patch) => update(b.id, patch)}
                onApplyPreset={(value) => applyPreset(b.id, value)}
                onOpenAsCypher={() => openAsCypher(b)}
                onRemove={() => setBlocks((bs) => bs.filter((x) => x.id !== b.id))}
              />
            </div>
          ))}
          <Button
            type="button"
            onClick={() => setBlocks((bs) => [...bs, newBlock(LANG.defaultText)])}
            disabled={blocks.length >= 6}
          >
            + Add a query to combine
          </Button>
        </Scroll>

        <Foot>
          <OptionsRow>
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
            <label title="Routes that lie inside another route of the result (the same nodes in the same order) are left out unless this is checked">
              <input type="checkbox" checked={includeSub} onChange={(e) => setIncludeSub(e.target.checked)} />
              include sub-routes
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
          </OptionsRow>
          <Button type="button" $primary disabled={!canRun} onClick={() => run.mutate()}>
            {run.isPending ? 'Running…' : 'Run query'}
          </Button>
          {compiled.errors.length > 0 && <Message $error>{compiled.errors.join(' · ')}</Message>}
          {runError && <Message $error>{runError}</Message>}
          {result && !runError && (
            <Message>
              {result.truncated
                ? `More than ${result.routes.length} routes match (showing the longest ${result.routes.length}).`
                : `${result.total} route${result.total === 1 ? '' : 's'} found.`}
              {result.warnings.filter((w) => w.code !== 'TRUNCATED').map((w) => ` ${w.message}.`)}
            </Message>
          )}
        </Foot>
      </Inner>
    </Aside>
  );
}
