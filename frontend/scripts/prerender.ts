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
    Landing: (props: { standalone?: boolean }) => React.ReactElement;
  };
  markup = renderToString(createElement(mod.Landing, { standalone: true }));
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

// The landing text repaints when its web fonts arrive, which sets the largest contentful paint.
// Without a preload the fonts are only found once the stylesheet is parsed, a round trip later.
if (cssTag) {
  const css = await readFile(dist + cssTag[1]!.slice(1), 'utf8');
  const wanted = [/source-serif-4-latin-opsz-normal/, /ibm-plex-sans-latin-(400|500)-normal/];
  const fonts = [...css.matchAll(/url\((\/assets\/[^)]+\.woff2)\)/g)]
    .map((m) => m[1]!)
    .filter((url) => wanted.some((re) => re.test(url)));
  const hints = fonts
    .map((url) => `<link rel="preload" as="font" type="font/woff2" crossorigin href="${url}">`)
    .join('');
  html = html.replace('</head>', `${hints}</head>`);
}

// `/` loads only the landing entry (src/landing.tsx); its links are ordinary navigations and the
// app starts on the page they lead to. A hover or touch warms the app's files so that navigation
// is quick. Every other URL is served this same file, so there the app starts at once, with the
// preloads the build would have emitted.
type Chunk = { file: string; src?: string; isEntry?: boolean; imports?: string[]; css?: string[] };
const manifest = JSON.parse(await readFile(dist + '.vite/manifest.json', 'utf8')) as Record<
  string,
  Chunk
>;
const landing = Object.values(manifest).find(
  (chunk) => chunk.isEntry && chunk.src === 'src/landing.tsx',
);
if (!landing) throw new Error('The build has no landing entry');
const landingFiles = new Set<string>();
const collect = (chunk: Chunk) => {
  for (const key of chunk.imports ?? []) {
    const dep = manifest[key]!;
    if (!landingFiles.has(dep.file)) {
      landingFiles.add(dep.file);
      collect(dep);
    }
  }
};
collect(landing);
const landingDeps = [...landingFiles].map((file) => `/${file}`);
const landingEntry = `/${landing.file}`;

const preloads = [...html.matchAll(/<link rel="modulepreload"[^>]*href="([^"]+)"[^>]*>/g)].map(
  (m) => m[1]!,
);
const entry = /<script type="module" crossorigin src="([^"]+)"><\/script>/.exec(html);
if (!entry || preloads.length === 0) throw new Error('dist/index.html has no module entry');
html = html.replace(/\s*<link rel="modulepreload"[^>]*>/g, '').replace(entry[0], '');
const loader = `<script>(function(){var deps=${JSON.stringify(preloads)},entry=${JSON.stringify(entry[1])},home=${JSON.stringify(landingDeps)},landing=${JSON.stringify(landingEntry)};function link(h){var l=document.createElement('link');l.rel='modulepreload';l.crossOrigin='';l.href=h;document.head.appendChild(l)}function load(src){var s=document.createElement('script');s.type='module';s.crossOrigin='';s.src=src;document.head.appendChild(s)}function warm(){deps.concat(entry).forEach(link)}if(location.pathname==='/'){home.forEach(link);load(landing);['pointerover','touchstart','focusin'].forEach(function(t){addEventListener(t,warm,{once:true,passive:true})})}else{var c=document.querySelector('link[rel=canonical]');if(c)c.remove();document.getElementById('root').textContent='';warm();load(entry)}})()</script>`;
html = html.replace('</body>', `${loader}</body>`);

await writeFile(dist + 'index.html', html);
console.log(`prerendered / (${(Buffer.byteLength(html) / 1024).toFixed(1)} KB)`);
