import { build, context, transform } from 'esbuild';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { figuiBundle } from './figui.mjs';
const options = { bundle: true, target: 'es2017', logLevel: 'info' };
async function ui() {
  const files = (await readdir('src')).filter((name) => /\.(ts|html)$/.test(name));
  const application = (
    await Promise.all(files.map((name) => readFile(`src/${name}`, 'utf8')))
  ).join('\n');
  const figui = await figuiBundle(application);
  const worker = await build({
    ...options,
    entryPoints: ['src/shadow-worker.ts'],
    target: 'es2022',
    write: false,
    minify: true,
  });
  const result = await build({
    ...options,
    entryPoints: ['src/ui.ts'],
    target: 'es2022',
    write: false,
    minify: true,
    plugins: [figui.plugin],
    define: { __SHADOW_WORKER__: JSON.stringify(worker.outputFiles[0].text), __WEB_APP__: 'false' },
  });
  const [template, css, components, undo, redo] = await Promise.all([
    readFile('src/ui.html', 'utf8'),
    readFile('src/ui.css', 'utf8'),
    figui.css(),
    readFile('src/icons/undo-2.svg', 'utf8'),
    readFile('src/icons/redo-2.svg', 'utf8'),
  ]);
  const styles = await transform(components + '\n' + css, { loader: 'css', minify: true });
  const icon = (svg) => svg.replace('<svg', '<svg aria-hidden="true" focusable="false"');
  const html = template
    .replace('<!-- UNDO_ICON -->', () => icon(undo))
    .replace('<!-- REDO_ICON -->', () => icon(redo));
  const output = html
    .replace('/* STYLES */', () => styles.code)
    .replace('/* SCRIPT */', () => result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script'));
  await writeFile('ui.html', output);
  await mkdir('out/artifacts', { recursive: true });
  await writeFile(
    'out/artifacts/bundle.json',
    JSON.stringify(
      {
        uiBytes: Buffer.byteLength(output),
        javascriptBytes: result.outputFiles[0].contents.length,
        cssBytes: Buffer.byteLength(styles.code),
        workerBytes: worker.outputFiles[0].contents.length,
        components: figui.used,
      },
      null,
      2,
    ) + '\n',
  );
}
await build({ ...options, entryPoints: ['code.ts'], outfile: 'code.js' });
await ui();
if (process.argv.includes('--watch')) {
  const { watch } = await import('node:fs');
  const ctx = await context({ ...options, entryPoints: ['code.ts'], outfile: 'code.js' });
  await ctx.watch();
  let timer;
  let running = Promise.resolve();
  watch('src', { recursive: true }, () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      running = running.then(ui).catch(console.error);
    }, 100);
  });
  console.log('Watching plugin, UI and worker sources.');
}
