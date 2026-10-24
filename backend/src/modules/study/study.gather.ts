import { appConfig } from '../../config/app.config.js';
import { CitationRegistry, renderSource } from '../citations/citationRegistry.js';
import type { CitationRef, NewCitation } from '../citations/citations.types.js';
import { search } from '../retrieval/retrieval.service.js';
import { countTokens } from '../../utils/tokens.js';
import type { StudyInput } from './study.dto.js';
import {
  type Candidate,
  findPassages,
  findTocPath,
  findWorkspaceSources,
  listFolderParents,
  listSectionParents,
  listSourceParents,
  type PassageRow,
} from './study.repository.js';

// What a generation reads: the chosen passages, numbered so items can cite them. When
// they don't fit in one prompt they are condensed in groups first (at most MAX_GROUPS
// calls), so a selection bigger than that is sampled down before any text is loaded.
export const MAX_GROUPS = 4;
// Sampling only knows each passage's own size: this is allowed for its <source> tag (title,
// path, heading), and the budget keeps some slack for groups that don't pack full.
const TAG_TOKENS = 60;
const SAMPLE_SHARE = 0.85;

export type Gathered = { refs: CitationRef[] } | { error: string };

type Owner = { userId: string; workspaceId: string };

export async function gatherMaterial(owner: Owner, input: StudyInput): Promise<Gathered> {
  // Checked again here: a source may have been deleted since the request.
  const sources = await findWorkspaceSources(owner.workspaceId, input.sourceIds);
  if (sources.length === 0) return { error: 'The chosen sources no longer exist.' };
  const sourceIds = sources.map((source) => source.id);
  const titles = new Map(sources.map((source) => [source.id, source]));

  let refs: NewCitation[];
  if (input.topic) {
    refs = await topicRefs(owner, sourceIds, input.topic);
  } else {
    const candidates = await selectCandidates(sourceIds, input);
    if (candidates === null) return { error: 'The chosen section no longer exists.' };
    const budget = appConfig.study.maxInputTokens * MAX_GROUPS * SAMPLE_SHARE;
    const rows = await findPassages(sampleEvenly(candidates, budget).map((c) => c.id));
    refs = rows.map((row) => passageRef(row, titles.get(row.sourceId)!));
  }

  if (refs.length === 0) return { error: 'Nothing indexed was found for this selection.' };
  return { refs: fitGroups(numbered(refs)) };
}

function numbered(refs: NewCitation[]) {
  const registry = new CitationRegistry();
  for (const ref of refs) registry.add(ref);
  return [...registry.all()];
}

/**
 * The passages thinned out evenly until they pack into MAX_GROUPS groups, numbered again
 * from 1. Sampling estimated the sizes; this counts the rendered blocks. Numbers only get
 * smaller here, so the groups the generation makes are never more than counted.
 */
function fitGroups(refs: CitationRef[]) {
  const sizes = new Map(refs.map((ref) => [ref, renderedTokens(ref)]));
  const groupCount = (list: CitationRef[]) => packGroups(list, (ref) => sizes.get(ref)!).length;
  let kept = refs;
  for (let count = refs.length; count > 1 && groupCount(kept) > MAX_GROUPS;) {
    kept = pick(refs, --count);
  }
  return kept === refs ? refs : numbered(kept.map(({ n: _n, ...ref }) => ref));
}

async function selectCandidates(sourceIds: string[], input: StudyInput) {
  if (input.tocNodeId) {
    const section = await findTocPath(sourceIds, input.tocNodeId);
    if (!section) return null;
    return listSectionParents(section.documentId, section.titles);
  }
  if (input.pathPrefix) return listFolderParents(sourceIds, input.pathPrefix);

  // No selection: a spread of each source, reading order kept.
  const perSource = Math.ceil(appConfig.study.sampleParents / sourceIds.length);
  const lists = await Promise.all(sourceIds.map((id) => listSourceParents(id)));
  return lists.flatMap((parents) => pick(parents, perSource));
}

