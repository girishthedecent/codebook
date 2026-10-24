import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

// Fifteen lines with a blank one inside: the chunker must keep the block in one piece.
export const CODE_LINES = Array.from({ length: 15 }, (_, i) =>
  i === 7 ? '' : `const value${i + 1} = ${i + 1};`,
);
export const CODE_BLOCK = CODE_LINES.join('\n');

const filler =
  'This paragraph is here so the page has enough text to count as an article. ' +
  'It talks about the fixture site, its pages and how they link to each other.';

const html = (title: string, body: string) =>
  `<!doctype html><html><head><title>${title}</title></head><body>` +
  `<nav><a href="/">Home</a></nav><main>${body}</main><footer>Footer text</footer></body></html>`;

const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;');

type Page = { type: string; body: string };

const page = (title: string, body: string): Page => ({
  type: 'text/html; charset=utf-8',
  body: html(title, body),
});
const pages: Record<string, Page> = {
  '/robots.txt': { type: 'text/plain', body: 'User-agent: *\nDisallow: /private\n' },
  '/': page(
    'Fixture Docs',
    `<h1>Fixture Docs</h1><p>${filler}</p>
       <ul>
         <li><a href="/guide">Guide</a></li>
         <li><a href="/private/secret">Secret</a></li>
         <li><a href="/about#team">About the team</a></li>
         <li><a href="/guide?utm_source=x">Guide again</a></li>
         <li><a href="http://example.invalid/elsewhere">Elsewhere</a></li>
         <li><a href="/file.pdf">A PDF</a></li>
       </ul>`,
  ),
  '/guide': page(
    'Guide',
    `<h1>Guide</h1><p>${filler}</p>
       <h2>Installing</h2><p>Install the package with your package manager. ${filler}</p>
       <h3>Configuring</h3><p>Then configure it. ${filler}</p>
       <pre><code class="language-ts">${escape(CODE_BLOCK)}</code></pre>
       <p>Read the <a href="/deep">deep dive</a> next.</p>`,
  ),
  '/about': page('About', `<h1>About</h1><p>${filler} The team is small.</p>`),
  '/deep': page('Deep', `<h1>Deep</h1><p>${filler} This page is two links away.</p>`),
  '/private/secret': page('Secret', `<h1>Secret</h1><p>${filler}</p>`),
  '/data.bin': { type: 'application/octet-stream', body: 'not a web page' },
};

let server: Server | undefined;
const hits = new Map<string, number>();

/** A tiny docs site on 127.0.0.1. Requests are counted per path (query left out). */
export const site = {
  async start() {
    const started = createServer((req, res) => {
      const path = new URL(req.url ?? '/', 'http://localhost').pathname;
      hits.set(path, (hits.get(path) ?? 0) + 1);
      if (path === '/redirect') {
        res.writeHead(302, { Location: '/guide' }).end();
        return;
      }
      const found = pages[path];
      if (!found) {
        res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': found.type }).end(found.body);
    });
    await new Promise<void>((resolve) => started.listen(0, '127.0.0.1', resolve));
    server = started;
    return `http://127.0.0.1:${(started.address() as AddressInfo).port}`;
  },
  async stop() {
    const closing = server;
    server = undefined;
    if (!closing) return;
    await new Promise<void>((resolve, reject) =>
      closing.close((error) => (error ? reject(error) : resolve())),
    );
  },
  reset() {
    hits.clear();
  },
  requests: (path: string) => hits.get(path) ?? 0,
};
