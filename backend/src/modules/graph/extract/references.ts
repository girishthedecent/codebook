import type { Node } from 'web-tree-sitter';
import { namedChildren } from '../../ingestion/code/syntax.js';
import {
  lineOf,
  nameChain,
  type Binding,
  type CallFact,
  type FileSymbol,
  type ImportFact,
} from './fileFacts.js';

// Imports (with the names they bind) and calls, as written. resolve.ts works out what
// they point at.

/** Top-level imports and re-exports; for JavaScript also every `require('…')`. */
export function imports(root: Node, python: boolean): ImportFact[] {
  return python ? pythonImports(root) : scriptImports(root);
}

function scriptImports(root: Node): ImportFact[] {
  const result: ImportFact[] = [];
  for (const statement of namedChildren(root)) {
    const source = statement.childForFieldName('source');
    const specifier = source && stringValue(source);
    if (!specifier) continue;
    if (statement.type === 'import_statement') {
      result.push({
        specifier,
        line: lineOf(statement),
        bindings: importBindings(statement),
        reexports: null,
      });
    } else if (statement.type === 'export_statement') {
      const clause = namedChildren(statement).find((child) => child.type === 'export_clause');
      const reexports = clause
        ? namedChildren(clause).flatMap((specifierNode) => {
            const name = specifierNode.childForFieldName('name')?.text;
            const alias = specifierNode.childForFieldName('alias')?.text;
            return name ? [{ name, as: alias ?? name }] : [];
          })
        : '*';
      result.push({ specifier, line: lineOf(statement), bindings: [], reexports });
    }
  }

  // require() can be anywhere; only a top-level `const x = require(…)` binds a name we track.
  walk(root, (node) => {
    if (node.type !== 'call_expression') return;
    const fn = node.childForFieldName('function');
    const argument = node.childForFieldName('arguments')?.namedChildren[0];
    if (fn?.type !== 'identifier' || fn.text !== 'require' || argument?.type !== 'string') return;
    const specifier = stringValue(argument);
    if (!specifier) return;
    const declarator = node.parent?.type === 'variable_declarator' ? node.parent : null;
    const topLevel = declarator?.parent?.parent?.type === 'program';
    const bindings = topLevel ? requireBindings(declarator!.childForFieldName('name')) : [];
    const assigned = node.parent?.type === 'assignment_expression' ? node.parent : null;
    const passesDefault = assigned?.childForFieldName('left')?.text === 'module.exports';
    result.push({ specifier, line: lineOf(node), bindings, reexports: null, passesDefault });
  });
  return result;
}

function importBindings(statement: Node): Binding[] {
  const clause = namedChildren(statement).find((child) => child.type === 'import_clause');
  if (!clause) return [];
  const bindings: Binding[] = [];
  for (const part of namedChildren(clause)) {
    if (part.type === 'identifier') bindings.push({ kind: 'default', local: part.text });
    else if (part.type === 'namespace_import') {
      const local = part.namedChildren[0]?.text;
      if (local) bindings.push({ kind: 'namespace', local });
    } else if (part.type === 'named_imports') {
      for (const specifier of namedChildren(part)) {
        const imported = specifier.childForFieldName('name')?.text;
        const alias = specifier.childForFieldName('alias')?.text;
        if (!imported) continue;
        bindings.push(
          imported === 'default'
            ? { kind: 'default', local: alias ?? imported }
            : { kind: 'named', local: alias ?? imported, imported },
        );
      }
    }
  }
  return bindings;
}

// `const x = require(…)` → namespace; `const { a, b: c } = require(…)` → named.
function requireBindings(name: Node | null): Binding[] {
  if (name?.type === 'identifier') return [{ kind: 'namespace', local: name.text }];
  if (name?.type !== 'object_pattern') return [];
  return namedChildren(name).flatMap((part): Binding[] => {
    if (part.type === 'shorthand_property_identifier_pattern') {
      return [{ kind: 'named', local: part.text, imported: part.text }];
    }
    const key = part.childForFieldName('key')?.text;
    const value = part.childForFieldName('value');
    return part.type === 'pair_pattern' && key && value?.type === 'identifier'
      ? [{ kind: 'named', local: value.text, imported: key }]
      : [];
  });
}

