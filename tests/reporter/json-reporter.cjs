/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS file loaded directly by Jest */
// Writes a formatted JSON report to reports/test-report-<timestamp>.json (WorkPlan D4).
const fs = require('node:fs');
const path = require('node:path');

function stripAnsi(s) {
  // eslint-disable-next-line no-control-regex
  return String(s).replace(/\u001b\[[0-9;]*m/g, '');
}

class JsonReporter {
  constructor(globalConfig) {
    this.root = globalConfig.rootDir;
  }

  onRunComplete(_contexts, results) {
    const suites = results.testResults.map((suite) => ({
      file: path.relative(this.root, suite.testFilePath).replace(/\\/g, '/'),
      status: suite.numFailingTests > 0 || suite.testExecError ? 'failed' : 'passed',
      durationMs: suite.perfStats.end - suite.perfStats.start,
      error: suite.testExecError ? String(suite.testExecError.message || suite.testExecError) : undefined,
      tests: suite.testResults.map((t) => ({
        name: t.fullName,
        status: t.status,
        durationMs: t.duration ?? 0,
        failure: t.failureMessages.length ? t.failureMessages.map(stripAnsi).join('\n') : undefined,
      })),
    }));
    const report = {
      generatedAt: new Date().toISOString(),
      mode: process.env.TEST_BAIL ? 'bail' : 'all',
      success: results.success,
      summary: {
        suites: results.numTotalTestSuites,
        suitesFailed: results.numFailedTestSuites,
        tests: results.numTotalTests,
        passed: results.numPassedTests,
        failed: results.numFailedTests,
        skipped: results.numPendingTests,
        durationMs: Date.now() - results.startTime,
      },
      suites,
    };
    const dir = path.join(this.root, 'reports');
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = path.join(dir, `test-report-${stamp}.json`);
    fs.writeFileSync(file, JSON.stringify(report, null, 2) + '\n');
    process.stderr.write(`\nTest report: ${path.relative(this.root, file)}\n`);
  }
}

module.exports = JsonReporter;
