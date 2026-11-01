// Draws the social preview (public/og.png, 1200×630) and the home-screen icon
// (public/apple-touch-icon.png, 180×180) from HTML templates, with a headless Chromium
// screenshot. The text is the landing page's own, the page and the code are the captured demo
// fixtures, and the icon is the favicon drawn large, so run it again when any of those change.
//
//   node --import tsx scripts/og.ts [--chrome PATH]
//
// Any Chromium will do. Without --chrome (or CHROME) it uses the newest one Playwright has
// downloaded under ~/.cache/ms-playwright.
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import type { BookFixture, CodeFixture } from '../src/features/landing/fixtureTypes';
import { landing } from '../src/features/landing/strings';

const root = fileURLToPath(new URL('../', import.meta.url));
const at = (path: string) => join(root, path);
const fileUrl = (path: string) => pathToFileURL(at(path)).href;

// Light theme values from src/styles/tokens.css.
const C = {
  paper: '#f6f3ec',
  paper2: '#efebe1',
  ink: '#1f1c18',
  ink2: '#4d4842',
  ink3: '#666057',
  rule: 'rgb(31 28 24 / 0.1)',
  accent: '#2e5d4b',
  kw: '#7a4466',
  fn: '#3a5f8a',
  num: '#8a5a12',
  str: '#3b6e3b',
};

// Playwright's headless shell first: the full browser's --screenshot mode can hang without a
// display session, the shell's never does.
const BUILDS = [
  [/^chromium_headless_shell-(\d+)$/, 'chrome-headless-shell-linux64/chrome-headless-shell'],
  [/^chromium-(\d+)$/, 'chrome-linux64/chrome'],
] as const;

async function findChrome() {
  const flag = process.argv.indexOf('--chrome');
  const given = flag > 0 ? process.argv[flag + 1] : process.env.CHROME;
  if (given) return given;
  const cache = join(homedir(), '.cache/ms-playwright');
  const names = await readdir(cache).catch(() => [] as string[]);
  for (const [pattern, binary] of BUILDS) {
    const builds = names
      .map((name) => pattern.exec(name))
      .filter((m) => m !== null)
      .sort((a, b) => Number(b[1]) - Number(a[1]));
    for (const build of builds) {
      const path = join(cache, build[0], binary);
      if (await stat(path).catch(() => null)) return path;
    }
  }
  throw new Error('No Chromium found. Pass --chrome PATH or set CHROME.');
}

const fontFiles = {
  serif:
    'node_modules/@fontsource-variable/source-serif-4/files/source-serif-4-latin-opsz-normal.woff2',
  serifItalic:
    'node_modules/@fontsource-variable/source-serif-4/files/source-serif-4-latin-opsz-italic.woff2',
  sans: 'node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-400-normal.woff2',
  mono: 'node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2',
};

// Chromium takes the screenshot at the load event. Preloaded fonts hold that event back, so the
// text is drawn in its own faces and not the fallbacks.
const preloads = Object.values(fontFiles)
  .map((f) => `<link rel="preload" as="font" type="font/woff2" crossorigin href="${fileUrl(f)}">`)
  .join('');

const fonts = `
  @font-face { font-family: OgSerif; font-weight: 200 900; src: url(${fileUrl(fontFiles.serif)}) format('woff2-variations'); }
  @font-face { font-family: OgSerif; font-style: italic; font-weight: 200 900; src: url(${fileUrl(fontFiles.serifItalic)}) format('woff2-variations'); }
  @font-face { font-family: OgSans; font-weight: 400; src: url(${fileUrl(fontFiles.sans)}); }
  @font-face { font-family: OgMono; font-weight: 400; src: url(${fileUrl(fontFiles.mono)}); }
`;

const escape = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function codeLines(code: CodeFixture, count: number) {
  const slice = code.slices[0]!;
  // Starts where the hero's listing starts: at `forward`, the method the demo question is about.
  const from = Math.max(
    0,
    slice.lines.findIndex((line) => line.some(([text]) => text === 'forward')),
  );
  const tone: Record<string, string> = {
    kw: C.kw,
    fn: C.fn,
    num: C.num,
    str: C.str,
    cm: `${C.ink3}; font-style: italic`,
  };
  return {
    path: slice.path,
    first: slice.lineStart + from,
    last: slice.lineStart + from + count - 1,
    html: slice.lines
      .slice(from, from + count)
      .map((tokens, i) => {
        const body = tokens
          .map(([text, kind]) =>
            tone[kind] ? `<span style="color: ${tone[kind]}">${escape(text)}</span>` : escape(text),
          )
          .join('');
        return `<div class="line"><span class="n">${slice.lineStart + from + i}</span>${body}</div>`;
      })
      .join(''),
  };
}

