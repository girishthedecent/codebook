import type { Node } from 'web-tree-sitter';
import { declarationOf, namedChildren, type Declaration } from '../../ingestion/code/syntax.js';
import { lineOf, nameChain, type FileSymbol, type Heritage, type SymbolKind } from './fileFacts.js';

// Symbols are the declarations the chunker names (syntax.ts), so chunk symbol names and graph
// symbols agree. Types, enums and namespaces aren't symbols: nothing calls them.

const KINDS: Record<string, SymbolKind> = {
  function: 'FUNCTION',
  class: 'CLASS',
  interface: 'INTERFACE',
};
const FUNCTION_VALUES = new Set([
  'arrow_function',
  'function_expression',
  'function',
  'generator_function',
]);
const FIELD_TYPES = new Set(['public_field_definition', 'field_definition']);

export function declarations(root: Node, python: boolean) {
  const symbols: FileSymbol[] = [];
  const heritage: Heritage[] = [];
  const fieldTypes = new Map<string, Map<string, string>>();
  const variableTypes = new Map<string, string>();
  const exportedNames = new Set<string>();
  let defaultExport: string | null = null;

  const add = (symbol: Omit<FileSymbol, 'signature' | 'lineStart' | 'lineEnd'>, node: Node) => {
    symbols.push({
      ...symbol,
      lineStart: lineOf(node),
      lineEnd: node.endPosition.row + 1,
      signature: node.text.split('\n', 1)[0]!.trim().slice(0, 200),
    });
    return symbols.length - 1;
  };

  for (const statement of namedChildren(root)) {
    const isExport = statement.type === 'export_statement';
    if (isExport && statement.childForFieldName('source')) continue; // a re-export
    if (isExport) noteExports(statement);
    if (statement.type === 'expression_statement') noteCommonJsExports(statement);

    const decl = declarationOf(statement);
    const kind = decl && KINDS[decl.label];
    if (!decl) collectVariableTypes(statement, python, variableTypes);
    if (!decl || !kind) continue;

    const named = topLevelName(decl);
    if (!named) continue;
    const exported = python
      ? !named.name.startsWith('_')
      : isExport || /^(module\.)?exports(\.|$)/.test(decl.name);
    if (isExport && statement.children.some((child) => child?.type === 'default')) {
      defaultExport = named.localName;
    }
    if (/^module\.exports$/.test(decl.name)) defaultExport = named.localName;

    const index = add(
      { ...named, kind, exported, start: statement.startIndex, end: statement.endIndex },
      statement,
    );
    if (kind === 'CLASS' || kind === 'INTERFACE') {
      heritage.push(...heritageOf(decl.node, index));
    }
    if (kind === 'CLASS' || kind === 'INTERFACE') {
      const fields = new Map<string, string>();
      for (const member of classMembers(decl.node)) {
        const method = memberMethod(member, python);
        if (method) {
          add(
            {
              name: method,
              localName: `${named.localName}.${method}`,
              kind: 'METHOD',
              container: named.localName,
              exported,
              start: member.startIndex,
              end: member.endIndex,
            },
            member,
          );
        }
        collectFieldTypes(member, python, fields);
      }
      if (fields.size > 0) fieldTypes.set(named.localName, fields);
    }
  }

  for (const symbol of symbols) {
    if (symbol.container === null && exportedNames.has(symbol.localName)) symbol.exported = true;
  }
  return { symbols, heritage, fieldTypes, variableTypes, exportedNames, defaultExport };

  // `export { a, b as default }`, `export default name;`
  function noteExports(statement: Node) {
    const value = statement.childForFieldName('value');
    if (value?.type === 'identifier') {
      defaultExport = value.text;
      exportedNames.add(value.text);
    }
    for (const clause of namedChildren(statement)) {
      if (clause.type !== 'export_clause') continue;
      for (const specifier of namedChildren(clause)) {
        const name = specifier.childForFieldName('name')?.text;
        if (!name) continue;
        exportedNames.add(name);
        if (specifier.childForFieldName('alias')?.text === 'default') defaultExport = name;
      }
    }
  }

  // `module.exports = app`, `module.exports = { a, b: c }`, `exports.a = a`, and chains
  // like `exports = module.exports = createApplication`.
  function noteCommonJsExports(statement: Node) {
    let assignment = statement.namedChildren[0];
    if (assignment?.type !== 'assignment_expression') return;
    let left = assignment.childForFieldName('left')?.text ?? '';
    let right = assignment.childForFieldName('right');
    while (right?.type === 'assignment_expression') {
      assignment = right;
      const inner = assignment.childForFieldName('left')?.text ?? '';
      if (inner === 'module.exports') left = inner;
      right = assignment.childForFieldName('right');
    }
    if (!right || !/^(module\.)?exports(\.|$)/.test(left)) return;
    if (right.type === 'identifier') {
      exportedNames.add(right.text);
      if (left === 'module.exports') defaultExport = right.text;
    } else if (right.type === 'object' && left === 'module.exports') {
      for (const property of namedChildren(right)) {
        if (property.type === 'shorthand_property_identifier') exportedNames.add(property.text);
        const value = property.type === 'pair' ? property.childForFieldName('value') : null;
        if (value?.type === 'identifier') exportedNames.add(value.text);
      }
    }
  }
}

