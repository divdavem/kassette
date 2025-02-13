import * as crypto from 'crypto';

import {sanitize, NonSanitizedArray} from '../../../lib/array';
import {stringifyPretty} from '../../../lib/json';

import {IMock} from '../model';

import {
  ChecksumArgs, ChecksumReturn,
  Spec, DefaultInclude, BaseSpec,
  MaybeAsync,
  MethodSpec, PathnameSpec, BodySpec, QuerySpec,
  isFilter, isListing, ListOrFilter, HeadersSpec, ObjectMap,
} from './model';



////////////////////////////////////////////////////////////////////////////////
//
////////////////////////////////////////////////////////////////////////////////

export async function computeChecksum(mock: IMock, spec: ChecksumArgs): Promise<ChecksumReturn> {
  const type = spec.type ?? 'sha256';
  const format = spec.format ?? 'hex';

  const content = await computeContent(mock, spec);
  const checksum = crypto.createHash(type).update(content).digest(format);

  return {checksum, content};
}

function identity<T = any>(value: T): T {
  return value;
}

export async function computeContent(mock: IMock, spec: ChecksumArgs): Promise<string> {
  const parts: NonSanitizedArray = [];

  function push(header: string, data: string | null) {
    parts.push(header, data, '');
  }

  push('method', await processSpec<MethodSpec>(spec.method, false, () => {
    return mock.request.method.toLowerCase();
  }));

  push('pathname', await processSpec<PathnameSpec>(spec.pathname, false, async spec => {
    const filter = spec.filter ?? identity;
    return await filter(mock.request.pathname);
  }));

  push('body', await processSpec<BodySpec>(spec.body, true, async spec => {
    const filter = spec.filter ?? identity;
    return (await filter(mock.request.body)).toString();
  }));

  push('query', await processSpec<QuerySpec>(spec.query, true, async spec => {
    return await processList(spec, mock.request.queryParameters, true);
  }));

  push('headers', await processSpec<HeadersSpec>(spec.headers, false, async spec => {
    return await processList(spec, mock.request.headers, false);
  }));

  push('custom data', stringifyPretty(spec.customData));

  return sanitize(parts).join('\n');
}

export async function processList(spec: ListOrFilter, input: ObjectMap, defaultCaseSensitive: boolean): Promise<string> {
  let output;

  if (isFilter(spec)) {
    output = await spec.filter(input);
  } else {
    const caseSensitive = spec.caseSensitive ?? defaultCaseSensitive;
    let properties;

    if (!isListing(spec)) {
      properties = Object.keys(input);
    } else {
      const mode = spec.mode ?? 'whitelist';
      const keys = spec.keys ?? [];
      if (mode === 'whitelist') {
        properties = keys;
      } else {
        let disallowedKeys = keys;
        if (!caseSensitive) disallowedKeys = disallowedKeys.map(key => key.toLowerCase());

        properties = [];
        for (const key of Object.keys(input)) {
          let checkedKey = key;
          if (!caseSensitive) checkedKey = checkedKey.toLowerCase();

          if (!disallowedKeys.includes(checkedKey)) properties.push(key);
        }
      }
    }
    output = {} as any;
    for (const key of properties) {
      let targetKey = key;
      if (!caseSensitive) targetKey = targetKey.toLowerCase();
      output[targetKey] = input[key];
    }
  }

  return stringifyPretty(output);
}



////////////////////////////////////////////////////////////////////////////////
//
////////////////////////////////////////////////////////////////////////////////

export async function processSpec<SpecType>(
  spec: Spec<SpecType>,
  includedByDefault: DefaultInclude,
  process: (spec: SpecType) => MaybeAsync<string>,
): Promise<string | null> {
  const newSpec = normalizeSpec(spec, includedByDefault);
  if (!newSpec.include) return null;
  return await process(newSpec);
}

export function normalizeSpec<SpecType extends BaseSpec>(
  spec: Spec<SpecType>,
  defaultValue?: DefaultInclude,
): any {
  if (spec === true) return {include: true};
  if (spec === false) return {include: false};
  if (spec == null) {
    if (defaultValue != null) return {include: defaultValue};
    return {include: false};
  }
  if (spec.include == null) return Object.assign({}, spec, {include: true});
  return spec as {include: boolean};
}
