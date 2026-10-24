import { parseHTML } from 'linkedom';
import { describe, expect, it } from 'vitest';
import { extractHtml, extractText } from './extract.js';
import { htmlToText } from './htmlText.js';

const textOf = (html: string) =>
  htmlToText(parseHTML(`<!doctype html><html><body>${html}</body></html>`).document.body);

describe('htmlToText', () => {
  it('turns h1 to h4 into # headings', () => {
    expect(textOf('<h1>One</h1><h2>Two</h2><h3>Three</h3><h4>Four</h4><p>Body</p>')).toBe(
      '# One\n\n## Two\n\n### Three\n\n#### Four\n\nBody',
    );
  });

  it('keeps h5 as a plain paragraph', () => {
    expect(textOf('<h5>Small</h5>')).toBe('Small');
  });

  it('turns lists into - items and numbers ordered ones', () => {
    expect(textOf('<ul><li>a</li><li>b</li></ul>')).toBe('- a\n- b');
    expect(textOf('<ol><li>first</li><li>second</li></ol>')).toBe('1. first\n2. second');
  });

  it('keeps code verbatim in a fenced block with its language', () => {
    const code = 'const a = 1;\n\n  const b = 2;';
    expect(textOf(`<pre><code class="language-ts">${code}</code></pre>`)).toBe(
      `\`\`\`ts\n${code}\n\`\`\``,
    );
  });

  it('uses a longer fence than any backtick run in the code', () => {
    const text = textOf('<pre>```\ninner\n~~~\n```</pre>');
    expect(text).toBe('````\n```\ninner\n~~~\n```\n````');
  });

  it('turns tables into a | b rows', () => {
    expect(
      textOf('<table><tr><th>a</th><th>b</th></tr><tr><td>1</td><td>2</td></tr></table>'),
    ).toBe('a | b\n1 | 2');
  });

  it('keeps link text and drops the URL', () => {
    expect(textOf('<p>See <a href="https://example.com/x">the docs</a> now.</p>')).toBe(
      'See the docs now.',
    );
  });

  it('drops script and style content', () => {
    expect(textOf('<p>keep</p><script>var x = 1;</script><style>p { color: red }</style>')).toBe(
      'keep',
    );
  });
});

describe('extractHtml', () => {
  const article = `<!doctype html><html><head><title>Guide to Hashing</title></head><body>
    <nav><ul><li><a href="/home">Home</a></li><li><a href="/pricing">Pricing</a></li></ul></nav>
    <article>
      <h1>Guide to Hashing</h1>
      <p>${'Hashing maps keys to buckets so that lookups stay fast even for large tables. '.repeat(8)}</p>
      <h2>Collisions</h2>
      <p>${'Collisions are resolved by chaining or by probing for another free slot. '.repeat(8)}</p>
      <pre><code class="language-js">const h = hash(key);</code></pre>
    </article>
  </body></html>`;

  it('returns the title and main content without navigation', () => {
    const page = extractHtml(article, 'https://example.com/guide');
    expect(page.title).toBe('Guide to Hashing');
    expect(page.text).toContain('## Collisions');
    expect(page.text).toContain('```js\nconst h = hash(key);\n```');
    expect(page.text).not.toContain('Pricing');
  });

  it('collects links as absolute URLs, including those in dropped navigation', () => {
    const page = extractHtml(article, 'https://example.com/guide');
    expect(page.links).toEqual(['https://example.com/home', 'https://example.com/pricing']);
  });

  it('resolves links against a base tag', () => {
    const html = `<html><head><base href="https://cdn.example.com/docs/"></head>
      <body><a href="page.html">p</a></body></html>`;
    expect(extractHtml(html, 'https://example.com/').links).toEqual([
      'https://cdn.example.com/docs/page.html',
    ]);
  });

  it('falls back to the body without chrome when the page is too deep for Readability', () => {
    const depth = 200;
    const html = `<html><head><title>Deep</title></head><body><nav>Menu</nav>${'<div>'.repeat(depth)}<h2>Deep heading</h2><p>Deep text</p>${'</div>'.repeat(depth)}</body></html>`;
    const started = performance.now();
    const page = extractHtml(html, 'https://example.com/');
    expect(performance.now() - started).toBeLessThan(2_000);
    expect(page.title).toBe('Deep');
    expect(page.text).toContain('## Deep heading');
    expect(page.text).toContain('Deep text');
    expect(page.text).not.toContain('Menu');
  });

  it('returns plain text quickly for a page nested past the parse limit', () => {
    const depth = 20_000;
    const html = `<body>${'<div>'.repeat(depth)}<p>Very deep text</p>${'</div>'.repeat(depth)}</body>`;
    const started = performance.now();
    const page = extractHtml(html, 'https://example.com/');
    expect(performance.now() - started).toBeLessThan(2_000);
    expect(page.text).toContain('Very deep text');
    expect(page.links).toEqual([]);
  });
});

describe('extractText', () => {
  it('returns the text as is', () => {
    expect(extractText('# Notes\n\nplain')).toEqual({
      title: null,
      text: '# Notes\n\nplain',
      links: [],
    });
  });
});
