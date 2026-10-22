// `pnpm data:validate`: offline checks of the committed data files (DESIGN.md §9): schemas,
// references, the archive (never shrinks, no id in two year files), plausibility (sanityCheck)
// and that data.json matches the inputs as far as they can be re-derived offline (see
// lib/consistency.ts for exactly what that covers).
//
//   --against <git-ref>          the archive at this ref must still be fully present (default:
//                                HEAD); if the ref is missing/unreadable, warn and skip the check
//   --require-against <git-ref>  same, but a missing/unreadable ref is an error (CI passes the PR
//                                base / the commit before the push)
//   --data-dir <dir>     default: data
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { archiveIds, parseArchive, type ArchiveIds } from './lib/archive';
import { checkConsistency } from './lib/consistency';
import { dataPaths, loadInputs } from './lib/files';
import { sanityCheck, validateDataset } from './lib/validate';
import type { DataFile } from './schema';

/** Archive ids committed at `ref`, or a reason why they cannot be read. */
export function archiveIdsAtRef(dataDir: string, ref: string): ArchiveIds | string {
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', dataDir, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  try {
    git('rev-parse', '--verify', '--quiet', `${ref}^{commit}`);
  } catch {
    return `git ref "${ref}" not found`;
  }
  const files: Record<string, string> = {};
  const names = git('ls-tree', '--name-only', ref, 'archive/').split('\n').filter(Boolean);
  for (const path of names) {
    const name = path.slice('archive/'.length);
    files[name] = git('show', `${ref}:./${path}`);
  }
  const { archive, errors } = parseArchive(files);
  if (errors.length) return `archive at ${ref} is unreadable: ${errors[0]}`;
  return archiveIds(archive);
}

export function main(argv: string[]): number {
  const { values } = parseArgs({
    args: argv,
    options: {
      against: { type: 'string', default: 'HEAD' },
      'require-against': { type: 'string' },
      'data-dir': { type: 'string', default: 'data' },
    },
  });
  const dataDir = values['data-dir'];
  const paths = dataPaths(dataDir);
  const inputs = loadInputs(dataDir);
  const errors = [...inputs.errors, ...inputs.archiveDuplicates];

  let data: unknown;
  if (!existsSync(paths.output))
    errors.push(`${paths.output} does not exist (run pnpm data:build)`);
  else data = JSON.parse(readFileSync(paths.output, 'utf8'));

  const required = values['require-against'] !== undefined;
  const against = values['require-against'] ?? values.against;
  const prev = archiveIdsAtRef(dataDir, against);
  if (typeof prev === 'string') {
    if (required) errors.push(`archive-shrink check impossible: ${prev}`);
    else console.warn(`  ⚠ skipping archive-shrink check: ${prev}`);
  }

  if (data !== undefined && inputs.errors.length === 0) {
    const common = {
      satellites: inputs.satellites,
      overrides: inputs.overrides,
      geocache: inputs.geocache,
      archive: inputs.archive,
    };
    const invalid = validateDataset({
      data,
      ...common,
      previousArchive: typeof prev === 'string' ? undefined : { ids: prev, label: against },
    });
    errors.push(...invalid);
    // The deeper checks assume a schema-valid file; skip them if it is not.
    if (invalid.length === 0) {
      const d = data as DataFile;
      const sanity = sanityCheck(d, inputs.overrides, inputs.geocache);
      for (const w of sanity.warnings) console.warn(`  ⚠ ${w}`);
      errors.push(...sanity.errors, ...checkConsistency({ data: d, ...common }));
    }
  }

  if (errors.length) {
    console.error(`data:validate failed with ${errors.length} error(s):`);
    for (const e of errors) console.error(`  ✗ ${e}`);
    return 1;
  }
  const d = data as { conferences: unknown[]; locations: unknown[] };
  console.log(
    `data:validate ok: ${d.conferences.length} conferences, ${d.locations.length} locations, ` +
      `${inputs.satellites.length} satellites, ${inputs.archive.conferences.length} archived conferences`,
  );
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href)
  process.exit(main(process.argv.slice(2)));
