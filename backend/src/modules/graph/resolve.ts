import { randomUUID } from 'node:crypto';
import { posix } from 'node:path';
import type { DraftEdge, DraftGraph, DraftSymbol } from '../ingestion/ingestion.types.js';
import type { Binding, FileFacts, ImportFact } from './extract/fileFacts.js';

// Turns each file's facts into one graph: symbols with ids, and edges whose targets are found
// where the code allows it. Calls are matched by heuristics, in order:
//   1. a symbol of that name in the same file
//   2. an imported name → the symbol the imported file exports
//   3. this.m() / self.m() → a method of the enclosing class (or object), then of its bases
//   4. this.x.m() → a method of x's class, when the class declares x's type; likewise x.m()
//      for a module-level `const x = new X()`
//   5. a member call whose method name exists exactly once in the repository (methods and
//      functions assigned onto objects only: `pool.query()` isn't the file's own `query()`)
// Anything else stays unresolved, keeping the callee as written.

export type GraphFile = FileFacts & {
  documentId: string;
  chunks: {
    id: string;
    lineStart: number | null;
    lineEnd: number | null;
    symbolName: string | null;
  }[];
};

export type GraphStats = {
  symbols: number;
  edges: number;
  edgesResolved: number;
  calls: number;
  callsResolved: number;
  // Of callsResolved, the ones found by heuristic 5 only (a guess, if a good one).
  callsResolvedByName: number;
  imports: number;
  importsResolved: number;
};

// Method names every runtime has: a unique match on these would almost always be wrong.
const COMMON_METHODS = new Set(
  (
    'map filter reduce forEach push pop shift unshift slice splice concat join split replace ' +
    'trim includes indexOf find findIndex some every sort reverse keys values entries get set ' +
    'has delete add clear then catch finally toString valueOf call apply bind emit on once off ' +
    'append extend items update format startswith endswith strip lower upper encode decode ' +
    'read write close open log error warn info debug parse stringify test exec match next ' +
    'resolve reject end pipe copy remove insert'
  ).split(' '),
);
const SCRIPT_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];
const MAX_KEY_BYTES = 1_000;

type FileIndex = {
  file: GraphFile;
  fileSymbolId: string;
  // By position in file.symbols; a repeated name shares the first one's id.
  ids: (string | null)[];
  byLocal: Map<string, string>;
  // Resolved imports with their target file's path.
  imports: (ImportFact & { target: string | null })[];
};

