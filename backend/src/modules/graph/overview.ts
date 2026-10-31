// Helpers for the graph overview: which package a call outside the repository belongs to.
// The graph keeps unresolved calls as written (`F.softmax`) and imports by module (`torch.nn`),
// not which name binds which module, so the bindings are read back from the files' import
// statements.

type Import = { local: string; specifier: string };

/** `@scope/name`, `express` or `node:fs` for a module path; the first part of a Python module. */
export function packageOf(specifier: string, filePath: string) {
  if (filePath.endsWith('.py')) return specifier.split('.')[0]!;
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!;
}

/** The names the top-level import statements of the text bind, with the module each is from. */
export function importedNames(text: string, python: boolean): Import[] {
  return python ? pythonImports(text) : scriptImports(text);
}

function pythonImports(text: string): Import[] {
  const found: Import[] = [];
  for (const [, list] of text.matchAll(/^import\s+([^\n#]+)/gm)) {
    for (const part of list!.split(',')) {
      const [, module, alias] = /^\s*([\w.]+)(?:\s+as\s+(\w+))?\s*$/.exec(part) ?? [];
      if (module) found.push({ local: alias ?? module.split('.')[0]!, specifier: module });
    }
  }
  for (const [, module, list] of text.matchAll(
    /^from\s+([\w.]+)\s+import\s+(\([^)]*\)|[^\n#]+)/gm,
  )) {
    for (const part of list!.replace(/[()]/g, '').split(/[,\n]/)) {
      const [, name, alias] = /^\s*(\w+)(?:\s+as\s+(\w+))?\s*$/.exec(part) ?? [];
      if (name) found.push({ local: alias ?? name, specifier: module! });
    }
  }
  return found;
}

function scriptImports(text: string): Import[] {
  const found: Import[] = [];
  for (const [, clause, specifier] of text.matchAll(
    /\bimport\s+(?:type\s+)?([^'";]*?)\s*from\s*['"]([^'"]+)['"]/g,
  )) {
    // `* as ns` binds ns; in `{ a as b }` the local name is b.
    const names = clause!.replace(/\*\s*as\s+/g, '').replace(/\btype\s+/g, '');
    for (const [, name, alias] of names.matchAll(/([\w$]+)(?:\s+as\s+([\w$]+))?/g)) {
      found.push({ local: alias ?? name!, specifier: specifier! });
    }
  }
  for (const [, binding, specifier] of text.matchAll(
    /\b(?:const|let|var)\s+(\{[^}]*\}|[\w$]+)\s*=\s*require\(\s*['"]([^'"]+)['"]\s*\)/g,
  )) {
    // `{ a, b: c }` binds a and c.
    for (const [, key, value] of binding!.matchAll(/([\w$]+)(?:\s*:\s*([\w$]+))?/g)) {
      found.push({ local: value ?? key!, specifier: specifier! });
    }
  }
  return found;
}

type CallHeads = { filePath: string; head: string; calls: number }[];

/**
 * Calls to packages, most called first. A call counts for a package when the name it starts
 * with is bound by one of the file's imports of that package (`import numpy as np` makes
 * `np.zeros` a numpy call); anything else (builtins, methods of local variables) is no one's.
 * `external` is each file's imports outside the repository, `heads` the start of its text.
 */
export function countPackageCalls(
  calls: CallHeads,
  external: { filePath: string; specifier: string }[],
  heads: ReadonlyMap<string, string>,
  limit: number,
) {
  const specifiers = new Map<string, Set<string>>();
  for (const { filePath, specifier } of external) {
    if (!specifiers.has(filePath)) specifiers.set(filePath, new Set());
    specifiers.get(filePath)!.add(specifier);
  }

  const bindings = new Map<string, Map<string, string>>();
  const bindingsOf = (filePath: string) => {
    let known = bindings.get(filePath);
    if (known) return known;
    known = new Map();
    const modules = specifiers.get(filePath) ?? new Set();
    const python = filePath.endsWith('.py');
    for (const { local, specifier } of importedNames(heads.get(filePath) ?? '', python)) {
      if (modules.has(specifier)) known.set(local, packageOf(specifier, filePath));
    }
    // The module's own name, as in `import torch` followed by `torch.zeros()`.
    for (const specifier of modules) {
      const name = packageOf(specifier, filePath);
      if (!known.has(name)) known.set(name, name);
    }
    bindings.set(filePath, known);
    return known;
  };

  const totals = new Map<string, number>();
  for (const { filePath, head, calls: count } of calls) {
    const name = bindingsOf(filePath).get(head);
    if (name) totals.set(name, (totals.get(name) ?? 0) + count);
  }
  return [...totals]
    .map(([name, calls]) => ({ name, calls }))
    .sort((a, b) => b.calls - a.calls || a.name.localeCompare(b.name))
    .slice(0, limit);
}