function ogPage(book: BookFixture, code: CodeFixture) {
  const page = book.pages[0]!;
  const listing = codeLines(code, 9);
  return `<!doctype html><html><head><meta charset="utf-8">${preloads}<style>
    ${fonts}
    * { box-sizing: border-box; }
    html, body { margin: 0; }
    body {
      width: 1200px; height: 630px; overflow: hidden; position: relative;
      background: ${C.paper}; color: ${C.ink}; font-family: OgSans, sans-serif;
      -webkit-font-smoothing: antialiased;
    }
    .copy { position: absolute; left: 72px; top: 60px; width: 590px; }
    .mark { font-family: OgSerif; font-size: 32px; font-weight: 600; letter-spacing: -0.01em; }
    .mark i { color: ${C.accent}; font-weight: 400; }
    h1 {
      margin: 64px 0 0; font-family: OgSerif; font-size: 60px; line-height: 1.07;
      font-weight: 600; letter-spacing: -0.022em; text-wrap: balance;
    }
    p.lede {
      margin: 26px 0 0; font-family: OgSerif; font-size: 23px; line-height: 1.45;
      color: ${C.ink2}; text-wrap: pretty;
    }
    .site { position: absolute; left: 72px; bottom: 52px; font-size: 19px; color: ${C.ink3}; }
    .page {
      position: absolute; left: 742px; top: 56px; width: 300px; height: 300px; overflow: hidden;
      border: 1px solid ${C.rule}; border-radius: 6px; background: #fff;
      box-shadow: 0 10px 30px -10px rgb(28 26 23 / 0.28), 0 0 0 1px rgb(28 26 23 / 0.05);
    }
    .page img { display: block; width: 100%; }
    .code {
      position: absolute; left: 812px; top: 250px; width: 420px; padding: 16px 0;
      border: 1px solid ${C.rule}; border-radius: 6px; background: ${C.paper2};
      box-shadow: 0 10px 30px -10px rgb(28 26 23 / 0.28), 0 0 0 1px rgb(28 26 23 / 0.05);
      font-family: OgMono; font-size: 15px; line-height: 1.62; white-space: pre;
      -webkit-mask-image: linear-gradient(to right, #000 78%, transparent);
    }
    .line .n { display: inline-block; width: 44px; padding-right: 14px; text-align: right; color: ${C.ink3}; }
    .caption {
      position: absolute; left: 742px; bottom: 52px; width: 400px;
      font-size: 16px; line-height: 1.4; color: ${C.ink3};
    }
  </style></head><body>
    <div class="copy">
      <div class="mark">Code<i>Book</i></div>
      <h1>${escape(landing.hero.title)}</h1>
      <p class="lede">${escape(landing.hero.lede)}</p>
    </div>
    <div class="site">codebook.girishthedecent.space</div>
    <div class="page"><img src="${fileUrl('public' + page.image)}" alt=""></div>
    <div class="code">${listing.html}</div>
    <div class="caption">${escape(`Page ${page.page} of the book, lines ${listing.first}–${listing.last} of ${listing.path}`)}</div>
  </body></html>`;
}

/** The favicon's glyph, cropped closer so it fills the tile the way home-screen icons do. */
function iconPage(favicon: string) {
  const glyph = favicon.replace(
    'viewBox="0 0 32 32"',
    'viewBox="2 2 28 28" width="180" height="180"',
  );
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html, body { margin: 0; background: ${C.paper}; }
    svg { display: block; }
  </style></head><body>${glyph}</body></html>`;
}

const run = promisify(execFile);

async function shoot(chrome: string, html: string, out: string, width: number, height: number) {
  const dir = await mkdtemp(join(tmpdir(), 'codebook-og-'));
  try {
    const page = join(dir, 'page.html');
    await writeFile(page, html);
    await run(
      chrome,
      [
        '--headless',
        // As Playwright launches it: the page is our own template, and many Linux setups refuse
        // the sandbox to unprivileged users.
        '--no-sandbox',
        '--disable-gpu',
        '--hide-scrollbars',
        '--no-first-run',
        '--allow-file-access-from-files',
        `--user-data-dir=${join(dir, 'profile')}`,
        '--force-device-scale-factor=1',
        `--window-size=${width},${height}`,
        `--screenshot=${out}`,
        pathToFileURL(page).href,
      ],
      { timeout: 60_000 },
    );
    console.log(
      `wrote ${out.slice(root.length)} (${((await stat(out)).size / 1024).toFixed(0)} KB)`,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const chrome = await findChrome();
const readJson = async <T>(path: string) => JSON.parse(await readFile(at(path), 'utf8')) as T;
const book = await readJson<BookFixture>('src/features/landing/fixtures/book.json');
const code = await readJson<CodeFixture>('src/features/landing/fixtures/code.json');
if (!book.pages[0] || !code.slices[0]) throw new Error('The book and code fixtures are empty');

await shoot(chrome, ogPage(book, code), at('public/og.png'), 1200, 630);
await shoot(
  chrome,
  iconPage(await readFile(at('public/favicon.svg'), 'utf8')),
  at('public/apple-touch-icon.png'),
  180,
  180,
);
