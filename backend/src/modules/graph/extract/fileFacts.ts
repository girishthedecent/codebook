import type { Node } from 'web-tree-sitter';
import { parseCode, type CodeLanguage } from '../../ingestion/code/treeSitter.js';
import { declarations } from './declarations.js';
import { calls, imports } from './references.js';

// What one source file says about the code graph, before anything is resolved across files.

export type SymbolKind = 'CLASS' | 'INTERFACE' | 'FUNCTION' | 'METHOD';

export type FileSymbol = {
  name: string;
  // The name inside the file: `AuthService.login`, `res.send`, `loginHandler`.
  localName: string;
  kind: SymbolKind;
  // The class a method belongs to, or the object a function is assigned onto (`res`).
  container: string | null;
  lineStart: number;
  lineEnd: number;
  // Character range, to find the symbol a call is made in.
  start: number;
  end: number;
  signature: string;
  exported: boolean;
};

export type Heritage = {
  // Index into the file's symbols.
  from: number;
  type: 'EXTENDS' | 'IMPLEMENTS';
  base: string;
  line: number;
};

export type Binding =
  // `import { a as b }`, `from x import a as b`: local `b` is `a` there.
  | { kind: 'named'; local: string; imported: string }
  | { kind: 'default'; local: string }
  // `import * as ns`, `const ns = require(…)`, `import a.b as c`.
  | { kind: 'namespace'; local: string }
  // `from x import *`.
  | { kind: 'wildcard' };

export type ImportFact = {
  specifier: string;
  line: number;
  bindings: Binding[];
  // `export … from`: names this file passes on. `'*'` passes everything.
  reexports: { name: string; as: string }[] | '*' | null;
  // `module.exports = require('./x')`: this file's default export is x's.
  passesDefault?: boolean;
};

export type CallFact = {
  // Index into the file's symbols; null for code at module level.
  from: number | null;
  callee: string;
  line: number;
};

export type FileFacts = {
  path: string;
  language: CodeLanguage;
  lineCount: number;
  symbols: FileSymbol[];
  heritage: Heritage[];
  // Class (by local name) → field → type name, from TS annotations, `= new X()` and
  // Python `__init__` assignments.
  fieldTypes: Map<string, Map<string, string>>;
  // Module-level variables → class name: `const service = new AuthService()`.
  variableTypes: Map<string, string>;
  // Names exported without being declared exported (`export { a }`, `module.exports = { a }`).
  exportedNames: Set<string>;
  // The local name a default export refers to (`export default X`, `module.exports = X`).
  defaultExport: string | null;
  imports: ImportFact[];
  calls: CallFact[];
};

/** Parses a code file and collects its symbols, imports and calls. */
export async function extractFile(
  text: string,
  language: CodeLanguage,
  path: string,
  lineCount: number,
): Promise<FileFacts | null> {
  const tree = await parseCode(text, language);
  if (!tree) return null;
  try {
    const root = tree.rootNode;
    const python = language === 'python';
    const found = declarations(root, python);
    return {
      path,
      language,
      lineCount,
      ...found,
      imports: imports(root, python),
      calls: calls(root, python, found.symbols),
    };
  } finally {
    tree.delete();
  }
}

export const lineOf = (node: Node) => node.startPosition.row + 1;

// Callees and bases worth resolving: a name or a chain of names (`this.repo.find`).
const NAME_CHAIN = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$#][\w$]*)*$/;

/** A callee or base class as a dotted name, or null when it isn't one (`a()()`, `x[0]()`). */
export function nameChain(node: Node) {
  const text = node.text.replace(/\s+/g, '').replaceAll('?.', '.');
  return text.length <= 200 && NAME_CHAIN.test(text) ? text : null;
}
