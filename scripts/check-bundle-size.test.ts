import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { entryScripts, LIMIT_BYTES, main } from './check-bundle-size';

/** A dist directory whose index.html loads one script of `bytes` incompressible bytes. */
function fakeDist(bytes: number): string {
  const dist = mkdtempSync(join(tmpdir(), 'check-bundle-'));
  mkdirSync(join(dist, 'assets'));
  writeFileSync(join(dist, 'assets', 'index-abc.js'), randomBytes(bytes));
  writeFileSync(
    join(dist, 'index.html'),
    '<script type="module" crossorigin src="/assets/index-abc.js"></script>',
  );
  return dist;
}

describe('check:bundle', () => {
  afterEach(() => vi.restoreAllMocks());

  it('finds the module scripts of index.html', () => {
    const html =
      '<script>inline()</script><script type="module" crossorigin src="/assets/index-x.js">' +
      '</script><link rel="stylesheet" href="/assets/index-x.css">';
    expect(entryScripts(html)).toEqual(['assets/index-x.js']);
  });

  it('passes under the limit and fails over it with the split suggestion', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(main(['--dist', fakeDist(LIMIT_BYTES / 2)])).toBe(0);
    expect(main(['--dist', fakeDist(LIMIT_BYTES + 1000)])).toBe(1);
    expect(error.mock.calls[0][0]).toMatch(/over the 400\.0 kB limit[\s\S]*split the data/);
  });
});
