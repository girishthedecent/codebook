import { useEffect, useState } from 'react';
import type { HighlightRequest, HighlightResponse, Token } from '@/workers/shiki.worker';

export type { Token };

let worker: Worker | undefined;
let nextId = 1;
const pending = new Map<number, (lines: Token[][] | undefined) => void>();

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('../../workers/shiki.worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = (event: MessageEvent<HighlightResponse>) => {
      const done = pending.get(event.data.id);
      pending.delete(event.data.id);
      done?.('lines' in event.data ? event.data.lines : undefined);
    };
  }
  return worker;
}

function requestHighlight(code: string, lang: string) {
  return new Promise<Token[][] | undefined>((resolve) => {
    const id = nextId++;
    pending.set(id, resolve);
    getWorker().postMessage({ id, code, lang } satisfies HighlightRequest);
  });
}

const byExtension: Record<string, string> = {
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'jsx',
  json: 'json',
  py: 'python',
  go: 'go',
  rs: 'rust',
  java: 'java',
  sh: 'shellscript',
  bash: 'shellscript',
  zsh: 'shellscript',
  yml: 'yaml',
  yaml: 'yaml',
  md: 'markdown',
  markdown: 'markdown',
  css: 'css',
  html: 'html',
  htm: 'html',
  sql: 'sql',
  c: 'c',
  h: 'c',
  cc: 'cpp',
  cpp: 'cpp',
  hpp: 'cpp',
  rb: 'ruby',
  toml: 'toml',
};

/** The backend's language name when it has one we know, else the file extension. */
export function languageFor(path: string, language: string | null | undefined) {
  const named = language?.toLowerCase();
  if (named && Object.values(byExtension).includes(named)) return named;
  if (named === 'bash' || named === 'shell') return 'shellscript';
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return byExtension[ext] ?? 'text';
}

/** Highlighted lines for `code`, or undefined until the worker answers (render plain text). */
export function useHighlight(code: string | undefined, lang: string) {
  const [result, setResult] = useState<{ code: string; lines: Token[][] }>();
  useEffect(() => {
    if (code === undefined || lang === 'text') return;
    let current = true;
    void requestHighlight(code, lang).then((lines) => {
      if (current && lines) setResult({ code, lines });
    });
    return () => {
      current = false;
    };
  }, [code, lang]);
  return result && result.code === code ? result.lines : undefined;
}
