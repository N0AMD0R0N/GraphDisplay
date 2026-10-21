/** Jest configuration (WorkPlan §6). `npm test` / `npm run test:bail` go through tools/run-tests.mjs. */
module.exports = {
  rootDir: '..',
  testMatch: ['<rootDir>/tests/**/*.test.ts'],
  transform: {
    '^.+\\.(t|j)sx?$': [
      '@swc/jest',
      { jsc: { parser: { syntax: 'typescript', tsx: true }, target: 'es2022' }, module: { type: 'commonjs' } },
    ],
  },
  // `cookie` (used by Fastify's inject) ships ES modules only: let the transform convert it
  transformIgnorePatterns: ['/node_modules/(?!(\\.pnpm/)?cookie/)'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'json'],
  testEnvironment: 'node',
  // API/DAL/perf tests share one Neo4j + Redis: run files one after another
  maxWorkers: 1,
  testTimeout: 60000,
  globalSetup: '<rootDir>/tests/setup/global-setup.ts',
  globalTeardown: '<rootDir>/tests/setup/global-teardown.ts',
  reporters: ['default', '<rootDir>/tests/reporter/json-reporter.cjs'],
};
