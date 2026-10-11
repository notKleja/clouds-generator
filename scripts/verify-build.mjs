import { execFileSync } from 'node:child_process';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const outputs = ['code.js', 'ui.html'];
const committed = process.argv.includes('--committed')
  ? Object.fromEntries(
      outputs.map((file) => [
        file,
        createHash('sha256')
          .update(execFileSync('git', ['show', `HEAD:${file}`]))
          .digest('hex'),
      ]),
    )
  : undefined;
async function snapshot() {
  execFileSync(process.execPath, ['scripts/build.mjs'], { stdio: 'inherit' });
  return Object.fromEntries(
    await Promise.all(
      outputs.map(async (file) => [
        file,
        createHash('sha256')
          .update(await readFile(file))
          .digest('hex'),
      ]),
    ),
  );
}
const first = await snapshot();
const second = await snapshot();
for (const file of outputs) {
  if (first[file] !== second[file]) throw new Error(`Non-reproducible output: ${file}`);
  if (committed && committed[file] !== second[file])
    throw new Error(
      `Committed build is stale: ${file}. Run npm run build and commit the generated files.`,
    );
}
await mkdir('out/artifacts', { recursive: true });
await writeFile(
  'out/artifacts/reproducibility.json',
  JSON.stringify({ result: 'PASS', hashes: second }, null, 2) + '\n',
);
console.log('Two consecutive builds produced identical SHA-256 hashes:', second);
