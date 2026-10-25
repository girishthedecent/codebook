// Prerenders the landing page into dist/index.html after `vite build`, so `/` reads as plain
// HTML before any script runs. The SPA then takes over the same markup.
import { readFile, writeFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { createServer } from 'vite';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const INLINE_CSS_LIMIT = 20 * 1024;

// Vite's SSR loader handles TSX, the `@/` alias and CSS imports without a second build setup.
const vite = await createServer({
  // Its own cache: sharing the dev server's would delete the dependencies it is serving.
  cacheDir: fileURLToPath(new URL('../node_modules/.vite-prerender', import.meta.url)),
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
});
let markup: string;
try {
  const mod = (await vite.ssrLoadModule('/src/features/landing/Landing.tsx')) as {
    Landing: () => React.ReactElement;
  };
  markup = renderToString(createElement(mod.Landing));
} finally {
  await vite.close();
}

let html = await readFile(dist + 'index.html', 'utf8');
if (!html.includes('<div id="root"></div>')) throw new Error('dist/index.html has no empty #root');
html = html.replace('<div id="root"></div>', `<div id="root">${markup}</div>`);

// Inline the stylesheet when it is small enough to save a round trip on first paint.
const cssTag = /<link rel="stylesheet"[^>]*href="(\/assets\/[^"]+\.css)"[^>]*>/.exec(html);
if (cssTag) {
  const cssPath = dist + cssTag[1]!.slice(1);
  if ((await stat(cssPath)).size <= INLINE_CSS_LIMIT) {
    html = html.replace(cssTag[0], `<style>${await readFile(cssPath, 'utf8')}</style>`);
  }
}

await writeFile(dist + 'index.html', html);
console.log(`prerendered / (${(Buffer.byteLength(html) / 1024).toFixed(1)} KB)`);
