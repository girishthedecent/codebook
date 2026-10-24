import type { Node } from 'web-tree-sitter';

// What the code chunker needs to know about a tree-sitter syntax tree (TypeScript,
// JavaScript, Python): which nodes are named declarations, where they really start, and
// how a declaration's body splits into members or statements.

// A named declaration: `label` is how a heading path shows it ('class', 'function',
// 'method'), `node` the part whose body is split when it's too big.
export type Declaration = { label: string; name: string; node: Node };

const FUNCTION_VALUES = new Set([
  'arrow_function',
  'function_expression',
  'function',
  'generator_function',
]);
const BODY_TYPES = new Set(['statement_block', 'class_body', 'block']);
const LABELS: Record<string, string> = {
  function_declaration: 'function',
  generator_function_declaration: 'function',
  class_declaration: 'class',
  abstract_class_declaration: 'class',
  class: 'class',
  interface_declaration: 'interface',
  type_alias_declaration: 'type',
  enum_declaration: 'enum',
  internal_module: 'namespace',
  module: 'namespace',
  function_definition: 'function',
  class_definition: 'class',
};

/**
 * A declaration's members (a class) or statements (a function), each with where it really
 * starts. Empty when the body isn't such a list: an expression body (`() => a ? b : c`)
 * would lose the text between its parts.
 */
export function bodyParts(text: string, declaration: Declaration) {
  const body = declaration.node.childForFieldName('body');
  if (!body || !BODY_TYPES.has(body.type)) return [];
  return withLeadingComments(text, namedChildren(body));
}

export function namedChildren(node: Node) {
  return node.namedChildren.filter((child): child is Node => child !== null);
}

// Pairs each node with where it really starts: comments and decorators right above it (no
// blank line in between) belong to it. TypeScript keeps a method's decorators (`@Get()`)
// as separate children of the class body, unlike Python's decorated_definition. Comments
// followed by a blank line stay nodes of their own.
export function withLeadingComments(text: string, nodes: Node[]) {
  const result: { start: number; node: Node }[] = [];
  let commentStart: number | null = null;
  nodes.forEach((node, i) => {
    const next = nodes[i + 1];
    if (
      (node.type === 'comment' || node.type === 'decorator') &&
      next &&
      !/\n[ \t]*\n/.test(text.slice(node.endIndex, next.startIndex))
    ) {
      commentStart ??= node.startIndex;
      return;
    }
    result.push({ start: commentStart ?? node.startIndex, node });
    commentStart = null;
  });
  return result;
}

/** The named declaration a top-level statement or class member is, if any. */
export function declarationOf(node: Node): Declaration | null {
  switch (node.type) {
    case 'export_statement': {
      const inner = node.childForFieldName('declaration') ?? node.childForFieldName('value');
      return inner ? declarationOf(inner) : null;
    }
    case 'decorated_definition': {
      const inner = node.childForFieldName('definition');
      return inner ? declarationOf(inner) : null;
    }
    case 'lexical_declaration':
    case 'variable_declaration': {
      // `const handler = () => …`: a function in all but syntax.
      const declarators = namedChildren(node).filter(
        (child) => child.type === 'variable_declarator',
      );
      const value = declarators[0]?.childForFieldName('value');
      const name = declarators[0]?.childForFieldName('name')?.text;
      if (declarators.length !== 1 || !value || !name) return null;
      if (FUNCTION_VALUES.has(value.type)) return { label: 'function', name, node: value };
      if (value.type === 'class') return { label: 'class', name, node: value };
      return null;
    }
    case 'expression_statement': {
      // `res.send = function send() { … }`, `module.exports = () => …`: older JavaScript's
      // way of defining functions and methods.
      const assignment = node.namedChildren[0];
      const value = assignment?.childForFieldName('right');
      const name = assignment?.childForFieldName('left')?.text;
      if (assignment?.type !== 'assignment_expression' || !value || !name) return null;
      return FUNCTION_VALUES.has(value.type) && name.length <= 80
        ? { label: 'function', name, node: value }
        : null;
    }
    case 'method_definition':
    case 'method_signature':
    case 'abstract_method_signature': {
      const name = node.childForFieldName('name')?.text;
      return name ? { label: 'method', name, node } : null;
    }
    // Class fields (`handleClick = () => {…}`); a function value is split like a method.
    // JavaScript names the property differently from TypeScript.
    case 'public_field_definition':
    case 'field_definition': {
      const name = (node.childForFieldName('name') ?? node.childForFieldName('property'))?.text;
      const value = node.childForFieldName('value');
      return name ? { label: 'method', name, node: value ?? node } : null;
    }
    default: {
      const label = LABELS[node.type];
      const name = node.childForFieldName('name')?.text;
      return label && name ? { label, name, node } : null;
    }
  }
}