function pythonImports(root: Node): ImportFact[] {
  const result: ImportFact[] = [];
  for (const statement of namedChildren(root)) {
    const line = lineOf(statement);
    if (statement.type === 'import_statement') {
      // `import a.b` binds `a.b` for our purposes (calls are written `a.b.f()`).
      for (const name of namedChildren(statement)) {
        const dotted = name.type === 'aliased_import' ? name.childForFieldName('name') : name;
        const alias = name.type === 'aliased_import' ? name.childForFieldName('alias')?.text : null;
        if (!dotted) continue;
        result.push({
          specifier: dotted.text,
          line,
          bindings: [{ kind: 'namespace', local: alias ?? dotted.text }],
          reexports: null,
        });
      }
    } else if (statement.type === 'import_from_statement') {
      const module = statement.childForFieldName('module_name');
      if (!module) continue;
      const bindings: Binding[] = [];
      for (const name of namedChildren(statement)) {
        if (name.id === module.id) continue;
        if (name.type === 'wildcard_import') bindings.push({ kind: 'wildcard' });
        else if (name.type === 'dotted_name') {
          bindings.push({ kind: 'named', local: name.text, imported: name.text });
        } else if (name.type === 'aliased_import') {
          const imported = name.childForFieldName('name')?.text;
          const local = name.childForFieldName('alias')?.text;
          if (imported && local) bindings.push({ kind: 'named', local, imported });
        }
      }
      result.push({ specifier: module.text, line, bindings, reexports: null });
    }
  }
  return result;
}

/** Calls by name (`foo()`, `this.repo.find()`), each with the symbol it's made in. */
export function calls(root: Node, python: boolean, symbols: FileSymbol[]): CallFact[] {
  const result: CallFact[] = [];
  const seen = new Set<string>();
  const enclosing = enclosingSymbols(symbols);
  walk(root, (node) => {
    if (node.type !== (python ? 'call' : 'call_expression')) return;
    const fn = node.childForFieldName('function');
    if (!fn || fn.type === 'super' || fn.type === 'import') return;
    if (fn.type === 'identifier' && fn.text === 'require') return;
    const callee = nameChain(fn);
    if (!callee) return;
    const from = enclosing(node.startIndex);
    const key = `${from}|${callee}`;
    if (seen.has(key)) return;
    seen.add(key);
    result.push({ from, callee, line: lineOf(node) });
  });
  return result;
}

// The innermost symbol around a position (a method inside its class), for positions asked in
// increasing order, as the walk visits nodes: one pass over the symbols, which nest or follow
// each other.
function enclosingSymbols(symbols: FileSymbol[]) {
  const byStart = symbols.map((_, i) => i).sort((a, b) => symbols[a]!.start - symbols[b]!.start);
  const open: number[] = [];
  let next = 0;
  return (at: number): number | null => {
    while (next < byStart.length && symbols[byStart[next]!]!.start <= at)
      open.push(byStart[next++]!);
    while (open.length > 0 && symbols[open.at(-1)!]!.end <= at) open.pop();
    // A symbol that ended before an enclosing one still open can sit below it on the stack.
    for (let i = open.length - 1; i >= 0; i--) {
      if (symbols[open[i]!]!.end > at) return open[i]!;
    }
    return null;
  };
}

function stringValue(node: Node) {
  if (node.type !== 'string') return null;
  const value = node.text.slice(1, -1);
  return value.length > 0 && value.length <= 500 ? value : null;
}

// Depth-first without recursion: files can nest deeper than the stack allows. Nodes inside
// a parse error are skipped.
function walk(root: Node, visit: (node: Node) => void) {
  const stack: Node[] = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.type === 'ERROR') continue;
    visit(node);
    const children = namedChildren(node);
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]!);
  }
}
