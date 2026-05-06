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

import type { ResourceSnapshot } from '@trace/snapshot';
import * as React from 'react';
import './networkResourceDetails.css';
import { TabbedPane } from '@web/components/tabbedPane';
import { CodeMirrorWrapper } from '@web/components/codeMirrorWrapper';
import { ToolbarButton } from '@web/components/toolbarButton';
import type { Language } from '@isomorphic/locatorGenerators';
import { useSetting } from '@web/uiUtils';
import { msToString } from '@isomorphic/formatUtils';
import { useTraceModel } from './traceModelContext';
import { Expandable } from '@web/components/expandable';
import { Toolbar } from '@web/components/toolbar';
import type { ParsedGraphqlBody } from './graphqlTab';

type ResponseBody = { text: string } | null;

export const GraphqlResourceDetails: React.FunctionComponent<{
  resource: ResourceSnapshot;
  parsed: ParsedGraphqlBody;
  sdkLanguage: Language;
  startTimeOffset: number;
  onClose: () => void;
}> = ({ resource, parsed, startTimeOffset, onClose }) => {
  const [selectedTab, setSelectedTab] = React.useState('request');

  return <TabbedPane
    leftToolbar={[<ToolbarButton key='close' icon='close' title='Close' onClick={onClose} />]}
    tabs={[
      {
        id: 'headers',
        title: 'Headers',
        render: () => <HeadersTab resource={resource} parsed={parsed} startTimeOffset={startTimeOffset} />,
      },
      {
        id: 'request',
        title: 'Request',
        render: () => <RequestTab parsed={parsed} />,
      },
      {
        id: 'response',
        title: 'Response',
        render: () => <ResponseTab resource={resource} formatted />,
      },
      {
        id: 'response-raw',
        title: 'Response (Raw)',
        render: () => <ResponseTab resource={resource} formatted={false} />,
      },
    ]}
    selectedTab={selectedTab}
    setSelectedTab={setSelectedTab} />;
};

const ExpandableSection: React.FC<{
  title: string;
  showCount?: boolean;
  data?: { name: string; value: React.ReactNode }[];
  children?: React.ReactNode;
  className?: string;
}> = ({ title, data, showCount, children, className }) => {
  const [expanded, setExpanded] = useSetting(`trace-viewer-graphql-details-${title.replaceAll(' ', '-')}`, true);
  return <Expandable
    expanded={expanded}
    setExpanded={setExpanded}
    expandOnTitleClick
    title={
      <span className='network-request-details-header'>{title}
        {showCount && <span className='network-request-details-header-count'> × {data?.length ?? 0}</span>}
      </span>
    }
    className={className}
  >
    {data && <table className='network-request-details-table'>
      <tbody>
        {data.map(({ name, value }, index) => (
          value !== null &&
          (<tr key={index}>
            <td>{name}</td>
            <td>{value}</td>
          </tr>)
        ))}
      </tbody>
    </table>}
    {children}
  </Expandable>;
};

const HeadersTab: React.FunctionComponent<{
  resource: ResourceSnapshot;
  parsed: ParsedGraphqlBody;
  startTimeOffset: number;
}> = ({ resource, parsed, startTimeOffset }) => {
  const generalData = React.useMemo(() =>
    Object.entries({
      'Operation': parsed.operationName,
      'Type': parsed.kind,
      'URL': resource.request.url,
      'Method': resource.request.method,
      'Status Code': resource.response.status === -1
        ? 'canceled'
        : resource.response.status > 0 && <span className={statusClass(resource.response.status)}> {resource.response.status} {resource.response.statusText}</span>,
      'Start': msToString(startTimeOffset),
      'Duration': msToString(resource.time),
      'Batch size': parsed.batchCount > 1 ? String(parsed.batchCount) : null,
      'Persisted hash': parsed.persistedHash ?? null,
    }).map(([name, value]) => ({ name, value })),
  [resource, parsed, startTimeOffset]);

  return <div className='vbox network-request-details-tab'>
    <ExpandableSection title='General' data={generalData} />
    <ExpandableSection title='Request Headers' showCount data={resource.request.headers} />
    <ExpandableSection title='Response Headers' showCount data={resource.response.headers} />
  </div>;
};

const RequestTab: React.FunctionComponent<{
  parsed: ParsedGraphqlBody;
}> = ({ parsed }) => {
  const variablesText = React.useMemo(() => {
    if (parsed.variables === undefined)
      return '';
    try {
      return JSON.stringify(parsed.variables, null, 2);
    } catch {
      return String(parsed.variables);
    }
  }, [parsed.variables]);

  const hasVariables = !!variablesText && variablesText !== '{}' && variablesText !== 'null';

  return <div className='vbox network-request-details-tab'>
    <ExpandableSection title={`Variables`}>
      {hasVariables
        ? <CodeMirrorWrapper text={variablesText} mimeType='application/json' readOnly lineNumbers={true} />
        : <em className='network-request-no-payload'>No variables.</em>}
    </ExpandableSection>
    <ExpandableSection title='Query'>
      {parsed.query
        ? <CodeMirrorWrapper text={parsed.query} mimeType='text/plain' readOnly lineNumbers={true} wrapLines={false} />
        : parsed.persistedHash
          ? <div className='network-request-no-payload'>Persisted query — body not sent. Hash: <code>{parsed.persistedHash}</code></div>
          : <em className='network-request-no-payload'>No query body.</em>}
    </ExpandableSection>
  </div>;
};

const ResponseTab: React.FunctionComponent<{
  resource: ResourceSnapshot;
  formatted: boolean;
}> = ({ resource, formatted }) => {
  const model = useTraceModel();
  const [responseBody, setResponseBody] = React.useState<ResponseBody>(null);

  React.useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const inline = resource.response.content?.text;
      if (inline !== undefined) {
        if (!cancelled)
          setResponseBody({ text: inline });
        return;
      }
      if (model && resource.response.content?._sha1) {
        const response = await fetch(model.createRelativeUrl(`sha1/${resource.response.content._sha1}`));
        const text = await response.text();
        if (!cancelled)
          setResponseBody({ text });
        return;
      }
      if (!cancelled)
        setResponseBody(null);
    };
    load();
    return () => { cancelled = true; };
  }, [resource, model]);

  const displayText = React.useMemo(() => {
    if (!responseBody)
      return '';
    if (!formatted)
      return responseBody.text;
    try {
      return JSON.stringify(JSON.parse(responseBody.text), null, 2);
    } catch {
      return responseBody.text;
    }
  }, [responseBody, formatted]);

  if (!resource.response.content?._sha1 && !resource.response.content?.text)
    return <div className='network-request-details-tab'>Response body is not available for this request.</div>;

  if (!responseBody)
    return <div className='network-request-details-tab'>Loading response…</div>;

  return <div className='vbox network-request-details-tab'>
    <div className='vbox network-response-body'>
      <CodeMirrorWrapper text={displayText} mimeType='application/json' readOnly lineNumbers={true} />
      <Toolbar noShadow={true} noMinHeight={true} className='network-response-toolbar'>
        <div style={{ margin: 'auto' }}></div>
      </Toolbar>
    </div>
  </div>;
};

function statusClass(statusCode: number): string {
  if (statusCode < 300 || statusCode === 304)
    return 'green-circle';
  if (statusCode < 400)
    return 'yellow-circle';
  return 'red-circle';
}
