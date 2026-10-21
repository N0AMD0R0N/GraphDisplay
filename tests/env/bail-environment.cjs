/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS file loaded directly by Jest */
// Jest's own --bail stops after the first failed test FILE. This environment goes further: once a test
// fails, every remaining test is skipped, so the run stops at the first failing test (WorkPlan D5).
const NodeEnvironment = require('jest-environment-node').TestEnvironment;

class BailEnvironment extends NodeEnvironment {
  failed = false;

  async handleTestEvent(event) {
    if (event.name === 'test_fn_failure' || event.name === 'hook_failure') this.failed = true;
    if (event.name === 'test_start' && this.failed) event.test.mode = 'skip';
  }
}

module.exports = BailEnvironment;
