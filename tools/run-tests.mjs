// `npm test`            -> type-check, then run all tests and write reports/test-report-<timestamp>.json
// `npm run test:bail`   -> type-check, then stop at the FIRST failing test and print the full reason
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bail = process.argv.includes('--bail');
const extra = process.argv.slice(2).filter((a) => a !== '--bail');

const run = (cmd, args, env = {}) =>
  spawnSync(cmd, args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, ...env },
  });

console.log('> type-check');
const tsc = run('npx', ['tsc', '-p', 'tsconfig.json', '--noEmit']);
if (tsc.status !== 0) {
  console.error('Type errors: fix them before the tests can run.');
  process.exit(tsc.status ?? 1);
}

console.log(bail ? '> jest (stop at the first failing test)' : '> jest (all tests)');
const args = ['jest', '--config', 'tests/jest.config.cjs'];
if (bail) {
  args.push('--runInBand', '--bail=1', '--testEnvironment', resolve(root, 'tests/env/bail-environment.cjs'));
}
const jest = run('npx', [...args, ...extra], { TEST_BAIL: bail ? '1' : '' });
process.exit(jest.status ?? 1);
