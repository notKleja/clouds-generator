import { copyFile, mkdir, mkdtemp, rename, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
await mkdir('out/dist', { recursive: true });
await mkdir('out/artifacts', { recursive: true });
for (const name of ['manifest.json', 'code.js', 'ui.html', 'README.md', 'THIRD_PARTY_NOTICES.md'])
  await copyFile(name, path.join('out/dist', name));
// Write to a fresh temporary archive so an older ZIP cannot retain stale files.
const temporary = await mkdtemp(path.resolve('out/artifacts/package-'));
try {
  const zip = path.join(temporary, 'clouds-generator.zip');
  execFileSync(
    'zip',
    ['-X', '-q', zip, 'manifest.json', 'code.js', 'ui.html', 'README.md', 'THIRD_PARTY_NOTICES.md'],
    {
      cwd: 'out/dist',
      stdio: 'inherit',
    },
  );
  await rename(zip, path.resolve('out/artifacts/clouds-generator.zip'));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
console.log('Plugin package: out/artifacts/clouds-generator.zip');
