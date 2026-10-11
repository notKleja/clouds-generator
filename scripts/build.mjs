import { build, context } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';
const options = { bundle: true, target: 'es2017', logLevel: 'info' };
async function ui() {
  const result = await build({ ...options, entryPoints: ['src/ui.ts'], write: false, minify: true });
  const [template, css, components, editor, undo, redo] = await Promise.all([readFile('src/ui.html', 'utf8'), readFile('src/ui.css', 'utf8'), readFile('node_modules/@rogieking/figui3/dist/fig.css', 'utf8'), readFile('node_modules/@rogieking/figui3/dist/fig-editor.css', 'utf8'), readFile('src/icons/undo-2.svg', 'utf8'), readFile('src/icons/redo-2.svg', 'utf8')]);
  const icon = svg => svg.replace('<svg', '<svg aria-hidden="true" focusable="false"');
  const html = template.replace('<!-- UNDO_ICON -->', icon(undo)).replace('<!-- REDO_ICON -->', icon(redo));
  await writeFile('ui.html', html.replace('/* STYLES */', components + '\n' + editor + '\n' + css).replace('/* SCRIPT */', result.outputFiles[0].text));
}
await build({ ...options, entryPoints: ['code.ts'], outfile: 'code.js' });
await ui();
if (process.argv.includes('--watch')) {
  const { watch } = await import('node:fs');
  const ctx = await context({ ...options, entryPoints: ['code.ts'], outfile: 'code.js' });
  await ctx.watch();
  let timer;
  watch('src', { recursive: true }, () => { clearTimeout(timer); timer = setTimeout(() => ui().catch(console.error), 100); });
  console.log('Watching plugin and UI sources.');
}
