// Test helper: a throwaway git repo whose gh-pages branch has one commit per given version of
// _data/conferences.yml (plus an unrelated commit), standing in for the PwC clone.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function makePwcRepo(versions: readonly string[]): { gitDir: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'pwc-test-repo-'));
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', root, ...args], {
      stdio: 'ignore',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 't',
        GIT_AUTHOR_EMAIL: 't@example.com',
        GIT_COMMITTER_NAME: 't',
        GIT_COMMITTER_EMAIL: 't@example.com',
      },
    });
  git('init', '--quiet', '--initial-branch=gh-pages');
  mkdirSync(join(root, '_data'));
  versions.forEach((text, i) => {
    writeFileSync(join(root, '_data', 'conferences.yml'), text);
    git('add', '_data/conferences.yml');
    git('commit', '--quiet', '-m', `v${i}`);
  });
  writeFileSync(join(root, 'README.md'), 'unrelated');
  git('add', 'README.md');
  git('commit', '--quiet', '-m', 'readme');
  return {
    gitDir: join(root, '.git'),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}
