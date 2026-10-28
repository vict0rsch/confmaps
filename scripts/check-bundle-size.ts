// `pnpm check:bundle`: fails when the JavaScript that dist/index.html loads before the first render
// is over 400 kB gzip. data.json is a static import inside that file (src/lib/data/load.ts), so
// it grows with the data. Run after `pnpm build`.
//
//   --dist <dir>   default: dist
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { gzipSync } from 'node:zlib';

export const LIMIT_BYTES = 400_000;

/** Paths of the module scripts that index.html loads, relative to the dist directory. */
export function entryScripts(indexHtml: string): string[] {
  return [...indexHtml.matchAll(/<script\b[^>]*\bsrc="\/([^"]+\.js)"/g)].map((m) => m[1]);
}

const kB = (bytes: number) => `${(bytes / 1000).toFixed(1)} kB`;

export function main(argv: string[]): number {
  const { values } = parseArgs({ args: argv, options: { dist: { type: 'string' } } });
  const dist = values.dist ?? 'dist';
  const scripts = entryScripts(readFileSync(join(dist, 'index.html'), 'utf8'));
  if (!scripts.length) {
    console.error(`check:bundle failed: no module script in ${join(dist, 'index.html')}`);
    return 1;
  }
  let total = 0;
  for (const s of scripts) {
    const size = gzipSync(readFileSync(join(dist, s))).length;
    console.log(`  ${s}: ${kB(size)} gzip`);
    total += size;
  }
  if (total > LIMIT_BYTES) {
    console.error(
      `check:bundle failed: the JavaScript loaded before the first render is ${kB(total)} gzip, ` +
        `over the ${kB(LIMIT_BYTES)} limit.\n` +
        'Suggestion: split the data loading in two. Keep a live slice in the main bundle, from ' +
        'today minus 5 years to today plus 12 months (the default window and the "Past 5 years" ' +
        'preset). Move the historical editions to a second file that the app starts fetching ' +
        'asynchronously at first render (not lazily on first use). Until it arrives, the ' +
        'features that need it wait for it: "Since <year>", history mode, Play, and a URL ' +
        'whose window starts before the cutoff.',
    );
    return 1;
  }
  console.log(`check:bundle ok: ${kB(total)} gzip of ${kB(LIMIT_BYTES)}`);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href)
  process.exit(main(process.argv.slice(2)));
