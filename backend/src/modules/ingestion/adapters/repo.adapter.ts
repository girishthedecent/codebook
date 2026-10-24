import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { appConfig } from '../../../config/app.config.js';
import logger from '../../../config/logger.config.js';
import { sha256 } from '../../../utils/hash.js';
import { downloadTarball, resolveCommit } from '../../sources/github.client.js';
import type { RepoOrigin } from '../../sources/source.dto.js';
import { chunkCode } from '../code/code.chunker.js';
import { countLines } from '../code/lines.js';
import { chunkLines } from '../code/line.chunker.js';
import { chunkMarkdown } from '../code/markdown.chunker.js';
import { fileOutline } from '../code/outline.js';
import { isCodeLanguage } from '../code/treeSitter.js';
import { repoIngestHash } from '../contentHash.js';
import { chunkText } from '../doc.chunker.js';
import type { ChunkPlan, DraftDocument } from '../ingestion.types.js';
import { languageOf } from '../repo/file.filter.js';
import { readRepoArchive, RepoArchiveError } from '../repo/repo.archive.js';
import { redactSecrets } from '../repo/secret.scanner.js';
import type { AdapterContext, AdapterResult, IngestSource } from './adapter.js';

/**
 * Resolves the source's branch or tag to a commit, downloads that commit's tarball, keeps
 * the files worth indexing (secrets redacted) and chunks each one by its language.
 */
export async function prepareRepo(
  source: IngestSource,
  ctx: AdapterContext,
): Promise<AdapterResult> {
  const fail = (error: string) => ({ outcome: 'failed', error }) as const;
  const { owner, repo, ref } = source.origin as RepoOrigin;

  await ctx.stage('FETCHING', 2);
  const commit = await resolveCommit(owner, repo, ref);
  if (commit === 'no-repo') return fail('Repository not found. Only public repositories work.');
  if (commit === 'empty') return fail('This repository is empty');
  if (commit === 'no-ref') return fail(`Branch, tag or commit "${ref}" no longer exists`);

  // A commit never changes, so an unchanged hash means nothing needs downloading.
  const contentHash = repoIngestHash(source.title, commit.sha);
  if (ctx.unchanged(contentHash)) return { outcome: 'unchanged' };

  let archive;
  try {
    const body = await downloadTarball(owner, repo, commit.sha);
    await ctx.stage('FILTERING', 4);
    archive = await readRepoArchive(Readable.fromWeb(body));
  } catch (error) {
    if (error instanceof RepoArchiveError) return fail(error.message);
    throw error;
  }

  await ctx.stage('PARSING', 5);
  let redactions = 0;
  const files = archive.files.map((file) => {
    const language = languageOf(file.path);
    const { text, findings } = redactSecrets(file.text, { code: isCodeLanguage(language) });
    if (findings.length > 0) {
      // Rule names and counts only; the values never reach a log.
      logger.info('Secrets redacted', { sourceId: source.id, path: file.path, findings });
      redactions += findings.reduce((sum, finding) => sum + finding.count, 0);
    }
    return { ...file, text, language };
  });

  await ctx.stage('CHUNKING', 10);
  const documents: DraftDocument[] = [];
  const languages: Record<string, number> = {};
  for (const file of files) {
    const plan = await chunkFile(file.text, file.language, file.path);
    const language = file.language ?? 'text';
    languages[language] = (languages[language] ?? 0) + 1;
    documents.push({
      id: randomUUID(),
      path: file.path,
      language: file.language,
      content: file.text,
      pageStart: null,
      pageEnd: null,
      lineCount: countLines(file.text),
      sizeBytes: file.sizeBytes,
      skippedReason: null,
      outline: fileOutline(file.text, plan),
      hash: sha256(file.text),
      toc: [],
      parents: plan.parents.map((parent) => ({
        ...parent,
        id: randomUUID(),
        hash: sha256(chunkText(file.text, parent.start, parent.end)),
      })),
      children: plan.children.map((child) => ({
        ...child,
        id: randomUUID(),
        hash: sha256(chunkText(file.text, child.start, child.end)),
      })),
    });
  }

  const children = documents.reduce((sum, doc) => sum + doc.children.length, 0);
  const { maxChildChunks } = appConfig.ingestion.repo;
  if (children > maxChildChunks) {
    return fail(
      `This repository needs ${children.toLocaleString('en-US')} search chunks; the limit is ` +
        `${maxChildChunks.toLocaleString('en-US')}. Pick a smaller repository or branch.`,
    );
  }

  for (const skipped of archive.skipped) {
    documents.push({
      id: randomUUID(),
      path: skipped.path,
      language: skipped.path.endsWith('/') ? null : languageOf(skipped.path),
      content: '',
      pageStart: null,
      pageEnd: null,
      lineCount: null,
      sizeBytes: skipped.sizeBytes,
      skippedReason: skipped.reason,
      hash: '',
      toc: [],
      parents: [],
      children: [],
    });
  }
  documents.sort((a, b) => (a.path < b.path ? -1 : 1));

  return {
    outcome: 'draft',
    contentHash,
    documents,
    repo: {
      commitSha: commit.sha,
      files: files.length,
      skippedFiles: archive.skipped.length,
      redactions,
      languages,
    },
  };
}

async function chunkFile(text: string, language: string | null, path: string): Promise<ChunkPlan> {
  if (language === 'markdown') return chunkMarkdown(text, path);
  if (isCodeLanguage(language)) {
    const plan = await chunkCode(text, language, path);
    if (plan) return plan;
  }
  return chunkLines(text, path);
}
