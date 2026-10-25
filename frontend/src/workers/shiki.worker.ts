/// <reference lib="webworker" />
import { createHighlighterCore, type HighlighterCore, type LanguageInput } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';

/**
 * Syntax highlighting off the main thread. Grammars load on first use, so a TypeScript
 * file never pays for Python. The reply is per line: [text, lightColor, darkColor, style].
 */

export type HighlightRequest = { id: number; code: string; lang: string };
export type Token = [text: string, light: string, dark: string, fontStyle: number];
export type HighlightResponse = { id: number; lines: Token[][] } | { id: number; error: string };

const grammars: Record<string, () => LanguageInput> = {
  typescript: () => import('shiki/langs/typescript.mjs'),
  tsx: () => import('shiki/langs/tsx.mjs'),
  javascript: () => import('shiki/langs/javascript.mjs'),
  jsx: () => import('shiki/langs/jsx.mjs'),
  json: () => import('shiki/langs/json.mjs'),
  python: () => import('shiki/langs/python.mjs'),
  go: () => import('shiki/langs/go.mjs'),
  rust: () => import('shiki/langs/rust.mjs'),
  java: () => import('shiki/langs/java.mjs'),
  shellscript: () => import('shiki/langs/shellscript.mjs'),
  yaml: () => import('shiki/langs/yaml.mjs'),
  markdown: () => import('shiki/langs/markdown.mjs'),
  css: () => import('shiki/langs/css.mjs'),
  html: () => import('shiki/langs/html.mjs'),
  sql: () => import('shiki/langs/sql.mjs'),
  c: () => import('shiki/langs/c.mjs'),
  cpp: () => import('shiki/langs/cpp.mjs'),
  ruby: () => import('shiki/langs/ruby.mjs'),
  toml: () => import('shiki/langs/toml.mjs'),
};

let highlighter: Promise<HighlighterCore> | undefined;
const loaded = new Set<string>();

function getHighlighter() {
  highlighter ??= createHighlighterCore({
    themes: [
      import('shiki/themes/github-light.mjs'),
      import('shiki/themes/github-dark-dimmed.mjs'),
    ],
    langs: [],
    engine: createJavaScriptRegexEngine(),
  });
  return highlighter;
}

async function highlight({ code, lang }: HighlightRequest): Promise<Token[][]> {
  const h = await getHighlighter();
  if (!grammars[lang]) return code.split('\n').map((line) => [[line, '', '', 0]]);
  if (!loaded.has(lang)) {
    await h.loadLanguage(grammars[lang]());
    loaded.add(lang);
  }
  return h
    .codeToTokensWithThemes(code, {
      lang,
      themes: { light: 'github-light', dark: 'github-dark-dimmed' },
    })
    .map((line) =>
      line.map((t) => [
        t.content,
        t.variants.light?.color ?? '',
        t.variants.dark?.color ?? '',
        t.variants.light?.fontStyle ?? 0,
      ]),
    );
}

self.onmessage = async (event: MessageEvent<HighlightRequest>) => {
  const { id } = event.data;
  try {
    self.postMessage({ id, lines: await highlight(event.data) } satisfies HighlightResponse);
  } catch (error) {
    self.postMessage({ id, error: String(error) } satisfies HighlightResponse);
  }
};
