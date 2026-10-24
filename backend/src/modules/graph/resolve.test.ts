import { describe, expect, it } from 'vitest';
import type { CodeLanguage } from '../ingestion/code/treeSitter.js';
import { extractFile } from './extract/fileFacts.js';
import { resolveGraph, resolvePythonModule, resolveScriptModule } from './resolve.js';

async function graphOf(files: Record<string, string>, language: CodeLanguage) {
  const facts = [];
  for (const [path, text] of Object.entries(files)) {
    const extracted = await extractFile(text, language, path, text.split('\n').length);
    facts.push({ ...extracted!, documentId: path, chunks: [] });
  }
  const { graph, stats } = resolveGraph(facts);
  const names = new Map(graph.symbols.map((symbol) => [symbol.id, symbol.qualifiedName]));
  const edges = graph.edges
    .filter((edge) => edge.type !== 'DEFINES')
    .map(
      (edge) =>
        `${edge.type} ${names.get(edge.fromSymbolId)} -> ${edge.toSymbolId ? names.get(edge.toSymbolId) : `?${edge.toName}`}`,
    );
  return { graph, stats, edges };
}

describe('resolveScriptModule', () => {
  const paths = new Set(['src/a.ts', 'src/lib/index.ts', 'src/util.js', 'src/view.tsx']);

  it('tries extensions, index files and .js → .ts', () => {
    expect(resolveScriptModule('src/b.ts', './a', paths)).toBe('src/a.ts');
    expect(resolveScriptModule('src/b.ts', './a.js', paths)).toBe('src/a.ts');
    expect(resolveScriptModule('src/b.ts', './lib', paths)).toBe('src/lib/index.ts');
    expect(resolveScriptModule('src/x/b.ts', '../util', paths)).toBe('src/util.js');
    expect(resolveScriptModule('src/b.ts', './view.js', paths)).toBe('src/view.tsx');
  });

  it('leaves packages and paths outside the repository unresolved', () => {
    expect(resolveScriptModule('src/b.ts', 'express', paths)).toBeNull();
    expect(resolveScriptModule('src/b.ts', '../../a', paths)).toBeNull();
    expect(resolveScriptModule('src/b.ts', './missing', paths)).toBeNull();
  });
});

describe('resolvePythonModule', () => {
  const paths = new Set([
    'app/__init__.py',
    'app/models.py',
    'app/api/views.py',
    'src/pkg/core.py',
    'app/logging.py',
  ]);

  it('resolves relative imports from the package', () => {
    expect(resolvePythonModule('app/api/views.py', '..models', paths)).toBe('app/models.py');
    expect(resolvePythonModule('app/models.py', '.', paths)).toBe('app/__init__.py');
  });

  it('resolves absolute imports from the root, src/ and only then nearby folders', () => {
    expect(resolvePythonModule('app/api/views.py', 'app.models', paths)).toBe('app/models.py');
    expect(resolvePythonModule('tools/run.py', 'pkg.core', paths)).toBe('src/pkg/core.py');
    expect(resolvePythonModule('app/api/views.py', 'os', paths)).toBeNull();
  });
});

