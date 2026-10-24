import type { Node } from 'web-tree-sitter';
import { appConfig } from '../../../config/app.config.js';
import { countTokens } from '../../../utils/tokens.js';
import { chunkText, splitLong, trimRange, type ChunkSettings } from '../doc.chunker.js';
import type { ChunkPlan, ChunkSpan } from '../ingestion.types.js';
import { withLines } from './lines.js';
import { parseCode, type CodeLanguage } from './treeSitter.js';

// A piece of code that children are packed from: a whole symbol, a class member, a run of
// statements, or a group of lines of something too long for one child.
type Unit = {
  start: number;
  end: number;
  tokens: number;
  // Heading path inside the file, e.g. ['class AuthService', 'login'].
  path: string[];
  symbol: string | null;
};

// A top-level declaration with a name, or a run of other top-level statements (symbol null).
type Region = { start: number; end: number; units: Unit[] };

type Declaration = { label: string; name: string; node: Node };

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
 * Chunks a TypeScript, JavaScript or Python file along its syntax: parents are runs of
 * top-level declarations (a big class or function is split into runs of its members or
 * statements), children are symbols or class members packed up to the child size. Null
 * when the file doesn't parse cleanly; the caller then chunks it by lines.
 */
export async function chunkCode(
  text: string,
  language: CodeLanguage,
  path: string,
  settings: ChunkSettings = appConfig.ingestion.chunking,
): Promise<ChunkPlan | null> {
  const tree = await parseCode(text, language);
  if (!tree) return null;
  try {
    if (tree.rootNode.hasError) return null;
    const regions = topLevelRegions(text, tree.rootNode, settings);
    return withLines(text, plan(text, path, regions, settings));
  } finally {
    tree.delete();
  }
}

function plan(text: string, path: string, regions: Region[], settings: ChunkSettings) {
  const span = (units: Unit[]): ChunkSpan => {
    const first = units[0]!;
    const last = units.at(-1)!;
    const shared = sharedPath(units);
    return {
      start: first.start,
      end: last.end,
      headingPath: [path, ...shared],
      pageStart: null,
      pageEnd: null,
      lineStart: null,
      lineEnd: null,
      symbolName: units.every((unit) => unit.symbol && unit.symbol === first.symbol)
        ? first.symbol
        : null,
      tokenCount: countTokens(chunkText(text, first.start, last.end)),
    };
  };

  const result: ChunkPlan = { parents: [], children: [] };
  for (const parentUnits of parentRuns(text, regions, settings.parentMaxTokens)) {
    const parentIndex = result.parents.length;
    result.parents.push(span(parentUnits));
    for (const childUnits of childRuns(parentUnits, settings.childTokens)) {
      result.children.push({ ...span(childUnits), parentIndex });
    }
  }
  return result;
}

// Small regions share a parent; a region over the limit is split into balanced runs of
// its units, so a big class becomes a few parents of about equal size.
function parentRuns(text: string, regions: Region[], maxTokens: number) {
  const runs: Unit[][] = [];
  let current: Unit[] = [];
  let size = 0;
  const flush = () => {
    if (current.length > 0) runs.push(current);
    current = [];
    size = 0;
  };
  for (const region of regions) {
    const tokens = countTokens(text.slice(region.start, region.end));
    if (tokens > maxTokens) {
      flush();
      runs.push(...balancedRuns(region.units, maxTokens));
      continue;
    }
    if (size + tokens > maxTokens) flush();
    current.push(...region.units);
    size += tokens;
  }
  flush();
  return runs;
}

function balancedRuns(units: Unit[], maxTokens: number) {
  const total = units.reduce((sum, unit) => sum + unit.tokens, 0);
  const target = total / Math.ceil(total / maxTokens);
  const runs: Unit[][] = [];
  let current: Unit[] = [];
  let size = 0;
  for (const unit of units) {
    if (current.length > 0 && (size >= target || size + unit.tokens > maxTokens)) {
      runs.push(current);
      current = [];
      size = 0;
    }
    current.push(unit);
    size += unit.tokens;
  }
  if (current.length > 0) runs.push(current);
  return runs;
}

// Consecutive units up to the child size. A unit of half a child or more gets a child of
// its own, so a real function or method isn't merged with its small neighbours (and keeps
// its symbol name). A unit overlapping the one before (line groups of one long symbol)
// always starts a new child, so overlap stays inside one symbol.
function childRuns(units: Unit[], maxTokens: number) {
  const runs: Unit[][] = [];
  let current: Unit[] = [];
  let size = 0;
  const isBig = (unit: Unit) => unit.tokens >= maxTokens / 2;
  for (const unit of units) {
    const last = current.at(-1);
    const startsNew =
      last &&
      (size + unit.tokens > maxTokens || unit.start < last.end || isBig(unit) || isBig(last));
    if (startsNew) {
      runs.push(current);
      current = [];
      size = 0;
    }
    current.push(unit);
    size += unit.tokens;
  }
  if (current.length > 0) runs.push(current);
  return runs;
}