async function topicRefs(owner: Owner, sourceIds: string[], topic: string) {
  const { results, parents } = await search({
    userId: owner.userId,
    workspaceId: owner.workspaceId,
    query: topic,
    sourceIds,
    topK: appConfig.study.topicResults,
    // Study is owner-only, so the reranker's cost is the owner's.
    rerank: true,
    expandParents: true,
    maxContextTokens: appConfig.study.maxInputTokens * MAX_GROUPS,
  });
  const byId = new Map(results.map((chunk) => [chunk.chunkId, chunk]));
  const refs: NewCitation[] = [];
  for (const block of parents) {
    const children = block.childIds.flatMap((id) => byId.get(id) ?? []);
    const first = children[0];
    if (!first) continue;
    refs.push({
      kind: 'CHUNK',
      chunkId: first.chunkId,
      sourceId: block.sourceId,
      sourceTitle: block.sourceTitle,
      sourceType: first.sourceType,
      path: block.documentPath,
      heading: block.headingPath.join(' > ') || undefined,
      ...span(children, 'pageStart', 'pageEnd'),
      ...span(children, 'lineStart', 'lineEnd'),
      text: block.content,
    });
  }
  return refs;
}

type Ranged = Record<'pageStart' | 'pageEnd' | 'lineStart' | 'lineEnd', number | null>;

/** The range the found children cover, when they all have one and share a file. */
function span<S extends keyof Ranged, E extends keyof Ranged>(chunks: Ranged[], start: S, end: E) {
  const starts = chunks.map((chunk) => chunk[start]);
  const ends = chunks.map((chunk) => chunk[end] ?? chunk[start]);
  if (starts.some((value) => value === null) || ends.some((value) => value === null)) return {};
  return {
    [start]: Math.min(...(starts as number[])),
    [end]: Math.max(...(ends as number[])),
  } as Partial<Record<S | E, number>>;
}

function passageRef(row: PassageRow, source: { title: string; type: NewCitation['sourceType'] }) {
  return {
    kind: 'CHUNK',
    chunkId: row.id,
    sourceId: row.sourceId,
    sourceTitle: source.title,
    sourceType: source.type,
    path: row.document.path,
    heading: row.headingPath.join(' > ') || undefined,
    pageStart: row.pageStart ?? undefined,
    pageEnd: row.pageEnd ?? undefined,
    lineStart: row.lineStart ?? undefined,
    lineEnd: row.lineEnd ?? undefined,
    text: row.content,
  } satisfies NewCitation;
}

/** `count` items spread evenly over the list, first and last included. */
function pick<T>(items: T[], count: number) {
  if (items.length <= count) return items;
  if (count === 1) return [items[0]!];
  const step = (items.length - 1) / (count - 1);
  return Array.from({ length: count }, (_, i) => items[Math.round(i * step)]!);
}

/** The candidates, thinned out evenly until they (and their tags) fit the token budget. */
function sampleEvenly(candidates: Candidate[], budget: number) {
  const total = (list: Candidate[]) => list.reduce((sum, c) => sum + c.tokenCount + TAG_TOKENS, 0);
  if (total(candidates) <= budget) return candidates;
  let count = Math.max(1, Math.floor((candidates.length * budget) / total(candidates)));
  let picked = pick(candidates, count);
  while (count > 1 && total(picked) > budget) picked = pick(candidates, --count);
  return picked;
}

/**
 * Splits the passages into prompt-sized groups, in order. A passage bigger than a whole
 * group gets one of its own; the model call cuts nothing, the route's context is larger.
 */
export function groupRefs(refs: CitationRef[]) {
  return packGroups(refs, renderedTokens);
}

const renderedTokens = (ref: CitationRef) => countTokens(renderSource(ref));

function packGroups(
  refs: CitationRef[],
  size: (ref: CitationRef) => number,
  maxTokens = appConfig.study.maxInputTokens,
) {
  const groups: CitationRef[][] = [];
  let current: CitationRef[] = [];
  let used = 0;
  for (const ref of refs) {
    const tokens = size(ref);
    if (current.length > 0 && used + tokens > maxTokens) {
      groups.push(current);
      current = [];
      used = 0;
    }
    current.push(ref);
    used += tokens;
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

export const renderGroup = (refs: CitationRef[]) =>
  refs.map((ref) => renderSource(ref)).join('\n\n');
