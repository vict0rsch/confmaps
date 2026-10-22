// `pnpm data:validate`: offline checks of the committed data files (DESIGN.md §9).
//
//   --against <git-ref>  the archive at this ref must still be fully present (default: HEAD;
//                        CI passes HEAD^1, i.e. the base of the PR / the previous commit)
//   --data-dir <dir>     default: data
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { archiveIds, parseArchive, type ArchiveIds } from './lib/archive';
import { dataPaths, loadInputs } from './lib/files';
import { validateDataset } from './lib/validate';

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
      'data-dir': { type: 'string', default: 'data' },
    },
  });
  const dataDir = values['data-dir'];
  const paths = dataPaths(dataDir);
  const inputs = loadInputs(dataDir);
  const errors = [...inputs.errors];

  let data: unknown;
  if (!existsSync(paths.output))
    errors.push(`${paths.output} does not exist (run pnpm data:build)`);
  else data = JSON.parse(readFileSync(paths.output, 'utf8'));

  const prev = archiveIdsAtRef(dataDir, values.against);
  if (typeof prev === 'string') console.warn(`  ⚠ skipping archive-shrink check: ${prev}`);

  if (data !== undefined && inputs.errors.length === 0) {
    errors.push(
      ...validateDataset({
        data,
        satellites: inputs.satellites,
        overrides: inputs.overrides,
        geocache: inputs.geocache,
        archive: inputs.archive,
        previousArchive:
          typeof prev === 'string' ? undefined : { ids: prev, label: values.against },
      }),
    );
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