// Assigned functions are named by their last part (`res.send` → `send` on `res`);
// `module.exports = function createApp()` by the function's own name when it has one.
function topLevelName(decl: Declaration) {
  if (!decl.name.includes('.')) return { name: decl.name, localName: decl.name, container: null };
  // `exports.helper = function …` is the module's `helper`, as `require` callers see it.
  const exported = /^(?:module\.)?exports\.([\w$]+)$/.exec(decl.name)?.[1];
  if (exported) return { name: exported, localName: exported, container: null };
  if (/^(module\.)?exports$/.test(decl.name)) {
    const own = decl.node.childForFieldName('name')?.text;
    return own
      ? { name: own, localName: own, container: null }
      : { name: 'exports', localName: decl.name, container: null };
  }
  const cut = decl.name.lastIndexOf('.');
  const container = decl.name.slice(0, cut);
  const name = decl.name.slice(cut + 1);
  if (!/^[\w$]+$/.test(name)) return null;
  return { name, localName: decl.name, container };
}

function classMembers(node: Node) {
  const body = node.childForFieldName('body');
  return body ? namedChildren(body) : [];
}

// A member that is a method: a method definition (or signature), a field holding a function,
// or a Python def (decorated or not).
function memberMethod(member: Node, python: boolean) {
  if (python) {
    const definition =
      member.type === 'decorated_definition' ? member.childForFieldName('definition') : member;
    return definition?.type === 'function_definition'
      ? (definition.childForFieldName('name')?.text ?? null)
      : null;
  }
  const decl = declarationOf(member);
  if (decl?.label !== 'method') return null;
  if (FIELD_TYPES.has(member.type)) {
    const value = member.childForFieldName('value');
    if (!value || !FUNCTION_VALUES.has(value.type)) return null;
  }
  return decl.name;
}

function heritageOf(node: Node, from: number): Heritage[] {
  const result: Heritage[] = [];
  const push = (type: Heritage['type'], base: Node | null | undefined) => {
    const name = base && nameChain(typeName(base));
    if (name) result.push({ from, type, base: name, line: lineOf(base) });
  };
  for (const child of namedChildren(node)) {
    switch (child.type) {
      case 'class_heritage':
        for (const clause of namedChildren(child)) {
          if (clause.type === 'extends_clause') push('EXTENDS', clause.childForFieldName('value'));
          else if (clause.type === 'implements_clause') {
            for (const type of namedChildren(clause)) push('IMPLEMENTS', type);
          } else push('EXTENDS', clause); // JavaScript: the base expression itself
        }
        break;
      case 'extends_type_clause':
        for (const type of namedChildren(child)) push('EXTENDS', type);
        break;
    }
  }
  // Python: class A(B, metaclass=M)
  const superclasses = node.childForFieldName('superclasses');
  for (const base of superclasses ? namedChildren(superclasses) : []) {
    if (base.type !== 'keyword_argument') push('EXTENDS', base);
  }
  return result;
}

// `Repository<User>` → `Repository`.
function typeName(node: Node): Node {
  if (node.type === 'generic_type') return node.childForFieldName('name') ?? node;
  if (node.type === 'type_annotation' || node.type === 'type') {
    const inner = node.namedChildren[0];
    return inner ? typeName(inner) : node;
  }
  return node;
}

