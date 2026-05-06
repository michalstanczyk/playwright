/**
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import * as React from 'react';
import type { Boundaries } from './geometry';
import './graphqlTab.css';
import './networkFilters.css';
import { GraphqlResourceDetails } from './graphqlResourceDetails';
import { msToString } from '@isomorphic/formatUtils';
import { PlaceholderPanel } from './placeholderPanel';
import type { ResourceEntry } from '@isomorphic/trace/traceModel';
import type { TraceModel } from '@isomorphic/trace/traceModel';
import { GridView, type RenderedGridCell } from '@web/components/gridView';
import { SplitView } from '@web/components/splitView';
import type { Language } from '@isomorphic/locatorGenerators';

export type GraphqlOperationKind = 'query' | 'mutation' | 'subscription';

export type ParsedGraphqlBody = {
  operationName: string;
  kind: GraphqlOperationKind;
  query: string;
  variables: unknown;
  batchCount: number;
  persistedHash?: string;
};

type ParseState =
  | { state: 'loading' }
  | { state: 'failed' }
  | { state: 'parsed', parsed: ParsedGraphqlBody };

type GraphqlTabModel = {
  candidates: ResourceEntry[],
  parseResults: Map<string, ParseState>,
};

type RenderedEntry = {
  operation: string,
  kind: GraphqlOperationKind | 'loading',
  status: { code: number, text: string },
  duration: number,
  start: number,
  resource: ResourceEntry,
  parsed?: ParsedGraphqlBody,
  loading: boolean,
};
type ColumnName = Exclude<keyof RenderedEntry, 'parsed' | 'loading' | 'resource'>;
type Sorting = { by: ColumnName, negate: boolean };
const GraphqlGridView = GridView<RenderedEntry>;

export function useGraphqlTabModel(model: TraceModel | undefined, selectedTime: Boundaries | undefined): GraphqlTabModel {
  const candidates = React.useMemo(() => {
    const all = model?.resources || [];
    return all.filter(resource => {
      if (resource.request.method !== 'POST')
        return false;
      if (!isGraphqlUrl(resource.request.url))
        return false;
      const pd = resource.request.postData;
      if (!pd)
        return false;
      if (!pd.text && !pd._sha1)
        return false;
      if (!selectedTime)
        return true;
      return !!resource._monotonicTime
        && resource._monotonicTime >= selectedTime.minimum
        && resource._monotonicTime <= selectedTime.maximum;
    });
  }, [model, selectedTime]);

  const [parseResults, setParseResults] = React.useState<Map<string, ParseState>>(new Map());

  React.useEffect(() => {
    let cancelled = false;
    const next = new Map<string, ParseState>();

    for (const resource of candidates) {
      const pd = resource.request.postData!;
      if (pd.text) {
        const parsed = parseGraphqlBody(pd.text);
        next.set(resource.id, parsed ? { state: 'parsed', parsed } : { state: 'failed' });
        continue;
      }
      if (pd._sha1 && model) {
        next.set(resource.id, { state: 'loading' });
        const sha1 = pd._sha1;
        const id = resource.id;
        (async () => {
          try {
            const response = await fetch(model.createRelativeUrl(`sha1/${sha1}`));
            const text = await response.text();
            if (cancelled)
              return;
            const parsed = parseGraphqlBody(text);
            setParseResults(prev => {
              const m = new Map(prev);
              m.set(id, parsed ? { state: 'parsed', parsed } : { state: 'failed' });
              return m;
            });
          } catch {
            if (cancelled)
              return;
            setParseResults(prev => {
              const m = new Map(prev);
              m.set(id, { state: 'failed' });
              return m;
            });
          }
        })();
      } else {
        next.set(resource.id, { state: 'failed' });
      }
    }
    setParseResults(next);
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidates, model]);

  return { candidates, parseResults };
}

type GraphqlFilterState = {
  searchValue: string;
  kinds: Set<GraphqlOperationKind>;
};

const defaultGraphqlFilterState: GraphqlFilterState = { searchValue: '', kinds: new Set() };

export const GraphqlTab: React.FunctionComponent<{
  boundaries: Boundaries,
  graphqlModel: GraphqlTabModel,
  sdkLanguage: Language,
}> = ({ boundaries, graphqlModel, sdkLanguage }) => {
  const [sorting, setSorting] = React.useState<Sorting | undefined>(undefined);
  const [selectedResourceKey, setSelectedResourceKey] = React.useState<string | undefined>(undefined);
  const [filterState, setFilterState] = React.useState<GraphqlFilterState>(defaultGraphqlFilterState);

  const onFilterStateChange = React.useCallback((next: GraphqlFilterState) => {
    setFilterState(next);
    setSelectedResourceKey(undefined);
  }, []);

  const renderedEntries = React.useMemo(() => {
    const entries: RenderedEntry[] = [];
    const search = filterState.searchValue.trim().toLowerCase();
    for (const resource of graphqlModel.candidates) {
      const result = graphqlModel.parseResults.get(resource.id);
      if (!result || result.state === 'failed')
        continue;
      const entry = renderEntry(resource, result, boundaries);
      if (!entryMatchesFilter(entry, search, filterState.kinds))
        continue;
      entries.push(entry);
    }
    if (sorting)
      sort(entries, sorting);
    return entries;
  }, [graphqlModel.candidates, graphqlModel.parseResults, sorting, boundaries, filterState]);

  const visibleSelectedEntry = React.useMemo(
      () => (selectedResourceKey ? renderedEntries.find(entry => entry.resource.id === selectedResourceKey) : undefined),
      [selectedResourceKey, renderedEntries]);

  const [columnWidths, setColumnWidths] = React.useState<Map<ColumnName, number>>(() => {
    return new Map(allColumns().map(column => [column, columnWidth(column)]));
  });

  if (!graphqlModel.candidates.length)
    return <PlaceholderPanel text='No GraphQL operations' />;

  const filters = <GraphqlFilters filterState={filterState} onFilterStateChange={onFilterStateChange} />;

  const grid = <GraphqlGridView
    name='graphql'
    ariaLabel='GraphQL operations'
    items={renderedEntries}
    selectedItem={visibleSelectedEntry}
    onSelected={item => {
      if (!item.loading)
        setSelectedResourceKey(item.resource.id);
    }}
    columns={visibleColumns(!!visibleSelectedEntry)}
    columnTitle={columnTitle}
    columnWidths={columnWidths}
    setColumnWidths={setColumnWidths}
    isError={item => item.status.code >= 400 || item.status.code === -1}
    render={(item, column) => renderCell(item, column)}
    sorting={sorting}
    setSorting={setSorting}
  />;

  return <>
    {filters}
    {!visibleSelectedEntry && grid}
    {visibleSelectedEntry && visibleSelectedEntry.parsed &&
      <SplitView
        sidebarSize={columnWidths.get('operation')!}
        sidebarIsFirst={true}
        orientation='horizontal'
        settingName='graphqlResourceDetails'
        main={<GraphqlResourceDetails
          resource={visibleSelectedEntry.resource}
          parsed={visibleSelectedEntry.parsed}
          sdkLanguage={sdkLanguage}
          startTimeOffset={visibleSelectedEntry.start}
          onClose={() => setSelectedResourceKey(undefined)}
        />}
        sidebar={grid}
      />}
  </>;
};

const GRAPHQL_KINDS: GraphqlOperationKind[] = ['query', 'mutation', 'subscription'];

const GraphqlFilters: React.FunctionComponent<{
  filterState: GraphqlFilterState,
  onFilterStateChange: (next: GraphqlFilterState) => void,
}> = ({ filterState, onFilterStateChange }) => {
  return (
    <div className='network-filters'>
      <input
        type='search'
        placeholder='Filter operations'
        spellCheck={false}
        value={filterState.searchValue}
        onChange={e => onFilterStateChange({ ...filterState, searchValue: e.target.value })}
      />
      <div className='network-filters-resource-types' role='tablist' aria-multiselectable='true'>
        <div
          title='All'
          onClick={() => onFilterStateChange({ ...filterState, kinds: new Set() })}
          className={`network-filters-resource-type ${filterState.kinds.size === 0 ? 'selected' : ''}`}
        >
          All
        </div>
        {GRAPHQL_KINDS.map(kind => (
          <div
            key={kind}
            title={kindLabel(kind)}
            role='tab'
            aria-selected={filterState.kinds.has(kind)}
            onClick={event => {
              const next = (event.ctrlKey || event.metaKey)
                ? toggleSet(filterState.kinds, kind)
                : new Set<GraphqlOperationKind>([kind]);
              onFilterStateChange({ ...filterState, kinds: next });
            }}
            className={`network-filters-resource-type ${filterState.kinds.has(kind) ? 'selected' : ''}`}
          >
            {kindLabel(kind)}
          </div>
        ))}
      </div>
    </div>
  );
};

function toggleSet<T>(set: Set<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value))
    next.delete(value);
  else
    next.add(value);
  return next;
}

function entryMatchesFilter(entry: RenderedEntry, search: string, kinds: Set<GraphqlOperationKind>): boolean {
  if (kinds.size > 0) {
    if (entry.kind === 'loading')
      return false;
    if (!kinds.has(entry.kind))
      return false;
  }
  if (!search)
    return true;
  if (entry.operation.toLowerCase().includes(search))
    return true;
  if (entry.resource.request.url.toLowerCase().includes(search))
    return true;
  return false;
}

const columnTitle = (column: ColumnName): string => {
  switch (column) {
    case 'operation': return 'Operation';
    case 'kind': return 'Type';
    case 'status': return 'Status';
    case 'duration': return 'Duration';
    case 'start': return 'Start';
    default: return '';
  }
};

const columnWidth = (column: ColumnName): number => {
  switch (column) {
    case 'operation': return 280;
    case 'kind': return 80;
    case 'status': return 70;
    default: return 100;
  }
};

function allColumns(): ColumnName[] {
  return ['operation', 'kind', 'status', 'duration', 'start'];
}

function visibleColumns(entrySelected: boolean): ColumnName[] {
  if (entrySelected)
    return ['operation'];
  return allColumns();
}

const renderCell = (entry: RenderedEntry, column: ColumnName): RenderedGridCell => {
  if (column === 'operation') {
    const suffix = entry.parsed && entry.parsed.batchCount > 1 ? ` (+${entry.parsed.batchCount - 1})` : '';
    return {
      body: <span className={`graphql-operation-cell kind-${entry.kind}`}>
        {entry.kind !== 'loading' && <span className={`graphql-kind-badge kind-${entry.kind}`}>{kindShort(entry.kind)}</span>}
        <span className='graphql-op-name'>{entry.operation + suffix}</span>
      </span>,
      title: entry.resource.request.url,
    };
  }
  if (column === 'kind') {
    if (entry.kind === 'loading')
      return { body: '' };
    return { body: kindLabel(entry.kind), title: entry.kind };
  }
  if (column === 'status') {
    return {
      body: entry.status.code === -1 ? 'canceled' : entry.status.code > 0 ? entry.status.code : '',
      title: entry.status.code === -1 ? 'canceled' : entry.status.text,
    };
  }
  if (column === 'duration')
    return { body: msToString(entry.duration) };
  if (column === 'start')
    return { body: msToString(entry.start) };
  return { body: '' };
};

function kindLabel(kind: GraphqlOperationKind): string {
  if (kind === 'query') return 'Query';
  if (kind === 'mutation') return 'Mutation';
  return 'Subscription';
}

function kindShort(kind: GraphqlOperationKind): string {
  if (kind === 'query') return 'Q';
  if (kind === 'mutation') return 'M';
  return 'S';
}

const renderEntry = (resource: ResourceEntry, result: ParseState, boundaries: Boundaries): RenderedEntry => {
  const base = {
    status: { code: resource.response.status, text: resource.response.statusText },
    duration: resource.time,
    start: (resource._monotonicTime ?? boundaries.minimum) - boundaries.minimum,
    resource,
  };
  if (result.state === 'parsed') {
    return {
      ...base,
      operation: result.parsed.operationName,
      kind: result.parsed.kind,
      parsed: result.parsed,
      loading: false,
    };
  }
  return {
    ...base,
    operation: '(loading…)',
    kind: 'loading' as const,
    loading: true,
  };
};

function sort(entries: RenderedEntry[], sorting: Sorting) {
  const c = comparator(sorting.by);
  if (c)
    entries.sort(c);
  if (sorting.negate)
    entries.reverse();
}

function comparator(sortBy: ColumnName) {
  if (sortBy === 'start')
    return (a: RenderedEntry, b: RenderedEntry) => a.start - b.start;
  if (sortBy === 'duration')
    return (a: RenderedEntry, b: RenderedEntry) => a.duration - b.duration;
  if (sortBy === 'status')
    return (a: RenderedEntry, b: RenderedEntry) => a.status.code - b.status.code;
  if (sortBy === 'operation')
    return (a: RenderedEntry, b: RenderedEntry) => a.operation.localeCompare(b.operation);
  if (sortBy === 'kind')
    return (a: RenderedEntry, b: RenderedEntry) => String(a.kind).localeCompare(String(b.kind));
}

function isGraphqlUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return /\/graphql\b/i.test(u.pathname);
  } catch {
    return /\/graphql\b/i.test(url);
  }
}

export function parseGraphqlBody(body: string): ParsedGraphqlBody | undefined {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return undefined;
  }
  const list = Array.isArray(json) ? json : [json];
  const ops: ParsedGraphqlBody[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object')
      continue;
    const obj = item as Record<string, unknown>;
    const query = typeof obj.query === 'string' ? obj.query : undefined;
    const operationName = typeof obj.operationName === 'string' ? obj.operationName : undefined;
    const persistedHash = readPersistedHash(obj);

    if (query) {
      ops.push({
        operationName: operationName || extractOperationName(query) || '(anonymous)',
        kind: extractKind(query),
        query,
        variables: obj.variables,
        batchCount: list.length,
        persistedHash,
      });
      continue;
    }

    if (persistedHash && operationName) {
      ops.push({
        operationName,
        kind: 'query',
        query: '',
        variables: obj.variables,
        batchCount: list.length,
        persistedHash,
      });
    }
  }
  return ops[0];
}

function readPersistedHash(obj: Record<string, unknown>): string | undefined {
  const ext = obj.extensions;
  if (!ext || typeof ext !== 'object')
    return undefined;
  const pq = (ext as Record<string, unknown>).persistedQuery;
  if (!pq || typeof pq !== 'object')
    return undefined;
  const hash = (pq as Record<string, unknown>).sha256Hash;
  return typeof hash === 'string' ? hash : undefined;
}

function extractKind(query: string): GraphqlOperationKind {
  const m = query.match(/^\s*(?:#[^\n]*\n\s*)*(query|mutation|subscription)\b/);
  if (m)
    return m[1] as GraphqlOperationKind;
  return 'query';
}

function extractOperationName(query: string): string | undefined {
  const m = query.match(/^\s*(?:#[^\n]*\n\s*)*(?:query|mutation|subscription)\s+([A-Za-z_][A-Za-z0-9_]*)/);
  return m?.[1];
}