export function resolveGraph(files: GraphFile[]): { graph: DraftGraph; stats: GraphStats } {
  const symbols: DraftSymbol[] = [];
  const edges: DraftEdge[] = [];
  const byId = new Map<string, DraftSymbol>();
  const qualifiedNames = new Set<string>();
  const indexes = new Map<string, FileIndex>();

  const addSymbol = (symbol: Omit<DraftSymbol, 'id'>) => {
    // A path may contain `#`, so a file and a symbol could still collide.
    if (qualifiedNames.has(symbol.qualifiedName)) return null;
    if (Buffer.byteLength(symbol.qualifiedName) > MAX_KEY_BYTES) return null;
    qualifiedNames.add(symbol.qualifiedName);
    const full = { ...symbol, id: randomUUID() };
    symbols.push(full);
    byId.set(full.id, full);
    return full.id;
  };

  // FILE symbols first, so a file always gets its own path.
  for (const file of files) {
    const fileSymbolId = addSymbol({
      documentId: file.documentId,
      name: posix.basename(file.path),
      qualifiedName: file.path,
      kind: 'FILE',
      filePath: file.path,
      lineStart: 1,
      lineEnd: Math.max(file.lineCount, 1),
      signature: null,
      exported: false,
      chunkId: null,
    });
    if (fileSymbolId) {
      indexes.set(file.path, { file, fileSymbolId, ids: [], byLocal: new Map(), imports: [] });
    }
  }

  const membersByName = new Map<string, string[]>();
  const classesByName = new Map<string, string[]>();
  for (const index of indexes.values()) {
    const { file } = index;
    for (const symbol of file.symbols) {
      const existing = index.byLocal.get(symbol.localName);
      if (existing) {
        index.ids.push(existing);
        continue;
      }
      const id = addSymbol({
        documentId: file.documentId,
        name: symbol.name,
        qualifiedName: `${file.path}#${symbol.localName}`,
        kind: symbol.kind,
        filePath: file.path,
        lineStart: symbol.lineStart,
        lineEnd: symbol.lineEnd,
        signature: symbol.signature,
        exported: symbol.exported,
        chunkId: chunkFor(file, symbol.localName, symbol.lineStart),
      });
      index.ids.push(id);
      if (!id) continue;
      index.byLocal.set(symbol.localName, id);
      const isClass = symbol.kind === 'CLASS' || symbol.kind === 'INTERFACE';
      const byName = isClass ? classesByName : symbol.container ? membersByName : null;
      if (byName && !byName.has(symbol.name)) byName.set(symbol.name, []);
      byName?.get(symbol.name)!.push(id);
    }
  }

  const scriptPaths = new Set<string>();
  const pythonPaths = new Set<string>();
  for (const path of indexes.keys()) {
    (indexes.get(path)!.file.language === 'python' ? pythonPaths : scriptPaths).add(path);
  }
  const resolveModule = (from: GraphFile, specifier: string) =>
    from.language === 'python'
      ? resolvePythonModule(from.path, specifier, pythonPaths)
      : resolveScriptModule(from.path, specifier, scriptPaths);

  // IMPORTS, once per file and specifier. `from pkg import mod` imports pkg/mod.py when it
  // exists, and `mod` is then that module.
  let imports = 0;
  let importsResolved = 0;
  for (const index of indexes.values()) {
    const seen = new Set<string>();
    const importEdge = (specifier: string, target: string | null, line: number) => {
      if (seen.has(specifier)) return;
      seen.add(specifier);
      imports++;
      const toSymbolId = target ? indexes.get(target)!.fileSymbolId : null;
      if (toSymbolId) importsResolved++;
      edges.push(edge(index, index.fileSymbolId, toSymbolId, specifier, 'IMPORTS', line));
    };
    for (const fact of index.file.imports) {
      const target = resolveModule(index.file, fact.specifier);
      index.imports.push({ ...fact, target });
      importEdge(fact.specifier, target, fact.line);
      if (index.file.language !== 'python') continue;
      for (const binding of fact.bindings) {
        if (binding.kind !== 'named') continue;
        const sub = submodule(fact.specifier, binding.imported);
        const subTarget = resolveModule(index.file, sub);
        if (!subTarget) continue;
        index.imports.push({
          specifier: sub,
          line: fact.line,
          bindings: [{ kind: 'namespace', local: binding.local }],
          reexports: null,
          target: subTarget,
        });
        importEdge(sub, subTarget, fact.line);
      }
    }
  }

  // DEFINES: file → its top-level symbols, class → its methods.
  for (const index of indexes.values()) {
    index.file.symbols.forEach((symbol, i) => {
      const id = index.ids[i];
      if (!id || byId.get(id)!.lineStart !== symbol.lineStart) return; // a repeat
      const owner = symbol.container ? index.byLocal.get(symbol.container) : undefined;
      const from = symbol.kind === 'METHOD' && owner ? owner : index.fileSymbolId;
      edges.push(edge(index, from, id, byId.get(id)!.qualifiedName, 'DEFINES', symbol.lineStart));
    });
  }

  // ---- lookups ------------------------------------------------------------------------

  const bindingTarget = (index: FileIndex, local: string) => {
    for (const fact of index.imports) {
      if (!fact.target) continue;
      const binding = fact.bindings.find(
        (candidate): candidate is Exclude<Binding, { kind: 'wildcard' }> =>
          candidate.kind !== 'wildcard' && candidate.local === local,
      );
      if (binding) return { binding, target: fact.target };
    }
    return null;
  };

  // What `name` means when imported from the file at `path`: its own top-level symbol, or one
  // it passes on (`export … from`, a Python module importing it), up to `hops` files away.
  // Barrels of barrels would otherwise be walked again for every call.
  const exports = new Map<string, string | null>();
  const exportOf = (path: string, name: string, hops = 3): string | null => {
    const key = `${path}\0${name}\0${hops}`;
    if (!exports.has(key)) exports.set(key, findExport(path, name, hops));
    return exports.get(key)!;
  };
  const findExport = (path: string, name: string, hops: number): string | null => {
    const index = indexes.get(path);
    if (!index) return null;
    const own = index.byLocal.get(name);
    if (own && byId.get(own)!.kind !== 'METHOD') return own;
    // `module.exports = res` with `res.json = function …`: `json` is on the exported object.
    const { defaultExport } = index.file;
    const member = defaultExport ? index.byLocal.get(`${defaultExport}.${name}`) : undefined;
    if (member) return member;
    if (hops === 0) return null;
    for (const fact of index.imports) {
      if (!fact.target) continue;
      if (fact.reexports === '*') {
        const found = exportOf(fact.target, name, hops - 1);
        if (found) return found;
      } else if (fact.reexports) {
        const entry = fact.reexports.find((candidate) => candidate.as === name);
        if (entry) {
          return entry.name === 'default'
            ? defaultOf(fact.target, hops - 1)
            : exportOf(fact.target, entry.name, hops - 1);
        }
      }
    }
    if (index.file.language === 'python') {
      const passed = bindingTarget(index, name);
      if (passed?.binding.kind === 'named')
        return exportOf(passed.target, passed.binding.imported, hops - 1);
    }
    return null;
  };

  const defaultOf = (path: string, hops = 3): string | null => {
    const index = indexes.get(path);
    if (!index) return null;
    const name = index.file.defaultExport;
    if (!name) {
      // `module.exports = require('./lib/express')`
      const passed = index.imports.find((fact) => fact.passesDefault && fact.target);
      return passed && hops > 0 ? defaultOf(passed.target!, hops - 1) : null;
    }
    return index.byLocal.get(name) ?? (hops > 0 ? importedName(index, name, hops - 1) : null);
  };

  // A name brought in by an import: `import { a }`, `import a from`, `from x import *`.
  const importedName = (index: FileIndex, name: string, hops = 3): string | null => {
    const bound = bindingTarget(index, name);
    if (bound?.binding.kind === 'named')
      return exportOf(bound.target, bound.binding.imported, hops);
    if (bound?.binding.kind === 'default') return defaultOf(bound.target, hops);
    for (const fact of index.imports) {
      if (fact.target && fact.bindings.some((binding) => binding.kind === 'wildcard')) {
        const found = exportOf(fact.target, name, hops);
        if (found) return found;
      }
    }
    return null;
  };

  // A class or interface by the name a file uses for it; never `self`, the class whose base
  // this is (`class Form(forms.Form)` names another class of the same name).
  const classRef = (index: FileIndex, name: string, self?: string): string | null => {
    const isClass = (id: string | null | undefined) => {
      const kind = id ? byId.get(id)!.kind : null;
      return (kind === 'CLASS' || kind === 'INTERFACE') && id !== self ? id! : null;
    };
    const parts = name.split('.');
    if (parts.length === 1) {
      const found = isClass(index.byLocal.get(name)) ?? isClass(importedName(index, name));
      if (found) return found;
    } else if (parts.length === 2) {
      const bound = bindingTarget(index, parts[0]!);
      if (bound?.binding.kind === 'namespace') {
        const found = isClass(exportOf(bound.target, parts[1]!));
        if (found) return found;
      }
    }
    // A name imported from a package is that package's class, whatever the repository has.
    const head = parts.length === 1 ? name : parts[0]!;
    const imported = index.file.imports.some((fact) =>
      fact.bindings.some((binding) => binding.kind !== 'wildcard' && binding.local === head),
    );
    const candidates = imported ? [] : (classesByName.get(parts.at(-1)!) ?? []);
    return candidates.length === 1 ? isClass(candidates[0]) : null;
  };

  // EXTENDS / IMPLEMENTS, and each class's resolved bases for method lookup.
  const basesOf = new Map<string, string[]>();
  for (const index of indexes.values()) {
    for (const heritage of index.file.heritage) {
      const from = index.ids[heritage.from];
      if (!from) continue;
      const to = classRef(index, heritage.base, from);
      if (to && heritage.type === 'EXTENDS') {
        if (!basesOf.has(from)) basesOf.set(from, []);
        basesOf.get(from)!.push(to);
      }
      edges.push(edge(index, from, to, heritage.base, heritage.type, heritage.line));
    }
  }

  // A method of a class or of an object functions are assigned onto, looking in base classes
  // up to three levels up.
  const methodOf = (ownerId: string, name: string, depth = 0): string | null => {
    const owner = byId.get(ownerId)!;
    const found = indexes.get(owner.filePath)?.byLocal.get(`${localNameOf(owner)}.${name}`);
    if (found) return found;
    if (depth >= 3) return null;
    for (const base of basesOf.get(ownerId) ?? []) {
      const inherited = methodOf(base, name, depth + 1);
      if (inherited) return inherited;
    }
    return null;
  };

  const resolveCall = (index: FileIndex, from: number | null, callee: string) => {
    const parts = callee.split('.');
    const caller = from === null ? null : index.file.symbols[from]!;
    const [head, second, third] = parts as [string, string?, string?];

    if (parts.length === 1) {
      const local = index.byLocal.get(head);
      if (local && byId.get(local)!.kind !== 'METHOD') return { id: local };
      const imported = importedName(index, head);
      if (imported) return { id: imported };
      // `const express = require('express'); express()` calls what the module exports.
      const bound = bindingTarget(index, head);
      const called = bound?.binding.kind === 'namespace' ? defaultOf(bound.target) : null;
      return called ? { id: called } : null;
    }

    if (head === 'this' || head === 'self') {
      const container = caller?.container ?? (caller?.kind === 'CLASS' ? caller.localName : null);
      const ownerId = container ? index.byLocal.get(container) : undefined;
      if (parts.length === 2) {
        const found = ownerId
          ? methodOf(ownerId, second!)
          : container
            ? index.byLocal.get(`${container}.${second}`)
            : undefined;
        if (found) return { id: found };
      } else if (parts.length === 3 && container) {
        const type = index.file.fieldTypes.get(container)?.get(second!);
        const typeId = type ? classRef(index, type) : null;
        const found = typeId ? methodOf(typeId, third!) : null;
        if (found) return { id: found };
      }
    } else if (parts.length === 2) {
      // `res.send()` in the file that assigns it, `Foo.bar()` for a class in the file.
      const local = index.byLocal.get(callee);
      if (local) return { id: local };
      const variableType = index.file.variableTypes.get(head);
      const typeId = variableType ? classRef(index, variableType) : null;
      const typed = typeId ? methodOf(typeId, second!) : null;
      if (typed) return { id: typed };
      const bound = bindingTarget(index, head);
      if (bound?.binding.kind === 'namespace') {
        const found = exportOf(bound.target, second!);
        if (found) return { id: found };
      } else if (bound) {
        const imported = importedName(index, head);
        const found =
          imported && byId.get(imported)!.kind === 'CLASS' ? methodOf(imported, second!) : null;
        if (found) return { id: found };
      }
    }

    // Python `import a.b` then `a.b.f()`.
    if (parts.length >= 3) {
      const bound = bindingTarget(index, parts.slice(0, -1).join('.'));
      const found =
        bound?.binding.kind === 'namespace' ? exportOf(bound.target, parts.at(-1)!) : null;
      if (found) return { id: found };
    }

    const last = parts.at(-1)!;
    if (COMMON_METHODS.has(last)) return null;
    const candidates = membersByName.get(last) ?? [];
    return candidates.length === 1 ? { id: candidates[0]!, byName: true } : null;
  };

  let calls = 0;
  let callsResolved = 0;
  let callsResolvedByName = 0;
  for (const index of indexes.values()) {
    const seen = new Set<string>();
    for (const call of index.file.calls) {
      const from = call.from === null ? index.fileSymbolId : index.ids[call.from];
      if (!from) continue;
      // Repeated names share one symbol, so their calls can repeat too.
      const key = `${from}|${call.callee}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const resolved = resolveCall(index, call.from, call.callee);
      calls++;
      if (resolved) callsResolved++;
      if (resolved?.byName) callsResolvedByName++;
      edges.push(edge(index, from, resolved?.id ?? null, call.callee, 'CALLS', call.line));
    }
  }

  return {
    graph: { symbols, edges },
    stats: {
      symbols: symbols.length,
      edges: edges.length,
      edgesResolved: edges.filter((candidate) => candidate.toSymbolId !== null).length,
      calls,
      callsResolved,
      callsResolvedByName,
      imports,
      importsResolved,
    },
  };
}

function edge(
  index: FileIndex,
  fromSymbolId: string,
  toSymbolId: string | null,
  toName: string,
  type: DraftEdge['type'],
  line: number,
): DraftEdge {
  return { fromSymbolId, toSymbolId, toName, type, filePath: index.file.path, line };
}

function localNameOf(symbol: DraftSymbol) {
  return symbol.qualifiedName.slice(symbol.filePath.length + 1);
}

// The child chunk holding a symbol's first line; one named after the symbol wins.
function chunkFor(file: GraphFile, localName: string, line: number) {
  const holding = file.chunks.filter(
    (chunk) =>
      chunk.lineStart !== null &&
      chunk.lineEnd !== null &&
      chunk.lineStart <= line &&
      line <= chunk.lineEnd,
  );
  return (holding.find((chunk) => chunk.symbolName === localName) ?? holding[0])?.id ?? null;
}

/** `./x` from a TS/JS file → the repository file it loads, trying the usual extensions. */
export function resolveScriptModule(from: string, specifier: string, paths: Set<string>) {
  if (!/^\.\.?(\/|$)/.test(specifier)) return null;
  // `require('..')` and `require('../../')` load a folder's index.
  const joined = posix.normalize(posix.join(posix.dirname(from), specifier)).replace(/\/$/, '');
  if (joined === '..' || joined.startsWith('../')) return null;
  if (joined === '.')
    return SCRIPT_EXTENSIONS.map((ext) => `index${ext}`).find((p) => paths.has(p)) ?? null;
  const base = joined;
  const stem = base.replace(/\.(m|c)?jsx?$/, '');
  const candidates = [
    base,
    ...SCRIPT_EXTENSIONS.map((extension) => base + extension),
    ...SCRIPT_EXTENSIONS.map((extension) => `${base}/index${extension}`),
    // ESM TypeScript imports `./x.js` for `x.ts`.
    ...(stem !== base ? SCRIPT_EXTENSIONS.map((extension) => stem + extension) : []),
  ];
  return candidates.find((candidate) => paths.has(candidate)) ?? null;
}

/**
 * A Python module → its file. Relative (`.x`, `..pkg.mod`) from the importing file's
 * package; absolute from the repository root, `src/` or `lib/`, and only then from the
 * folders above the importing file (an absolute `import logging` is usually the standard
 * library, not a sibling `logging.py`).
 */
export function resolvePythonModule(from: string, specifier: string, paths: Set<string>) {
  const [, dots, rest] = /^(\.*)(.*)$/.exec(specifier)!;
  const parts = rest ? rest.split('.') : [];
  const inFolder = (folder: string) => {
    const base = posix.join(folder, ...parts);
    const candidates =
      parts.length > 0 ? [`${base}.py`, `${base}/__init__.py`] : [`${base}/__init__.py`];
    return (
      candidates
        .map((candidate) => posix.normalize(candidate).replace(/^\.\//, ''))
        .find((candidate) => paths.has(candidate)) ?? null
    );
  };
  if (dots!.length > 0) {
    let folder = posix.dirname(from);
    for (let i = 1; i < dots!.length; i++) folder = posix.dirname(folder);
    return inFolder(folder);
  }
  if (parts.length === 0) return null;
  const ancestors: string[] = [];
  for (
    let folder = posix.dirname(from);
    folder !== '.' && folder !== '/';
    folder = posix.dirname(folder)
  ) {
    ancestors.unshift(folder);
  }
  for (const folder of ['.', 'src', 'lib', ...ancestors]) {
    const found = inFolder(folder);
    if (found) return found;
  }
  return null;
}

// `from pkg import mod` → `pkg.mod`; `from . import mod` → `.mod`.
function submodule(specifier: string, name: string) {
  return specifier.endsWith('.') ? specifier + name : `${specifier}.${name}`;
}
