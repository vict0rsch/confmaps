import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PAST_FILE, pastEntries } from '../__fixtures__';
import { dataPaths, loadInputs, writeDataJson } from './files';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'confmaps-files-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('writeDataJson provenance', () => {
  it('records the upstream commit, and only updates it when the dataset changes', () => {
    const path = join(dir, 'data.json');
    const read = () => JSON.parse(readFileSync(path, 'utf8'));
    const a = { repo: 'huggingface/ai-deadlines', sha: 'a'.repeat(40) };
    const b = { repo: 'huggingface/ai-deadlines', sha: 'b'.repeat(40) };
    expect(writeDataJson(path, [], [], new Date('2025-01-01T00:00:00Z'), a)).toBe(true);
    expect(read().upstream).toEqual(a);
    // Same content from a newer upstream commit: byte-identical file, old SHA kept.
    expect(writeDataJson(path, [], [], new Date('2025-01-02T00:00:00Z'), b)).toBe(false);
    expect(read()).toMatchObject({ upstream: a, generatedAt: '2025-01-01T00:00:00.000Z' });
    // A real change takes the new SHA.
    const loc = { id: 'x' } as never;
    expect(writeDataJson(path, [], [loc], new Date('2025-01-03T00:00:00Z'), b)).toBe(true);
    expect(read()).toMatchObject({ upstream: b, generatedAt: '2025-01-03T00:00:00.000Z' });
  });
});

describe('loadInputs: past_conferences.yml', () => {
  it('is [] when the file is missing or empty', () => {
    expect(loadInputs(dir)).toMatchObject({ past: [], errors: [] });
    writeFileSync(dataPaths(dir).past, '');
    expect(loadInputs(dir)).toMatchObject({ past: [], errors: [] });
  });

  it('parses entries and reports schema errors', () => {
    copyFileSync(PAST_FILE, dataPaths(dir).past);
    expect(loadInputs(dir)).toMatchObject({ past: pastEntries(), errors: [] });
    writeFileSync(dataPaths(dir).past, '- id: Bad\n');
    expect(loadInputs(dir).errors).toEqual(
      expect.arrayContaining([expect.stringMatching(/^past_conferences\.yml: 0\.id: /)]),
    );
  });
});