describe('resolveGraph', () => {
  it('follows Python imports, self calls and __init__ field types', async () => {
    const { edges } = await graphOf(
      {
        'app/models.py': `class Repo:
    def find(self, key):
        return key
`,
        'app/service.py': `from .models import Repo
import json

class Service:
    def __init__(self, repo: Repo):
        self.repo = repo

    def run(self, key):
        self.check(key)
        found = self.repo.find(key)
        return json.dumps(found)

    def check(self, key):
        return key
`,
        'app/main.py': `from app.service import Service
from app import models

service = Service(models.Repo())

def main():
    service.run(1)
`,
      },
      'python',
    );
    expect(edges).toEqual(
      expect.arrayContaining([
        'IMPORTS app/service.py -> app/models.py',
        'IMPORTS app/service.py -> ?json',
        'IMPORTS app/main.py -> app/models.py',
        'CALLS app/service.py#Service.run -> app/service.py#Service.check',
        'CALLS app/service.py#Service.run -> app/models.py#Repo.find',
        'CALLS app/service.py#Service.run -> ?json.dumps',
        'CALLS app/main.py -> app/service.py#Service',
        'CALLS app/main.py -> app/models.py#Repo',
        'CALLS app/main.py#main -> app/service.py#Service.run',
      ]),
    );
  });

  it('handles CommonJS: require bindings, module.exports and assigned methods', async () => {
    const { graph, edges } = await graphOf(
      {
        'lib/response.js': `var res = Object.create(null);

res.send = function send(body) {
  this.set('Content-Type', 'text/html');
  return this.end(body);
};

res.json = function json(obj) {
  return this.send(JSON.stringify(obj));
};

module.exports = res;
`,
        'lib/express.js': `var res = require('./response');
var { helper } = require('./utils');

function createApplication() {
  helper();
  return res.json({});
}

module.exports = createApplication;
`,
        'lib/utils.js': `exports.helper = function helper() {
  return 1;
};
`,
        'index.js': `module.exports = require('./lib/express');
`,
      },
      'javascript',
    );
    expect(edges).toEqual(
      expect.arrayContaining([
        'IMPORTS lib/express.js -> lib/response.js',
        'IMPORTS index.js -> lib/express.js',
        'CALLS lib/response.js#res.json -> lib/response.js#res.send',
        'CALLS lib/express.js#createApplication -> lib/utils.js#helper',
        'CALLS lib/express.js#createApplication -> lib/response.js#res.json',
      ]),
    );
    // `this.set` / `this.end` have no definition here, and `set` is too common to guess.
    expect(edges).toContain('CALLS lib/response.js#res.send -> ?this.set');
    const send = graph.symbols.find(
      (symbol) => symbol.qualifiedName === 'lib/response.js#res.send',
    );
    expect(send).toMatchObject({ name: 'send', kind: 'FUNCTION', lineStart: 3, lineEnd: 6 });
  });

  it('keeps the first of repeated names and never repeats a qualified name', async () => {
    const { graph } = await graphOf(
      {
        'src/a.ts': `export class A {
  get value() { return 1; }
  set value(v: number) { this.save(v); }
  save(v: number) { return v; }
}
export function f(a: string): string;
export function f(a: unknown) { return a; }
`,
        'src/a.ts#A': 'export function g() {}\n',
      },
      'typescript',
    );
    const names = graph.symbols.map((symbol) => symbol.qualifiedName);
    expect(new Set(names).size).toBe(names.length);
    expect(names.filter((name) => name === 'src/a.ts#A.value')).toHaveLength(1);
    // The setter's call counts for the kept symbol.
    const value = graph.symbols.find((symbol) => symbol.qualifiedName === 'src/a.ts#A.value')!;
    expect(
      graph.edges.some((edge) => edge.fromSymbolId === value.id && edge.toName === 'this.save'),
    ).toBe(true);
  });

  it('only guesses a method by name when exactly one exists and it is not a common name', async () => {
    const { edges, stats } = await graphOf(
      {
        'src/a.ts': `export class Mailer {
  deliver(to: string) { return to; }
  get(key: string) { return key; }
}
`,
        'src/b.ts': `export function run(m: any, list: string[]) {
  m.deliver('x');
  m.get('y');
  list.map(String);
}
`,
      },
      'typescript',
    );
    expect(edges).toContain('CALLS src/b.ts#run -> src/a.ts#Mailer.deliver');
    expect(edges).toContain('CALLS src/b.ts#run -> ?m.get');
    expect(edges).toContain('CALLS src/b.ts#run -> ?list.map');
    expect(stats.callsResolvedByName).toBe(1);
  });

  it('never makes a class its own base, and survives a property named constructor', async () => {
    const { edges } = await graphOf(
      {
        'app/http.py': `import requests

class Session(requests.Session):
    def get_json(self, url):
        return self.get(url).json()
`,
      },
      'python',
    );
    expect(edges).toContain('EXTENDS app/http.py#Session -> ?requests.Session');

    const ts = await graphOf(
      {
        'types/legacy.d.ts':
          'interface FooStatic {\n  constructor: Function;\n  create(): void;\n}\n',
      },
      'typescript',
    );
    expect(ts.graph.symbols.map((symbol) => symbol.qualifiedName)).toContain(
      'types/legacy.d.ts#FooStatic.create',
    );
  });
});
