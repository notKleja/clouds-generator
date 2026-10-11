import { execFileSync, spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const site = path.resolve('out/web');
await access(path.join(site, 'index.html'));
const git = (args, cwd = process.cwd()) =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const remote = git(['remote', 'get-url', 'origin']);
const existing = git(['ls-remote', remote, 'refs/heads/gh-pages']);
const directory = await mkdtemp(path.join(tmpdir(), 'clouds-pages-'));
try {
  git(['init', '--initial-branch=gh-pages'], directory);
  git(['remote', 'add', 'origin', remote], directory);
  for (const key of ['user.name', 'user.email'])
    git(['config', key, git(['config', key])], directory);
  if (existing) {
    git(['fetch', '--depth=1', 'origin', 'gh-pages'], directory);
    git(['checkout', '-B', 'gh-pages', 'FETCH_HEAD'], directory);
    git(['rm', '-r', '--ignore-unmatch', '.'], directory);
  }
  for (const file of [
    'index.html',
    '.nojekyll',
    'THIRD_PARTY_NOTICES.md',
    'assets/app.js',
    'assets/styles.css',
  ]) {
    const destination = path.join(directory, file);
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(path.join(site, file), destination);
  }
  git(['add', '--all'], directory);
  const diff = spawnSync('git', ['diff', '--cached', '--quiet'], { cwd: directory });
  if (diff.status === 1) git(['commit', '-m', 'deploy: update cloud web tool'], directory);
  else if (diff.status !== 0) throw new Error('Could not inspect staged Pages files.');
  execFileSync('git', ['push', 'origin', 'HEAD:refs/heads/gh-pages'], {
    cwd: directory,
    stdio: 'inherit',
  });
  console.log(`Published gh-pages at ${git(['rev-parse', 'HEAD'], directory)}`);
} finally {
  await rm(directory, { recursive: true, force: true });
}
