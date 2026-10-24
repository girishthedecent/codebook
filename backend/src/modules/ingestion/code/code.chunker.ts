import type { Node } from 'web-tree-sitter';
import { appConfig } from '../../../config/app.config.js';
import { countTokens } from '../../../utils/tokens.js';
import { chunkText, splitLong, trimRange, type ChunkSettings } from '../doc.chunker.js';
import type { ChunkPlan, ChunkSpan } from '../ingestion.types.js';
import { withLines } from './lines.js';
import {
  bodyParts,
  declarationOf,
  namedChildren,
  withLeadingComments,
  type Declaration,
} from './syntax.js';
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

  const parts = declaration ? bodyParts(text, declaration) : [];
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