// Field → class name, where the code says it: `private repo: UserRepository` (field or
// constructor parameter property), `svc = new AuthService()`, `this.db = new Db()` in the
// constructor; Python `self.repo = repo` with `repo: Repo` an `__init__` parameter, or
// `self.repo = Repo()`.
function collectFieldTypes(member: Node, python: boolean, fields: Map<string, string>) {
  const set = (field: string | undefined, type: Node | null | undefined) => {
    const name = type && nameChain(typeName(type));
    if (field && name && !fields.has(field)) fields.set(field, name);
  };

  if (!python && FIELD_TYPES.has(member.type)) {
    const field = (member.childForFieldName('name') ?? member.childForFieldName('property'))?.text;
    set(field, member.childForFieldName('type'));
    const value = member.childForFieldName('value');
    if (value?.type === 'new_expression') set(field, value.childForFieldName('constructor'));
    return;
  }

  const definition =
    python && member.type === 'decorated_definition'
      ? member.childForFieldName('definition')
      : member;
  const name = definition?.childForFieldName('name')?.text;
  // An interface property can be called `constructor` too; only a method has parameters.
  const parameters = definition?.childForFieldName('parameters');
  if (!definition || !parameters || name !== (python ? '__init__' : 'constructor')) return;

  const parameterTypes = new Map<string, Node>();
  for (const parameter of namedChildren(parameters)) {
    if (python) {
      const type = parameter.childForFieldName('type');
      const id = parameter.namedChildren[0];
      if (parameter.type === 'typed_parameter' && type && id) parameterTypes.set(id.text, type);
      continue;
    }
    const pattern = parameter.childForFieldName('pattern')?.text;
    const type = parameter.childForFieldName('type');
    const property = parameter.children.some(
      (child) => child?.type === 'accessibility_modifier' || child?.text === 'readonly',
    );
    if (property) set(pattern, type);
    else if (pattern && type) parameterTypes.set(pattern, type);
  }

  const body = definition.childForFieldName('body');
  for (const statement of body ? namedChildren(body) : []) {
    const assignment = statement.namedChildren[0];
    if (statement.type !== 'expression_statement' || !assignment) continue;
    if (assignment.type !== 'assignment' && assignment.type !== 'assignment_expression') continue;
    const left = assignment.childForFieldName('left');
    const right = assignment.childForFieldName('right');
    const target = left && /^(this|self)\.([\w$]+)$/.exec(left.text)?.[2];
    if (!target || !right) continue;
    if (python) set(target, assignment.childForFieldName('type'));
    if (right.type === 'identifier') set(target, parameterTypes.get(right.text));
    else if (right.type === 'new_expression') set(target, right.childForFieldName('constructor'));
    else if (python && right.type === 'call') {
      const callee = right.childForFieldName('function');
      // A capitalized callee is a class being constructed, by Python convention.
      if (callee && /(^|\.)[A-Z][\w]*$/.test(callee.text)) set(target, callee);
    }
  }
}

// `const service = new AuthService()`, `let repo: UserRepository`; Python `service = Service()`.
function collectVariableTypes(statement: Node, python: boolean, types: Map<string, string>) {
  const set = (name: string | undefined, type: Node | null | undefined) => {
    const typeText = type && nameChain(typeName(type));
    if (name && typeText && !types.has(name)) types.set(name, typeText);
  };
  if (python) {
    const assignment = statement.namedChildren[0];
    if (statement.type !== 'expression_statement' || assignment?.type !== 'assignment') return;
    const name = assignment.childForFieldName('left');
    if (name?.type !== 'identifier') return;
    set(name.text, assignment.childForFieldName('type'));
    const right = assignment.childForFieldName('right');
    const callee = right?.type === 'call' ? right.childForFieldName('function') : null;
    if (callee && /(^|\.)[A-Z]\w*$/.test(callee.text)) set(name.text, callee);
    return;
  }
  const declaration =
    statement.type === 'export_statement' ? statement.childForFieldName('declaration') : statement;
  if (declaration?.type !== 'lexical_declaration' && declaration?.type !== 'variable_declaration') {
    return;
  }
  for (const declarator of namedChildren(declaration)) {
    if (declarator.type !== 'variable_declarator') continue;
    const name = declarator.childForFieldName('name');
    if (name?.type !== 'identifier') continue;
    set(name.text, declarator.childForFieldName('type'));
    const value = declarator.childForFieldName('value');
    if (value?.type === 'new_expression') set(name.text, value.childForFieldName('constructor'));
  }
}
