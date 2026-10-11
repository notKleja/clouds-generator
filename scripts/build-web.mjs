import { build, transform } from 'esbuild';
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { figuiBundle } from './figui.mjs';

const options = { bundle: true, target: 'es2022', write: false, minify: true, logLevel: 'info' };
const sources = (await readdir('src')).filter((name) => /\.(ts|html)$/.test(name));
const application = (
  await Promise.all(sources.map((name) => readFile(`src/${name}`, 'utf8')))
).join('\n');
const figui = await figuiBundle(application);
const worker = await build({ ...options, entryPoints: ['src/shadow-worker.ts'] });
const app = await build({
  ...options,
  entryPoints: ['src/ui.ts'],
  plugins: [figui.plugin],
  define: { __WEB_APP__: 'true', __SHADOW_WORKER__: JSON.stringify(worker.outputFiles[0].text) },
});
const [template, sharedCss, webCss, components, undo, redo] = await Promise.all([
  readFile('src/ui.html', 'utf8'),
  readFile('src/ui.css', 'utf8'),
  readFile('web/web.css', 'utf8'),
  figui.css(),
  readFile('src/icons/undo-2.svg', 'utf8'),
  readFile('src/icons/redo-2.svg', 'utf8'),
]);
const styles = await transform([components, sharedCss, webCss].join('\n'), {
  loader: 'css',
  minify: true,
});
const icon = (svg) => svg.replace('<svg', '<svg aria-hidden="true" focusable="false"');
const header = `<a class="web-skip-link" href="#web-controls">Skip to cloud controls</a>
<header class="web-header">
  <div class="web-brand"><h1>Clouds</h1><p>Procedural cloud generator</p></div>
  <nav class="web-links" aria-label="Project links">
    <a href="https://github.com/notKleja/clouds-generator#readme" target="_blank" rel="noopener noreferrer">Figma plugin</a>
    <a href="https://github.com/notKleja/clouds-generator" target="_blank" rel="noopener noreferrer">GitHub <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M6 3H3v10h10v-3M9 3h4v4M7 9l6-6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg></a>
  </nav>
</header>`;
const privacy =
  '<p class="web-local-note">Made on your device. No uploads. <a href="./THIRD_PARTY_NOTICES.md">Credits</a></p>';
// Fail explicitly if the shared template changes shape rather than silently
// shipping a page without its styles, script, or responsive layout boundaries.
let html = template;
function replaceOnce(search, replacement) {
  if (html.split(search).length !== 2)
    throw new Error(`Expected one shared template marker: ${search}`);
  html = html.replace(search, () => replacement);
}
replaceOnce('<!-- CLOUDS_SESSION -->', '');
replaceOnce(
  '<title>Clouds generator</title>',
  '<title>Clouds · Procedural cloud generator</title><meta name="description" content="Create soft procedural clouds, shape them, and download transparent PNGs. Generated locally in your browser."><meta name="color-scheme" content="light dark">',
);
replaceOnce('<style>/* STYLES */</style>', '<link rel="stylesheet" href="./assets/styles.css">');
replaceOnce('<!-- UNDO_ICON -->', icon(undo));
replaceOnce('<!-- REDO_ICON -->', icon(redo));
replaceOnce('<body>', `<body class="web-app">${header}<div class="web-workspace">`);
replaceOnce(
  '<main>',
  '<div class="web-panel"><main id="web-controls" tabindex="-1" aria-label="Cloud controls">',
);
replaceOnce('</fig-footer>', `${privacy}</fig-footer></div></div>`);
replaceOnce(
  '<script>/* SCRIPT */</script>',
  '<script src="./assets/app.js" defer></script><noscript><p class="web-noscript">Enable JavaScript to generate and download clouds.</p></noscript>',
);
await mkdir('out/web/assets', { recursive: true });
await Promise.all([
  writeFile('out/web/index.html', html),
  writeFile('out/web/assets/app.js', app.outputFiles[0].text),
  writeFile('out/web/assets/styles.css', styles.code),
  writeFile('out/web/.nojekyll', ''),
  copyFile('THIRD_PARTY_NOTICES.md', 'out/web/THIRD_PARTY_NOTICES.md'),
]);
console.log(
  `Web app: out/web/index.html (${Buffer.byteLength(html)} bytes HTML, ${app.outputFiles[0].contents.length} bytes JS, ${Buffer.byteLength(styles.code)} bytes CSS)`,
);
