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

const KEYWORDS = new Set(['query', 'mutation', 'subscription', 'fragment', 'on', 'true', 'false', 'null']);

type Token = { type: string, value: string };

function tokenize(src: string): Token[] {
  // Order matters: longer / more specific patterns come first. Each alternative is its own capturing group.
  const re = /(#[^\n]*)|("(?:[^"\\]|\\.)*")|(\d+(?:\.\d+)?)|(\$[A-Za-z_]\w*)|(\.\.\.)|(@[A-Za-z_]\w*)|([A-Za-z_]\w*)|([{}()[\]:=,!|&])|(\s+)|(.)/g;
  const tokens: Token[] = [];
  for (const m of src.matchAll(re)) {
    if (m[1] !== undefined) tokens.push({ type: 'comment', value: m[1] });
    else if (m[2] !== undefined) tokens.push({ type: 'string', value: m[2] });
    else if (m[3] !== undefined) tokens.push({ type: 'number', value: m[3] });
    else if (m[4] !== undefined) tokens.push({ type: 'variable', value: m[4] });
    else if (m[5] !== undefined) tokens.push({ type: 'spread', value: m[5] });
    else if (m[6] !== undefined) tokens.push({ type: 'directive', value: m[6] });
    else if (m[7] !== undefined) tokens.push({ type: KEYWORDS.has(m[7]) ? 'keyword' : 'name', value: m[7] });
    else if (m[8] !== undefined) tokens.push({ type: 'punct', value: m[8] });
    else if (m[9] !== undefined) tokens.push({ type: 'ws', value: m[9] });
    else if (m[10] !== undefined) tokens.push({ type: 'other', value: m[10] });
  }
  return tokens;
}

export const GraphqlSyntax: React.FC<{ text: string }> = ({ text }) => {
  const tokens = React.useMemo(() => tokenize(text), [text]);
  return <pre className='graphql-syntax'>
    {tokens.map((t, i) => {
      if (t.type === 'ws' || t.type === 'other')
        return <React.Fragment key={i}>{t.value}</React.Fragment>;
      return <span key={i} className={`gql-${t.type}`}>{t.value}</span>;
    })}
  </pre>;
};
