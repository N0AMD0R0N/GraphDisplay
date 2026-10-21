import type { QueryLanguage } from '@gd/query-core';
import { LANGUAGE_ID, compileBuilder } from './compile';
import { prepareRaw } from './raw';

export { LANGUAGE_ID, compileBuilder, estimateMatches, exportRawText } from './compile';
export { prepareRaw, maskLiterals } from './raw';

export const cypherLanguage: QueryLanguage = {
  id: LANGUAGE_ID,
  compile: compileBuilder,
  prepare: prepareRaw,
};
