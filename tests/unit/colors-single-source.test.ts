import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = join(__dirname, '..', '..');
const SHARED_COLORS = ['packages', 'api-contract', 'src', 'colors.ts'].join(sep);
const COLOR_LITERAL = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === 'node_modules' || name === 'dist') return [];
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !name.endsWith('.d.ts') ? [path] : [];
  });
}

describe('colours', () => {
  it('are defined only in the shared colours file', () => {
    const offenders = ['apps', 'packages']
      .flatMap((d) => sourceFiles(join(ROOT, d)))
      .filter((f) => relative(ROOT, f) !== SHARED_COLORS)
      .filter((f) => COLOR_LITERAL.test(readFileSync(f, 'utf8')))
      .map((f) => relative(ROOT, f));
    expect(offenders).toEqual([]);
  });
});
