// Upstream conferences: huggingface/ai-deadlines `src/data/conferences/*.yml` (DESIGN.md §3.1).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';
import { UpstreamConferenceSchema, type UpstreamConference } from '../schema';

export const UPSTREAM_REPO = 'https://github.com/huggingface/ai-deadlines.git';
export const UPSTREAM_BRANCH = 'main';
export const UPSTREAM_PATH = 'src/data/conferences';

/** Shallow sparse clone into a temp dir (nothing is committed). Returns the checkout root. */
export function fetchUpstream(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'ai-deadlines-'));
  const git = (...args: string[]) =>
    execFileSync('git', args, { stdio: ['ignore', 'ignore', 'inherit'] });
  git(
    'clone',
    '--quiet',
    '--depth=1',
    '--filter=blob:none',
    '--sparse',
    `--branch=${UPSTREAM_BRANCH}`,
    UPSTREAM_REPO,
    dir,
  );
  git('-C', dir, 'sparse-checkout', 'set', UPSTREAM_PATH);
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/**
 * Read and validate every `*.yml` under `<dir>/src/data/conferences/` (or directly under `dir`
 * if that subpath does not exist, e.g. a fixtures folder).
 */
export function readUpstreamDir(dir: string): { entries: UpstreamConference[]; errors: string[] } {
  const confDir = existsSync(join(dir, UPSTREAM_PATH)) ? join(dir, UPSTREAM_PATH) : dir;
  const entries: UpstreamConference[] = [];
  const errors: string[] = [];
  const files = readdirSync(confDir)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .sort();
  if (files.length === 0) errors.push(`upstream: no .yml files in ${confDir}`);
  for (const f of files) {
    let doc: unknown;
    try {
      doc = parse(readFileSync(join(confDir, f), 'utf8'));
    } catch (e) {
      errors.push(`upstream ${f}: invalid YAML: ${(e as Error).message}`);
      continue;
    }
    if (!Array.isArray(doc)) {
      errors.push(`upstream ${f}: expected a list of conferences`);
      continue;
    }
    doc.forEach((raw, i) => {
      const r = UpstreamConferenceSchema.safeParse(raw);
      if (r.success) entries.push(r.data);
      else {
        const id = (raw as { id?: unknown })?.id ?? `#${i}`;
        for (const issue of r.error.issues) {
          errors.push(`upstream ${f} ${String(id)}: ${issue.path.join('.')}: ${issue.message}`);
        }
      }
    });
  }
  return { entries, errors };
}
