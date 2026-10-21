// ESLint with the default recommended rules (WorkPlan §6.1, F1-F6).
// The only project-specific setting is the package-boundary rule (F3).
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import prettier from 'eslint-config-prettier';

const reactFiles = ['apps/client/src/**/*.{ts,tsx}', 'packages/lang-cypher-ui/src/**/*.{ts,tsx}'];

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/generated/**', 'reports/**', 'coverage/**', '**/node_modules/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{js,mjs,cjs,ts,tsx}'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: reactFiles,
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  {
    // F3: Cypher and Neo4j specific code stays behind the lang-* / engine-* packages, so the query
    // language and the engine can be replaced (WorkPlan §2.2, §11.3).
    files: [
      'apps/server/src/**',
      'apps/ingest/src/**',
      'apps/client/src/**',
      'packages/query-core/src/**',
      'packages/graph-core/src/**',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'neo4j-driver', message: 'Only engine-neo4j talks to Neo4j.' },
            { name: '@gd/engine-neo4j', message: 'Only apps/dal uses engine-neo4j.' },
          ],
        },
      ],
    },
  },
  prettier,
);