function sharedPath(units: Unit[]) {
  const shared = [...units[0]!.path];
  for (const unit of units.slice(1)) {
    let i = 0;
    while (i < shared.length && shared[i] === unit.path[i]) i++;
    shared.length = i;
  }
  return shared;
}

// ---- syntax --------------------------------------------------------------------------

function topLevelRegions(text: string, root: Node, settings: ChunkSettings): Region[] {
  const regions: Region[] = [];
  // Statements that aren't declarations collect here until the next declaration.
  let loose: Unit[] = [];
  const flushLoose = () => {
    if (loose.length > 0) {
      regions.push({ start: loose[0]!.start, end: loose.at(-1)!.end, units: loose });
    }
    loose = [];
  };

  for (const { start, node } of withLeadingComments(text, namedChildren(root))) {
    const declaration = declarationOf(node);
    if (!declaration) {
      loose.push(...unitsOf(text, start, node.endIndex, null, [], null, settings));
      continue;
    }
    flushLoose();
    const { label, name } = declaration;
    const units = unitsOf(
      text,
      start,
      node.endIndex,
      declaration,
      [`${label} ${name}`],
      name,
      settings,
    );
    regions.push({ start, end: node.endIndex, units });
  }
  flushLoose();
  return regions;
}

/**
 * Units for the code from `start` to `end`: one unit when it fits a child, else its body's
 * members (a class) or statements (a function), else groups of lines.
 */
function unitsOf(
  text: string,
  start: number,
  end: number,
  declaration: Declaration | null,
  path: string[],
  symbol: string | null,
  settings: ChunkSettings,
): Unit[] {
  const tokens = countTokens(text.slice(start, end));
  if (tokens <= settings.childTokens) return [{ start, end, tokens, path, symbol }];

  // Only bodies that are lists of members or statements split cleanly between their
  // children; an expression body (`() => a ? b : c`) would lose the text between parts.
  const body = declaration?.node.childForFieldName('body');
  const splittable = body && BODY_TYPES.has(body.type);
  const parts = splittable ? withLeadingComments(text, namedChildren(body)) : [];
  if (parts.length === 0) return lineGroups(text, start, end, path, symbol, settings);

  const isClass = declaration!.label === 'class';
  const units: Unit[] = [];
  parts.forEach((part, i) => {
    // The declaration's header ("class A {") goes with the first part, its closing brace
    // with the last, so the units cover the whole declaration.
    const from = i === 0 ? start : part.start;
    const to = i === parts.length - 1 ? end : part.node.endIndex;
    const member = isClass ? declarationOf(part.node) : null;
    if (member) {
      units.push(
        ...unitsOf(
          text,
          from,
          to,
          member,
          [...path, member.name],
          `${symbol}.${member.name}`,
          settings,
        ),
      );
    } else {
      units.push(...unitsOf(text, from, to, null, path, symbol, settings));
    }
  });
  return units;
}

// Whole lines packed up to the child size, each group starting with the last lines of the
// one before (up to the overlap size).
function lineGroups(
  text: string,
  start: number,
  end: number,
  path: string[],
  symbol: string | null,
  settings: ChunkSettings,
): Unit[] {
  const lines: { start: number; end: number; tokens: number }[] = [];
  for (let at = start; at < end;) {
    const newline = text.indexOf('\n', at);
    const lineEnd = newline === -1 || newline > end ? end : newline;
    // Indentation stays with its line, so token counts match the chunk text.
    const range = trimRange(text, at, lineEnd);
    if (range) lines.push(...splitLong(text, { ...range, start: at }, settings.childTokens));
    at = lineEnd + 1;
  }

  const groups: Unit[] = [];
  let from = 0;
  while (from < lines.length) {
    let to = from;
    let size = 0;
    while (to < lines.length && (to === from || size + lines[to]!.tokens <= settings.childTokens)) {
      size += lines[to]!.tokens;
      to++;
    }
    groups.push({ start: lines[from]!.start, end: lines[to - 1]!.end, tokens: size, path, symbol });
    if (to >= lines.length) break;

    let next = to;
    let overlap = 0;
    while (
      next - 1 > from &&
      overlap + lines[next - 1]!.tokens <= settings.overlapTokens &&
      overlap + lines[next - 1]!.tokens + lines[to]!.tokens <= settings.childTokens
    ) {
      next--;
      overlap += lines[next]!.tokens;
    }
    from = next;
  }
  return groups;
}

function namedChildren(node: Node) {
  return node.namedChildren.filter((child): child is Node => child !== null);
}

// Pairs each node with where it really starts: comments and decorators right above it (no
// blank line in between) belong to it. TypeScript keeps a method's decorators (`@Get()`)
// as separate children of the class body, unlike Python's decorated_definition. Comments
// followed by a blank line stay nodes of their own.
function withLeadingComments(text: string, nodes: Node[]) {
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
function declarationOf(node: Node): Declaration | null {
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
